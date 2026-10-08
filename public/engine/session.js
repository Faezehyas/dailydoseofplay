// A Session is what a game receives: the seated players of one room, joined
// by a group (see group.js), plus the engine-level plumbing every game needs
// (names, rematch votes, goodbye). It is DOM-free so games and robots can be
// tested headless.
//
// Engine messages use a "$" prefix: $bye and $rematch during the game, and
// the handshake below before it. Everything else is a game message and is
// handed to session.onMessage handlers as (msg, fromSeat), buffered until the
// game registers one.
import { Emitter, MESSAGE_TOO_BIG } from "./channel.js";
import { HubGroup, SpokeGroup } from "./group.js";
import { cleanName } from "./names.js";

export const PROTOCOL_VERSION = 2;
const HELLO_TIMEOUT_MS = 10_000;

export class Session extends Emitter {
  // players: names by seat; group.seat is mine.
  constructor({ group, mode, players, game }) {
    super();
    this.group = group;
    this.mode = mode; // "friend" | "robot"
    this.index = group.seat; // 0 = host (room creator)
    this.role = this.index === 0 ? "host" : "guest";
    this.players = players.map((name, seat) => ({ seat, name }));
    this.me = this.players[this.index];
    this.others = this.players.filter((p) => p.seat !== this.index);
    this.opponent = this.others[0]; // two-player games
    this.game = game;
    this.ended = false;
    this.votes = new Set();
    this.handlers = [];
    this.buffer = [];
    this.offs = [
      group.on("message", (msg, from) => this.#onMessage(msg, from)),
      group.on("leave", (seat, why) => this.#end(why === MESSAGE_TOO_BIG ? why : "closed", seat)),
      // Only a spoke is ever cut off from the group: the hub went away.
      group.on("close", (why) => this.#end(why === MESSAGE_TOO_BIG ? why : "closed", 0)),
    ];
  }

  #onMessage(msg, from) {
    if (!msg || typeof msg.t !== "string" || from === this.index || !this.players[from]) return;
    switch (msg.t) {
      case "$bye":
        return this.#end("left", from);
      case "$rematch":
        this.votes.add(from);
        this.#emitVotes();
        return this.#maybeRematch();
      default:
        if (msg.t.startsWith("$")) return;
        if (this.handlers.length === 0) this.buffer.push([msg, from]);
        else for (const fn of this.handlers) fn(msg, from);
    }
  }

  onMessage(fn) {
    this.handlers.push(fn);
    for (const [msg, from] of this.buffer.splice(0)) fn(msg, from);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== fn);
    };
  }

  send(msg) {
    if (this.ended) return false;
    return this.group.send(msg);
  }

  // me: I voted; them: someone else did; seats: everyone who did.
  #emitVotes() {
    const seats = [...this.votes].sort((a, b) => a - b);
    this.emit("rematch", { me: this.votes.has(this.index), them: seats.some((s) => s !== this.index), seats });
  }

  requestRematch() {
    if (this.ended || this.votes.has(this.index)) return;
    this.votes.add(this.index);
    this.group.send({ t: "$rematch" });
    this.#emitVotes();
    this.#maybeRematch();
  }

  #maybeRematch() {
    if (this.votes.size === this.players.length) {
      this.votes.clear();
      this.emit("rematch-start");
    }
  }

  // Any player leaving ends the session for everyone (the match can't go on
  // without their moves and shared draws). seat: who left. reason: "left"
  // ($bye), "closed" (connection lost), MESSAGE_TOO_BIG (their browser sent
  // an oversized message) or "self".
  #end(reason, seat) {
    if (this.ended) return;
    this.ended = true;
    for (const off of this.offs.splice(0)) off();
    this.emit("end", reason, seat);
  }

  // Leave on purpose: tell the others, then close the transport.
  leave() {
    if (this.ended) return;
    this.group.send({ t: "$bye" });
    this.#end("self", this.index);
    setTimeout(() => this.group.close(), 50);
  }
}

// ---------- handshake: links -> a seated group -> Sessions ----------
//
//   guest -> host  $hello {name, game, v}
//   host -> guest  $welcome, or $reject {reason}
//   host -> guest  $roster {players}      while the host waits for more players
//   host -> guest  $start {seat, players} then group frames (group.js)

