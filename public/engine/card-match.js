// Turn-based card games with hidden cards and no dealer: mental poker (see
// ARCHITECTURE.md "Card games"). Like TurnMatch, every browser runs the same
// rules on the same moves; the deck is shuffled by everyone with proofs, a
// card's face is only known where it was opened, and the game is replayed
// with every face known once it ends.
//
// A rules module provides:
//   deckSize                              1 to 200; a card's face is 0..deckSize-1
//   newState(first, players, deck)        -> state with state.turn and state.winner (-1 while playing).
//                                            deck.cards: the shuffled deck's slots, top first.
//   applyMove(state, player, move, deck)  -> events[]; mutates state; throws RuleError if illegal
//   reveals(state, player, move)          -> optional; the cards from the player's hand the move shows
//   settle(state, deck)                   -> optional; events[]; after newState and each move, once
//                                            their cards are dealt, and again while it deals more
// The deck those calls get (a slot is a card's place; a shuffle makes new ones):
//   deck.face(slot)        its face if every player can see it, else null; every face in the audit
//   deck.owner(slot)       the seat it was dealt to, or -1
//   deck.deal(slot, seat)  only that seat sees it; a card hidden in another hand can't be dealt
//   deck.open(slot)        everyone sees it from the next call on (settle reads it)
//   deck.shuffle(slots)    -> new slots for the same cards, shuffled again by everyone
// The state must never depend on a face that may be hidden, or the replay
// won't match; a rule that needs a hidden face throws only when it is known.
//
// Messages (all carry m): hello {tip, key}, draw {k, v}, shuffle {k, i, n, d},
// shares {k, i, n, d}, move {move, sh}, audit {key}, abort {reason, about}.
import { Emitter } from "./channel.js";
import { SharedRandom, FairPlayError } from "./fair.js";
import { matchRouter } from "./session.js";
import { robotPause } from "./robot-pace.js";
import { RuleError } from "./turn-match.js";
import { deckService, DeckError, MAX_DECK, HELLO_BYTES, SECRET_BYTES, SHARE_BYTES } from "./deck-service.js";
import { toBase64, fromBase64 } from "./base64.js";

// Shuffles and share rounds go out in parts, so no message passes 4K characters.
const PART_CHARS = 3000;
const PART_SHARES = 16;
const MAX_PARTS = Math.ceil((2 * MAX_DECK) / PART_SHARES); // a round deals and opens a card at most once each
const MAX_REVEALS = PART_SHARES; // a move's shares, the same 4K
const MAX_SETTLE = 64;
const MAX_AHEAD = 4 * MAX_PARTS; // messages one seat may send ahead of us

// A rule or protocol failure blamed on one seat.
class Cheat extends FairPlayError {
  constructor(reason, seat) {
    super(reason);
    this.seat = seat;
  }
}

// The cards as rules see them (see the top of this file). Records deals,
// opens and shuffles in `ops` for the match to carry out.
class Table {
  constructor({ slots, players, face, make }) {
    this.slots = slots; // { owner, open, gone }
    this.players = players;
    this.faceOf = face;
    this.make = make;
    this.ops = [];
    this.opened = new Set();
  }
  #get(id) {
    const s = Number.isInteger(id) ? this.slots[id] : undefined;
    if (!s || s.gone) throw new RuleError(`no card in slot ${id}`);
    return s;
  }
  face(id) {
    this.#get(id);
    // Not RuleError: it's a bug in the rules, not a player's move.
    if (this.opened.has(id)) throw new Error(`slot ${id} was opened in this call; read its face in a later call`);
    return this.faceOf(id);
  }
  owner(id) {
    return this.#get(id).owner;
  }
  deal(id, seat) {
    const s = this.#get(id);
    if (!Number.isInteger(seat) || seat < 0 || seat >= this.players) throw new RuleError(`no seat ${seat}`);
    if (s.owner === seat) return;
    if (s.owner !== -1 && !s.open) throw new RuleError("a hidden card can't change hands");
    s.owner = seat;
    if (!s.open) this.ops.push({ type: "deal", slot: id, to: seat });
  }
  open(id) {
    const s = this.#get(id);
    if (s.open) return;
    s.open = true;
    this.opened.add(id);
    this.ops.push({ type: "open", slot: id });
  }
  shuffle(ids) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new RuleError("bad shuffle");
    ids.forEach((id) => this.#get(id));
    for (const id of ids) this.slots[id].gone = true;
    const into = ids.map(() => this.slots.push(this.make()) - 1);
    if (ids.length) this.ops.push({ type: "shuffle", from: ids.slice(), into: into.slice() }); // rules may change what they get back
    return into;
  }
}