function listen(link, onMessage, reject, timeoutMs = HELLO_TIMEOUT_MS) {
  const timer = setTimeout(() => fail(new Error("hello_timeout")), timeoutMs);
  const offs = [
    link.on("message", (msg) => onMessage(msg, api)),
    link.on("close", (reason) => fail(new Error(reason === MESSAGE_TOO_BIG ? reason : "closed"))),
  ];
  function done() {
    clearTimeout(timer);
    for (const off of offs.splice(0)) off();
  }
  function fail(err) {
    done();
    reject(err);
  }
  const api = { done, fail, settle: () => clearTimeout(timer) };
  return api;
}

// Host side, on a fresh link: resolves to the guest's name once its $hello
// checks out.
export function admitGuest(link, { game }) {
  return new Promise((resolve, reject) => {
    listen(link, (msg, { done }) => {
      if (msg?.t !== "$hello") return;
      done();
      if (msg.game !== game || msg.v !== PROTOCOL_VERSION) {
        link.send({ t: "$reject", reason: "version_mismatch" });
        return reject(new Error("version_mismatch"));
      }
      link.send({ t: "$welcome" });
      resolve(cleanName(msg.name, "Friend"));
    }, reject);
  });
}

// Host side: seat the admitted guests in order and start. guests: [{ link, name }].
export function startHub({ name, guests, game, mode = "friend" }) {
  const players = [name, ...guests.map((g) => g.name)];
  const group = new HubGroup({ links: guests.map((g, i) => [i + 1, g.link]) });
  const session = new Session({ group, mode, players, game });
  guests.forEach((g, i) => g.link.send({ t: "$start", seat: i + 1, players }));
  return session;
}

export function sendRoster(guests, players) {
  for (const g of guests) g.link.send({ t: "$roster", players });
}

// Guest side, on a fresh link to the host: resolves to a Session when the
// host starts. onWelcome() and onRoster(names) report progress until then.
export function greetHost(link, { name, game, mode = "friend", onWelcome, onRoster }) {
  return new Promise((resolve, reject) => {
    listen(link, (msg, { done, fail, settle }) => {
      switch (msg?.t) {
        case "$welcome":
          settle(); // the host may wait for more players: no timeout from here
          return onWelcome?.();
        case "$roster":
          return Array.isArray(msg.players) && onRoster?.(msg.players.map((p) => cleanName(p, "Friend")));
        case "$reject":
          return fail(new Error(msg.reason === "version_mismatch" ? "version_mismatch" : "rejected"));
        case "$start": {
          done();
          const players = Array.isArray(msg.players) ? msg.players.map((p) => cleanName(p, "Friend")) : [];
          if (!Number.isInteger(msg.seat) || msg.seat < 1 || msg.seat >= players.length) return reject(new Error("bad_start"));
          // Built synchronously, so no group frame that follows $start is missed.
          return resolve(new Session({ group: new SpokeGroup({ seat: msg.seat, link }), mode, players, game }));
        }
      }
    }, reject);
    link.send({ t: "$hello", name, game, v: PROTOCOL_VERSION });
  });
}

// Both ends of one two-ended channel (e.g. localPair() in tests): index 0
// hosts, index 1 joins, and the game starts as soon as both are in.
export async function openSession({ channel, mode, index, name, game }) {
  if (index !== 0) return greetHost(channel, { name, game, mode });
  const guest = await admitGuest(channel, { game });
  return startHub({ name, guests: [{ link: channel, name: guest }], game, mode });
}

// Routes a session's game messages to the current match by match number `m`
// and holds messages for a match that does not exist yet (rematch races).
export function matchRouter(session) {
  let current = null;
  let future = [];
  session.onMessage((msg, from) => {
    if (current && msg.m === current.m) current.receive(msg, from);
    else if (!current || msg.m > current.m) future.push([msg, from]);
  });
  return {
    start(match) {
      current = match;
      const now = future.filter(([msg]) => msg.m === match.m);
      future = future.filter(([msg]) => msg.m > match.m);
      for (const [msg, from] of now) match.receive(msg, from);
    },
  };
}