const isSeat = (s, players) => Number.isInteger(s) && s >= 0 && s < players;
const hex64 = (v) => {
  if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) throw new TypeError("bad tip");
  return v;
};
// One part of a message sent in parts: { n, d }.
function part(msg, data) {
  if (!Number.isInteger(msg.i) || !Number.isInteger(msg.n) || msg.n < 1 || msg.n > MAX_PARTS || msg.i < 0 || msg.i >= msg.n) throw new TypeError("bad part");
  return { n: msg.n, d: data() };
}

function bytes(v, { exact, max }) {
  const b = fromBase64(v);
  if ((exact && b.length !== exact) || (max && b.length > max)) throw new TypeError("bad length");
  return b;
}

export class CardMatch extends Emitter {
  constructor({ send, me, rules, m = 1, players = 2 }) {
    super();
    if (!(rules.deckSize >= 1 && rules.deckSize <= MAX_DECK)) throw new Error(`deckSize must be 1 to ${MAX_DECK}`);
    this.send = (msg) => send({ ...msg, m });
    this.me = me;
    this.players = players;
    this.m = m;
    this.rules = rules;
    this.deck = deckService();
    this.phase = "starting"; // starting -> playing -> over | aborted
    this.busy = "keys"; // "keys" | "shuffling" | "dealing" | "auditing" | null
    this.state = null;
    this.verdict = null; // after the audit: { ok, reason?, seat? }
    this.audited = null; // every slot's face, once the audit has passed
    this.working = false;
    this.slots = []; // { card, owner, open, face, shares: [by seat], gone }
    this.log = []; // { player, move } for the audit
    this.k = 0; // deck steps (shuffles and share rounds), counted alike everywhere
    this.inbox = new Map(); // key -> { value, from }
    this.ahead = []; // by seat: how many of its messages the inbox holds
    this.waiters = new Map();
    this.seen = new Set();
    this.srReady = SharedRandom.create(1); // one draw: who starts
    this.queue = Promise.resolve();
    this.#enqueue(() => this.#setup());
  }

  canMove() {
    return this.phase === "playing" && this.state.turn === this.me && !this.working;
  }

  // The face of a slot, if I know it: open to all, dealt to me, or any card once the audit has passed.
  face(slot) {
    return this.slots[slot]?.face ?? this.audited?.[slot] ?? null;
  }

  // Validate locally, then send and apply. Illegal moves emit "invalid".
  play(move) {
    return this.#enqueue(async () => {
      if (this.phase !== "playing" || this.state.turn !== this.me) return this.emit("invalid", "not your turn");
      let shown;
      try {
        shown = this.#reveals(this.state, this.me, move);
        const set = new Set(shown);
        const table = this.#table(
          this.slots.map((s, id) => ({ ...s, open: s.open || set.has(id) })),
          (id) => {
            const s = this.slots[id];
            return s && (s.open || set.has(id)) ? s.face : null;
          },
        );
        this.rules.applyMove(structuredClone(this.state), this.me, move, table);
      } catch (err) {
        if (err?.name === "RuleError") return this.emit("invalid", err.message);
        throw err;
      }
      const shares = await this.#job("shares", this.key.secret, shown.map((id) => this.slots[id].card));
      this.send({ t: "move", move, sh: shares.map(toBase64) });
      await this.#apply(this.me, move, shown, shares);
    });
  }

  receive(msg, from) {
    if (msg?.m !== this.m || !isSeat(from, this.players) || from === this.me || this.phase === "aborted") return;
    const k = Number.isInteger(msg.k) && msg.k > 0 ? msg.k : 0;
    switch (msg.t) {
      case "draw":
        return void this.srReady.then((sr) => sr.receive(msg.k, msg.v, from));
      case "abort":
        return this.abort(`stopped the match: ${String(msg.reason).slice(0, 80)}`, from, isSeat(msg.about, this.players) ? msg.about : undefined);
      case "hello":
        return this.#put(`hello:${from}`, from, () => ({ tip: hex64(msg.tip), hello: bytes(msg.key, { exact: HELLO_BYTES }) }));
      case "shuffle":
        return this.#put(`shuffle:${k}:${from}:${msg.i}`, from, () => part(msg, () => {
          if (typeof msg.d !== "string" || msg.d.length > PART_CHARS) throw new TypeError("bad part");
          return msg.d;
        }));
      case "shares":
        return this.#put(`shares:${k}:${from}:${msg.i}`, from, () => part(msg, () => {
          if (!Array.isArray(msg.d) || msg.d.length > PART_SHARES) throw new TypeError("bad shares");
          return msg.d.map((d) => bytes(d, { exact: SHARE_BYTES }));
        }));
      case "audit":
        return this.#put(`audit:${from}`, from, () => bytes(msg.key, { exact: SECRET_BYTES }));
      default:
        this.#enqueue(() => this.#handle(msg, from));
    }
  }

  // seat: who broke the rules or stopped the match; about: whom their reason names.
  abort(reason, seat, about) {
    if (this.phase === "aborted") return;
    this.phase = "aborted";
    this.busy = null;
    this.abortReason = reason;
    this.abortSeat = seat;
    this.abortAbout = about;
    const err = new FairPlayError(reason);
    for (const w of this.waiters.values()) w.reject(err);
    this.waiters.clear();
    this.srReady.then((sr) => sr.abort(err));
    this.emit("abort", { reason, seat, about });
    this.emit("update");
  }

  #enqueue(step) {
    const run = this.queue.then(async () => {
      if (this.phase === "aborted") return;
      this.working = true;
      try {
        await step();
      } catch (err) {
        if (this.phase === "aborted") return;
        // Always tell the others, or they would wait forever.
        this.send({ t: "abort", reason: err.message, about: err.seat });
        if (err instanceof FairPlayError || err?.name === "RuleError") {
          this.abort(err.message, err.seat);
        } else {
          console.error(err);
          this.abort(`Unexpected error: ${err.message}`);
        }
      } finally {
        this.working = false;
        this.emit("update");
      }
    });
    this.queue = run;
    return run;
  }

  // Messages a later step reads: hellos, shuffles, shares and audit keys.
  #put(key, from, parse) {
    let value;
    try {
      value = parse();
    } catch {
      return this.#cheat(`sent a malformed ${key.split(":")[0]} message`, from);
    }
    if (this.seen.has(key)) return this.#cheat(`sent the same ${key.split(":")[0]} message twice`, from);
    this.seen.add(key);
    const waiter = this.waiters.get(key);
    if (waiter) {
      this.waiters.delete(key);
      return waiter.resolve(value);
    }
    if ((this.ahead[from] ?? 0) >= MAX_AHEAD) return this.#cheat("sent too many messages ahead", from);
    this.ahead[from] = (this.ahead[from] ?? 0) + 1;
    this.inbox.set(key, { value, from });
  }

  #wait(key) {
    if (this.phase === "aborted") return Promise.reject(new FairPlayError(this.abortReason));
    if (this.inbox.has(key)) {
      const { value, from } = this.inbox.get(key);
      this.inbox.delete(key);
      this.ahead[from]--;
      return Promise.resolve(value);
    }
    return new Promise((resolve, reject) => this.waiters.set(key, { resolve, reject }));
  }

  // Sends items (a string's characters or an array's entries) in parts of `size`.
  #sendParts(msg, items, size) {
    const n = Math.max(1, Math.ceil(items.length / size));
    for (let i = 0; i < n; i++) this.send({ ...msg, i, n, d: items.slice(i * size, (i + 1) * size) });
  }

  // Waits for every part of `key` from `seat`; resolves to each part's data, in order.
  async #waitParts(key, seat) {
    const parts = [await this.#wait(`${key}:0`)];
    for (let i = 1; i < parts[0].n; i++) parts.push(await this.#wait(`${key}:${i}`));
    if (parts.some((p) => p.n !== parts[0].n)) throw new Cheat("sent parts that don't add up", seat);
    return parts.map((p) => p.d);
  }

  #cheat(reason, seat) {
    this.send({ t: "abort", reason, about: seat });
    this.abort(reason, seat);
  }

  // A deck job. Once the match is stopped, its result is dropped and the step ends.
  async #job(op, ...args) {
    const value = await this.deck[op](...args);
    if (this.phase === "aborted") throw new FairPlayError(this.abortReason);
    return value;
  }

  // Runs a deck job whose input came from `seat`; a bad input is their fault.
  async #check(seat, what, job) {
    try {
      return await job();
    } catch (err) {
      if (err instanceof DeckError) throw new Cheat(`sent ${what} that doesn't check out${err.crashed ? " (it crashed the deck)" : ""}`, seat);
      throw err;
    }
  }

  #busy(what) {
    if (this.busy === what) return;
    this.busy = what;
    this.emit("update");
  }

  // Binds a seat's key to this match: its match number, seat and fresh chain tip.
  #context(seat, tip) {
    return `ddp-cards/1/m${this.m}/seat${seat}/${tip}`;
  }

  #table(slots, face) {
    return new Table({ slots, players: this.players, face, make: () => ({ card: null, owner: -1, open: false, face: null, shares: [], gone: false }) });
  }

  #liveTable() {
    return this.#table(this.slots, (id) => (this.slots[id].open ? this.slots[id].face : null));
  }

  async #setup() {
    const sr = await this.srReady;
    this.key = await this.#job("keygen", this.#context(this.me, sr.tip));
    this.send({ t: "hello", tip: sr.tip, key: toBase64(this.key.hello) });
    const hellos = [];
    for (let s = 0; s < this.players; s++) hellos[s] = s === this.me ? { tip: sr.tip, hello: this.key.hello } : await this.#wait(`hello:${s}`);
    this.contexts = hellos.map((h, s) => this.#context(s, h.tip));
    try {
      ({ joint: this.joint, pks: this.pks } = await this.#job("joinKeys", hellos.map((h, s) => ({ hello: h.hello, context: this.contexts[s] }))));
    } catch (err) {
      if (err instanceof DeckError && isSeat(err.at, this.players)) throw new Cheat(`sent a key that doesn't check out: ${err.message}`, err.at);
      throw err;
    }
    sr.setPeers(hellos.map((h) => h.tip), this.me);
    const rng = await sr.draw((k, v) => this.send({ t: "draw", k, v }));
    this.first = Math.floor(rng() * this.players);

    this.#busy("shuffling");
    const cards = await this.#shuffleRound(await this.#job("newDeck", this.rules.deckSize));
    const table = this.#liveTable();
    table.cards = cards.map((card) => this.slots.push({ card, owner: -1, open: false, face: null, shares: [], gone: false }) - 1);
    this.state = this.rules.newState(this.first, this.players, table);
    await this.#runOps(table.ops);
    await this.#settle();
    this.phase = "playing";
    this.busy = null;
    this.emit("start", { first: this.first });
    this.#checkOver();
  }

  // Every seat in turn shuffles the cards; I check everyone else's proof.
  async #shuffleRound(cards) {
    const k = ++this.k;
    for (let s = 0; s < this.players; s++) {
      if (s === this.me) {
        const out = await this.#job("shuffle", this.joint, this.key.secret, cards);
        this.#sendParts({ t: "shuffle", k }, toBase64(out.proof), PART_CHARS);
        cards = out.cards;
      } else {
        let proof;
        try {
          proof = fromBase64((await this.#waitParts(`shuffle:${k}:${s}`, s)).join(""));
        } catch (err) {
          throw err instanceof Cheat ? err : new Cheat("sent a malformed shuffle", s);
        }
        cards = await this.#check(s, "a shuffle", () => this.#job("verifyShuffle", this.joint, s, cards, proof));
      }
    }
    return cards;
  }

  // Every seat sends its shares, even none, and checks the others' (see ARCHITECTURE.md).
  async #shareRound(ops) {
    const k = ++this.k;
    const helps = (seat, op) => op.type === "open" || op.to !== seat;
    const mine = ops.filter((op) => helps(this.me, op));
    const shares = mine.length ? await this.#job("shares", this.key.secret, mine.map((op) => this.slots[op.slot].card)) : [];
    mine.forEach((op, i) => (this.slots[op.slot].shares[this.me] = shares[i]));
    this.#sendParts({ t: "shares", k }, shares.map(toBase64), PART_SHARES);
    for (let s = 0; s < this.players; s++) {
      if (s === this.me) continue;
      const theirs = ops.filter((op) => helps(s, op));
      const shares = (await this.#waitParts(`shares:${k}:${s}`, s)).flat();
      if (shares.length !== theirs.length) throw new Cheat(`sent ${shares.length} shares where ${theirs.length} were due`, s);
      if (!theirs.length) continue;
      const items = theirs.map((op, i) => ({ card: this.slots[op.slot].card, pk: this.pks[s], share: shares[i] }));
      await this.#check(s, "a share", () => this.#job("verifyShares", this.joint, items));
      theirs.forEach((op, i) => (this.slots[op.slot].shares[s] = shares[i]));
    }
    for (const op of ops) {
      const slot = this.slots[op.slot];
      if (op.type === "deal" && op.to !== this.me) continue;
      if (op.type === "deal") [slot.shares[this.me]] = await this.#job("shares", this.key.secret, [slot.card]);
      slot.face = await this.#job("open", this.joint, slot.card, slot.shares.map((share, s) => ({ pk: this.pks[s], share })));
    }
  }

  async #runOps(ops) {
    for (let i = 0; i < ops.length; ) {
      if (ops[i].type === "shuffle") {
        const { from, into } = ops[i++];
        this.#busy("shuffling");
        const cards = await this.#shuffleRound(from.map((id) => this.slots[id].card));
        into.forEach((id, j) => (this.slots[id].card = cards[j]));
      } else {
        const batch = [];
        while (i < ops.length && ops[i].type !== "shuffle") batch.push(ops[i++]);
        this.#busy("dealing");
        await this.#shareRound(batch);
      }
    }
  }

  async #settle() {
    if (!this.rules.settle) return;
    for (let round = 0; round < MAX_SETTLE; round++) {
      const table = this.#liveTable();
      const events = this.rules.settle(this.state, table) ?? [];
      if (events.length) this.emit("events", { player: -1, move: null, events });
      if (!table.ops.length) return;
      await this.#runOps(table.ops);
    }
    throw new RuleError("settle kept dealing");
  }

  // The hidden cards from the player's hand that this move shows.
  #reveals(state, player, move) {
    const ids = this.rules.reveals?.(state, player, move) ?? [];
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new RuleError("bad reveals");
    for (const id of ids) {
      const s = Number.isInteger(id) ? this.slots[id] : undefined;
      if (!s || s.gone || s.owner !== player) throw new RuleError("a move can only show cards from your own hand");
    }
    const hidden = ids.filter((id) => !this.slots[id].open);
    if (hidden.length > MAX_REVEALS) throw new RuleError(`a move can show at most ${MAX_REVEALS} hidden cards`);
    return hidden;
  }

  async #handle(msg, from) {
    if (msg.t !== "move") throw new Cheat(`sent an unknown message ${String(msg.t).slice(0, 20)}`, from);
    if (this.phase !== "playing") throw new Cheat("moved outside play", from);
    if (this.state.turn !== from) throw new Cheat("moved out of turn", from);
    let shown;
    try {
      shown = this.#reveals(this.state, from, msg.move);
    } catch (err) {
      if (err?.name === "RuleError") throw new Cheat(`broke the rules: ${err.message}`, from);
      throw err;
    }
    let shares;
    try {
      if (!Array.isArray(msg.sh) || msg.sh.length !== shown.length) throw new TypeError();
      shares = msg.sh.map((d) => bytes(d, { exact: SHARE_BYTES }));
    } catch {
      throw new Cheat("sent a move without the shares for the cards it shows", from);
    }
    await this.#apply(from, msg.move, shown, shares);
  }

  async #apply(player, move, shown, shares) {
    for (const [i, id] of shown.entries()) {
      const slot = this.slots[id];
      slot.shares[player] = shares[i];
      if (player !== this.me) {
        const all = slot.shares.map((share, s) => ({ pk: this.pks[s], share }));
        slot.face = await this.#check(player, "a share", () => this.#job("open", this.joint, slot.card, all));
      }
      slot.open = true;
    }
    const table = this.#liveTable();
    let events;
    try {
      events = this.rules.applyMove(this.state, player, move, table);
    } catch (err) {
      if (err?.name === "RuleError") throw new Cheat(`broke the rules: ${err.message}`, player);
      throw err;
    }
    this.log.push({ player, move: structuredClone(move) });
    this.emit("events", { player, move, events });
    await this.#runOps(table.ops);
    await this.#settle();
    this.busy = null;
    this.#checkOver();
  }

  #checkOver() {
    if (this.phase !== "playing" || this.state.winner === -1) return;
    this.phase = "over";
    this.emit("over", { winner: this.state.winner });
    this.#enqueue(() => this.#audit());
  }

  async #audit() {
    this.#busy("auditing");
    this.send({ t: "audit", key: toBase64(this.key.secret) });
    const secrets = [];
    for (let s = 0; s < this.players; s++) secrets[s] = s === this.me ? this.key.secret : await this.#wait(`audit:${s}`);
    const faces = [];
    this.verdict = await this.#judge(secrets, faces);
    if (this.verdict.ok) this.audited = faces;
    this.busy = null;
    this.emit("verified", this.verdict);
  }

  // Fills `faces` with every slot's face once the keys check out.
  async #judge(secrets, faces) {
    for (let s = 0; s < this.players; s++) {
      if (s !== this.me && !(await this.#job("checkSecret", secrets[s], this.contexts[s], this.pks[s]))) return { ok: false, reason: "revealed a key that isn't the one they played with", seat: s };
    }
    const unknown = this.slots.flatMap((slot, id) => (slot.face === null ? [id] : []));
    const found = await this.#job("faces", this.joint, secrets, unknown.map((id) => this.slots[id].card));
    faces.push(...this.slots.map((slot) => slot.face));
    unknown.forEach((id, i) => (faces[id] = found[i]));
    const first = faces.slice(0, this.rules.deckSize);
    if (new Set(first).size !== first.length || first.some((f) => !(f >= 0 && f < this.rules.deckSize))) return { ok: false, reason: "the deck wasn't one full deck" };
    return this.#replay(faces);
  }

  // The whole game again, with every face known to the rules.
  #replay(faces) {
    const slots = [];
    const table = () => new Table({ slots, players: this.players, face: (id) => faces[id], make: () => ({ owner: -1, open: false, gone: false }) });
    const settle = () => {
      for (let round = 0; this.rules.settle; round++) {
        if (round === MAX_SETTLE) throw new RuleError("settle kept dealing");
        const t = table();
        this.rules.settle(state, t);
        if (!t.ops.length) return;
      }
    };
    const start = table();
    start.cards = faces.slice(0, this.rules.deckSize).map(() => slots.push({ owner: -1, open: false, gone: false }) - 1);
    let state;
    try {
      state = this.rules.newState(this.first, this.players, start);
      settle();
    } catch (err) {
      return { ok: false, reason: `the deal broke the rules: ${err.message}` };
    }
    for (const { player, move } of this.log) {
      try {
        for (const id of this.rules.reveals?.(state, player, move) ?? []) slots[id].open = true;
        this.rules.applyMove(state, player, move, table());
        settle();
      } catch (err) {
        return { ok: false, reason: `broke the rules: ${err.message}`, seat: player };
      }
    }
    if (JSON.stringify(state) !== JSON.stringify(this.state)) return { ok: false, reason: "the game plays out differently with every card known" };
    return { ok: true };
  }
}

// Drive a robot over a session for a CardMatch game. choose(state, me, rng,
// face) returns a legal move; face(slot) is what this seat knows.
export function startCardRobot(session, { rules, choose, delay = 600, rng = Math.random }) {
  const router = matchRouter(session);
  let match = null;
  let timer = null;
  let destroyed = false;
  function schedule() {
    if (destroyed || timer || !match.canMove()) return;
    timer = setTimeout(() => {
      timer = null;
      if (!destroyed && match.canMove()) match.play(choose(match.state, match.me, rng, (slot) => match.face(slot)));
    }, robotPause(delay));
  }
  function newMatch(m) {
    match = new CardMatch({ send: (msg) => session.send(msg), me: session.index, players: session.players.length, rules, m });
    match.on("update", schedule);
    router.start(match);
  }
  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
