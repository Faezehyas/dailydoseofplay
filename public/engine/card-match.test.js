import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "./room.js";
import { CardMatch, startCardRobot } from "./card-match.js";
import { deckService } from "./deck-service.js";
import { rngFromSeed } from "./rng.js";
import { toBase64, fromBase64 } from "./base64.js";
import { RuleError } from "./turn-match.js";
import { makeRules, chooseMove, cheater } from "../../test/fixtures/toy-cards.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 60_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

// Wraps a session's send so a test can change, drop or watch what it sends.
function tap(session, change) {
  const send = session.send.bind(session);
  session.send = (msg) => {
    const out = change(msg);
    return out === null ? true : send(out ?? msg);
  };
}

// Robots in every seat; returns their matches once every one is done.
const done = (m) => m.verdict || m.phase === "aborted";

async function play({ players = 2, rules = makeRules({ deckSize: 10, maxTurns: 30 }), choose = () => chooseMove, before = () => {}, until: finished = (ms) => ms.every(done) } = {}) {
  const sessions = localRoom({ game: "toy", names: Array.from({ length: players }, (_, i) => `P${i}`) });
  const ref = {}; // ref.robots, for hooks that need the matches
  before(sessions, ref);
  const robots = sessions.map((s, i) => startCardRobot(s, { rules, choose: choose(i), delay: 0, rng: rngFromSeed(`seat${i}`) }));
  ref.robots = robots;
  await until(() => finished(robots.map((r) => r.match)));
  return { sessions, robots, matches: robots.map((r) => r.match) };
}

// Every face a seat knows is open to all or in its own hand.
function assertNoLeaks(match) {
  for (const [id, s] of match.slots.entries()) {
    if (s.face !== null && !s.gone) assert.ok(s.open || s.owner === match.me, `seat ${match.me} knows hidden slot ${id}`);
  }
}

test("two players: a full game, the same state everywhere, a passing audit and no leaks", async () => {
  const { matches } = await play();
  for (const m of matches) {
    assert.equal(m.phase, "over");
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
    assertNoLeaks(m);
  }
  assert.ok(matches[0].state.reshuffles > 0, "the discard pile was shuffled back in");
  assert.ok(matches[0].state.log.some(([, what]) => what === "play"));
});

test("four players: the same, with a bigger deck", async () => {
  const { matches } = await play({ players: 4, rules: makeRules({ deckSize: 24, hand: 4, maxTurns: 24 }) });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.state, matches[0].state);
    assertNoLeaks(m);
  }
  // Each player saw their own cards and nobody else's.
  const hands = matches[0].state.hands;
  for (const m of matches) {
    for (const [seat, hand] of hands.entries()) for (const slot of hand) assert.equal(m.face(slot) !== null, seat === m.me);
  }
});

test("the audit catches a rule only the full deck can check: drawing while holding a card that plays", async () => {
  // About one game in twelve gives the cheater no chance to cheat: play until one does.
  let cheat, matches;
  for (let game = 0; game < 5 && !cheat?.cheats(); game++) {
    cheat = cheater();
    ({ matches } = await play({ choose: (i) => (i === 1 ? cheat.choose : chooseMove) }));
  }
  assert.ok(cheat.cheats() > 0);
  for (const m of matches) {
    assert.equal(m.verdict.ok, false);
    assert.equal(m.verdict.seat, 1);
    assert.match(m.verdict.reason, /drew while holding a card that plays/);
  }
});

test("the audit flags rules whose state depends on a hidden face", async () => {
  const honest = makeRules({ deckSize: 10, maxTurns: 10 });
  const leaky = {
    ...honest,
    applyMove(state, player, move, deck) {
      state.peek = deck.face(state.hands[player][0]); // null in play, known in the audit
      return honest.applyMove(state, player, move, deck);
    },
  };
  const { matches } = await play({ rules: leaky });
  for (const m of matches) assert.deepEqual(m.verdict, { ok: false, reason: "the game plays out differently with every card known" });
});

// Every other seat stops, blaming `seat` itself or relaying someone's word about it.
async function aborted(options, seat) {
  const { matches } = await play(options);
  const others = matches.filter((m) => m.me !== seat);
  for (const m of others) {
    assert.equal(m.phase, "aborted", `seat ${m.me}`);
    assert.ok(m.abortSeat === seat || m.abortAbout === seat, `seat ${m.me} blames ${m.abortSeat} about ${m.abortAbout}`);
  }
  return others.map((m) => m.abortReason);
}

test("a tampered shuffle stops the match and names the shuffler", async () => {
  const reasons = await aborted(
    {
      before: (s) =>
        tap(s[1], (msg) => {
          if (msg.t !== "shuffle") return;
          const d = fromBase64(msg.d);
          d[20] ^= 1;
          return { ...msg, d: toBase64(d) };
        }),
    },
    1,
  );
  assert.match(reasons[0], /sent a shuffle that doesn't check out/);
});

test("with three players, everyone names the cheater, whether they caught it or were told", async () => {
  const { matches } = await play({
    players: 3,
    before: (s) =>
      tap(s[2], (msg) => {
        if (msg.t !== "shuffle") return;
        const d = fromBase64(msg.d);
        d[20] ^= 1;
        return { ...msg, d: toBase64(d) };
      }),
  });
  for (const m of matches.filter((m) => m.me !== 2)) {
    assert.equal(m.phase, "aborted");
    if (m.abortSeat === 2) assert.match(m.abortReason, /^sent a shuffle that doesn't check out/);
    else assert.deepEqual([m.abortAbout, m.abortReason], [2, "stopped the match: sent a shuffle that doesn't check out"]);
  }
});

test("a share for the wrong card stops the match", async () => {
  const reasons = await aborted({ before: (s) => tap(s[1], (msg) => (msg.t === "shares" && msg.d.length > 1 ? { ...msg, d: [msg.d[1], msg.d[0], ...msg.d.slice(2)] } : msg)) }, 1);
  assert.match(reasons[0], /sent a share that doesn't check out/);
});

test("a key made for another seat or match doesn't check out", async () => {
  const stray = await deckService().keygen("ddp-cards/1/m1/seat0/another match");
  const reasons = await aborted({ before: (s) => tap(s[1], (msg) => (msg.t === "hello" ? { ...msg, key: toBase64(stray.hello) } : msg)) }, 1);
  assert.match(reasons[0], /sent a key that doesn't check out/);
});

test("showing a card from someone else's hand stops the match", async () => {
  const reasons = await aborted(
    {
      before: (s, ref) =>
        tap(s[1], (msg) => {
          if (msg.t !== "move") return;
          const theirs = ref.robots[0].match.state.hands[0][0];
          return { ...msg, move: { play: theirs }, sh: [toBase64(new Uint8Array(131))] };
        }),
    },
    1,
  );
  assert.match(reasons[0], /broke the rules: a move can only show cards from your own hand/);
});

test("a move out of turn stops the match", async () => {
  const sessions = localRoom({ game: "toy", names: ["A", "B"] });
  const rules = makeRules({ deckSize: 10 });
  const [a, b] = sessions.map((s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 2, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => [a, b][i].receive(msg, from)));
  await until(() => a.phase === "playing" && b.phase === "playing");
  const idle = a.state.turn === 0 ? 1 : 0;
  sessions[idle].send({ t: "move", m: 1, move: { draw: true }, sh: [] });
  const other = [a, b][1 - idle];
  await until(() => other.phase === "aborted");
  assert.equal(other.abortSeat, idle);
  assert.match(other.abortReason, /moved out of turn/);
});

test("an illegal move of mine is refused locally and never sent", async () => {
  const sessions = localRoom({ game: "toy", names: ["A", "B"] });
  const rules = makeRules({ deckSize: 10 });
  const sent = [];
  sessions.forEach((s) => tap(s, (msg) => void sent.push([s.index, msg.t])));
  const [a, b] = sessions.map((s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 2, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => [a, b][i].receive(msg, from)));
  await until(() => a.phase === "playing" && b.phase === "playing");
  const mover = a.state.turn === 0 ? a : b;
  const invalid = [];
  mover.on("invalid", (why) => invalid.push(why));
  await mover.play({ play: mover.state.hands[1 - mover.me][0] });
  await mover.play({ fly: true });
  assert.deepEqual(invalid, ["a move can only show cards from your own hand", "bad move"]);
  assert.ok(!sent.some(([seat, t]) => seat === mover.me && t === "move"));
  assert.equal(mover.phase, "playing");
});

test("revealing a different key at the end fails the audit", async () => {
  const { matches } = await play({ before: (s) => tap(s[1], (msg) => (msg.t === "audit" ? { ...msg, key: toBase64(new Uint8Array(32).fill(9)) } : msg)) });
  assert.deepEqual(matches[0].verdict, { ok: false, reason: "revealed a key that isn't the one they played with", seat: 1 });
});

test("rematch: a new match with fresh keys, a new shuffle and a passing audit", async () => {
  const { sessions, robots } = await play();
  const first = robots.map((r) => r.match);
  sessions.forEach((s) => s.requestRematch());
  await until(() => robots.every((r) => r.match.m === 2 && r.match.verdict));
  for (const [i, r] of robots.entries()) {
    assert.deepEqual(r.match.verdict, { ok: true });
    assert.notDeepEqual(r.match.key.hello, first[i].key.hello);
  }
});

test("rules errors in the deal surface as a stopped match, not a hang", async () => {
  const rules = { ...makeRules({ deckSize: 4 }), newState: () => { throw new RuleError("no deal"); } };
  const sessions = localRoom({ game: "toy", names: ["A", "B"] });
  const robots = sessions.map((s) => startCardRobot(s, { rules, choose: chooseMove, delay: 0 }));
  await until(() => robots.every((r) => r.match.phase === "aborted"));
  assert.match(robots[0].match.abortReason, /no deal/);
});

test("the wire never carries the share that would open a card still hidden in someone's hand", async () => {
  const wire = [];
  const { matches } = await play({
    players: 3,
    rules: makeRules({ deckSize: 15, maxTurns: 12 }),
    before: (s) =>
      s.forEach((session) =>
        tap(session, (msg) => {
          if (msg.t === "shares") wire.push(...msg.d);
          if (msg.t === "move") wire.push(...msg.sh);
        }),
      ),
  });
  // A share starts with its token, 33 bytes: 44 base64 characters that don't depend on the proof.
  const tokens = new Set(wire.map((b64) => b64.slice(0, 44)));
  let hidden = 0;
  for (const m of matches) {
    for (const slot of m.state.hands[m.me]) {
      const [mine] = await deckService().shares(m.key.secret, [m.slots[slot].card]);
      assert.ok(!tokens.has(toBase64(mine).slice(0, 44)), `seat ${m.me}'s share of slot ${slot} went out`);
      hidden++;
    }
  }
  assert.ok(hidden > 0);
});

test("a message sent twice stops the match", async () => {
  const reasons = await aborted({ before: (s) => tap(s[1], (msg) => void (msg.t === "hello" && s[1].group.send(msg))) }, 1);
  assert.match(reasons[0], /sent the same hello message twice/);
});

test("a round with a share missing stops the match", async () => {
  const reasons = await aborted({ before: (s) => tap(s[1], (msg) => (msg.t === "shares" && msg.d.length > 1 ? { ...msg, d: msg.d.slice(1) } : msg)) }, 1);
  assert.match(reasons[0], /sent 2 shares where 3 were due/);
});

test("parts that disagree on how many there are stop the match", async () => {
  const reasons = await aborted({ before: (s) => tap(s[1], (msg) => (msg.t === "shuffle" && msg.i === 1 ? { ...msg, n: msg.n + 1 } : msg)) }, 1);
  assert.match(reasons[0], /sent parts that don't add up/);
});

test("a flood of messages ahead is blamed on whoever sent it", async () => {
  const sessions = localRoom({ game: "toy", names: ["A", "B", "C"] });
  const rules = makeRules({ deckSize: 10 });
  const matches = sessions.map((s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 3, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => matches[i].receive(msg, from)));
  for (let k = 50; k < 80; k++) for (let i = 0; i < 10; i++) sessions[2].send({ t: "shuffle", m: 1, k, i, n: 10, d: "AAAA" });
  await until(() => matches[0].phase === "aborted" && matches[1].phase === "aborted");
  for (const m of matches.slice(0, 2)) assert.ok(m.abortSeat === 2 || m.abortAbout === 2, `seat ${m.me} blames ${m.abortSeat}`);
  assert.match(matches[0].abortReason + matches[1].abortReason, /sent too many messages ahead/);
});

test("stopping during the audit leaves no verdict", async () => {
  const { matches } = await play({
    before: (s) => tap(s[1], (msg) => (msg.t === "audit" ? { t: "abort", m: msg.m, reason: "no" } : msg)),
    until: ([m]) => done(m),
  });
  assert.equal(matches[0].phase, "aborted");
  assert.equal(matches[0].verdict, null);
  assert.equal(matches[0].abortReason, "stopped the match: no");
});

test("a settle that never stops dealing stops the match", async () => {
  const honest = makeRules({ deckSize: 80 });
  const rules = { ...honest, settle: (state, deck) => void deck.open(state.draw.shift()) };
  const sessions = localRoom({ game: "toy", names: ["A", "B"] });
  const robots = sessions.map((s) => startCardRobot(s, { rules, choose: chooseMove, delay: 0 }));
  await until(() => robots.every((r) => r.match.phase === "aborted"));
  assert.match(robots[0].match.abortReason, /settle kept dealing/);
});

// Two-card poker without betting: fold (your hand is shuffled back) or show it.
const showdown = {
  deckSize: 12,
  newState(first, players, deck) {
    const draw = deck.cards.slice();
    const hands = Array.from({ length: players }, (_, p) => [draw.shift(), draw.shift()].map((slot) => (deck.deal(slot, p), slot)));
    return { turn: first, winner: -1, players, draw, hands, shown: [], folds: 0 };
  },
  applyMove(state, player, move, deck) {
    if (state.turn !== player) throw new RuleError("not your turn");
    if (move.fold) {
      state.draw.push(...deck.shuffle(state.hands[player]));
      state.hands[player] = [];
      state.folds++;
    } else {
      state.hands[player].forEach((slot) => deck.open(slot));
      state.shown.push(player);
    }
    if (state.folds + state.shown.length === state.players) state.winner = state.shown[0] ?? 0;
    else state.turn = (player + 1) % state.players;
    return [];
  },
};

test("a dealt hand can be opened to everyone, or shuffled back into the deck", async () => {
  const { matches } = await play({ players: 3, rules: showdown, choose: (i) => () => (i === 1 ? { fold: true } : { show: true }) });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.equal(m.state.folds, 1);
    for (const p of m.state.shown) for (const slot of m.state.hands[p]) assert.notEqual(m.face(slot), null, `seat ${m.me} sees seat ${p}'s shown card`);
    assertNoLeaks(m);
  }
  const folded = matches[0].slots.filter((s) => s.gone && s.owner === 1).length;
  assert.equal(folded, 2, "the folded hand's old slots are gone");
});

test("a card played face up can then be passed to the next player", async () => {
  const honest = makeRules({ deckSize: 10, maxTurns: 10 });
  const passing = {
    ...honest,
    applyMove(state, player, move, deck) {
      const events = honest.applyMove(state, player, move, deck);
      if (Number.isInteger(move.play) && state.winner === -1) {
        state.discard.pop();
        deck.deal(move.play, state.turn);
        state.hands[state.turn].push(move.play);
      }
      return events;
    },
  };
  const { robots, matches } = await play({ rules: passing });
  assert.ok(robots.every((r) => r.match.verdict?.ok), JSON.stringify(matches.map((m) => m.verdict ?? m.abortReason)));
  assert.ok(matches[0].state.log.some(([, what]) => what === "play"), "a card was played and passed");
});

test("the largest deck: 200 cards dealt and then all opened in one round", { timeout: 120_000 }, async () => {
  const rules = {
    deckSize: 200,
    newState(first, players, deck) {
      deck.cards.forEach((slot, i) => deck.deal(slot, i % players));
      deck.cards.forEach((slot) => deck.open(slot));
      return { turn: first, winner: first };
    },
    applyMove: () => [],
  };
  const { matches } = await play({ rules });
  for (const m of matches) {
    assert.deepEqual(m.verdict, { ok: true });
    assert.deepEqual(m.slots.map((s) => s.face).sort((a, b) => a - b), [...Array(200).keys()]);
  }
});

// A slower device: each of this match's deck jobs takes `ms` longer; before(op) runs as a job starts.
function slow(match, ms, before = () => {}) {
  const deck = match.deck;
  match.deck = Object.fromEntries(
    Object.keys(deck).map((op) => [
      op,
      async (...args) => {
        before(op);
        const value = await deck[op](...args);
        await new Promise((r) => setTimeout(r, ms));
        return value;
      },
    ]),
  );
}

function seated(players, rules) {
  const sessions = localRoom({ game: "toy", names: Array.from({ length: players }, (_, i) => `P${i}`) });
  const matches = sessions.map((s) => new CardMatch({ send: (msg) => s.send(msg), me: s.index, players, rules }));
  sessions.forEach((s, i) => s.onMessage((msg, from) => matches[i].receive(msg, from)));
  return { sessions, matches };
}

test("a match stopped while a deck job runs stays stopped", async () => {
  const { sessions, matches } = seated(2, makeRules({ deckSize: 10 }));
  const [a] = matches;
  const events = [];
  for (const e of ["abort", "start", "verified"]) a.on(e, () => events.push(e));
  const sent = [];
  tap(sessions[0], (msg) => void sent.push(msg.t));
  slow(a, 20, (op) => op === "joinKeys" && sessions[1].send({ t: "audit", m: 1, key: "not a key" }));
  await until(() => a.phase === "aborted");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(a.phase, "aborted");
  assert.deepEqual(events, ["abort"]);
  assert.equal(sent.at(-1), "abort", "nothing sent after stopping");
});

test("a match stopped during the audit's deck work gets no verdict", async () => {
  const { sessions, matches } = seated(2, makeRules({ deckSize: 10, maxTurns: 2 }));
  const [a] = matches;
  const verified = [];
  a.on("verified", (v) => verified.push(v));
  slow(a, 20, (op) => op === "faces" && sessions[1].send({ t: "abort", m: 1, reason: "late" }));
  const robots = matches.map((m) => () => m.canMove() && m.play(chooseMove(m.state, m.me, Math.random, (slot) => m.face(slot))));
  matches.forEach((m, i) => m.on("update", robots[i]));
  await until(() => a.phase === "aborted");
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual([a.phase, a.verdict, verified], ["aborted", null, []]);
});

test("a slow seat that only receives cards can fall far behind without blaming anyone", { timeout: 120_000 }, async () => {
  const rules = {
    deckSize: 150,
    newState: (first, players, deck) => ({ turn: 0, winner: -1, draw: deck.cards.slice(), given: 0 }),
    applyMove(state, player, move, deck) {
      if (player !== 0) throw new RuleError("not your turn");
      deck.deal(state.draw.shift(), 2);
      if (++state.given === 140) state.winner = 0;
      return [];
    },
  };
  const { matches } = seated(3, rules);
  slow(matches[2], 15);
  matches[0].on("update", () => matches[0].canMove() && matches[0].play({ give: true }));
  await until(() => matches.every(done), 110_000);
  for (const m of matches) assert.deepEqual(m.verdict, { ok: true }, `seat ${m.me}: ${m.abortReason}`);
});

test("a card shown with the share of another card stops the match", async () => {
  let swapped = 0;
  const reasons = await aborted(
    {
      rules: makeRules({ deckSize: 12, hand: 4, maxTurns: 30 }),
      before: (s, ref) => {
        const send = s[1].send.bind(s[1]);
        s[1].send = (msg) => {
          const m = ref.robots[1].match;
          const other = msg.t === "move" && msg.sh.length ? m.state.hands[1].find((slot) => slot !== msg.move.play && !m.slots[slot].open) : undefined;
          if (other === undefined) return send(msg);
          swapped++;
          deckService().shares(m.key.secret, [m.slots[other].card]).then(([sh]) => send({ ...msg, sh: [toBase64(sh)] }));
          return true;
        };
      },
    },
    1,
  );
  assert.ok(swapped > 0);
  assert.match(reasons[0], /sent a share that doesn't check out/);
});

test("a move may show at most 16 hidden cards", async () => {
  const rules = {
    deckSize: 40,
    newState: (first, players, deck) => ({ turn: first, winner: -1, hands: [0, 1].map((p) => deck.cards.filter((_, i) => i % 2 === p).map((slot) => (deck.deal(slot, p), slot))) }),
    reveals: (state, player, move) => state.hands[player].slice(0, move.show),
    applyMove: (state) => ((state.winner = state.turn), []),
  };
  const { matches } = seated(2, rules);
  await until(() => matches.every((m) => m.phase === "playing"));
  const mover = matches.find((m) => m.canMove());
  const invalid = [];
  mover.on("invalid", (why) => invalid.push(why));
  await mover.play({ show: 17 });
  assert.deepEqual(invalid, ["a move can show at most 16 hidden cards"]);
  await mover.play({ show: 16 });
  await until(() => matches.every(done));
  for (const m of matches) assert.deepEqual(m.verdict, { ok: true });
});

test("a hidden card can't change hands: refused in my browser, and stops the match if sent anyway", async () => {
  // Passing would let a third player read it: everyone else's shares of it went out when it was dealt.
  const rules = {
    deckSize: 8,
    newState: (first, players, deck) => ({ turn: first, winner: -1, hands: [0, 1, 2].map((p) => [deck.cards[p]].map((slot) => (deck.deal(slot, p), slot))) }),
    applyMove(state, player, move, deck) {
      deck.deal(state.hands[player].pop(), (player + 1) % 3);
      return [];
    },
  };
  const { sessions, matches } = seated(3, rules);
  await until(() => matches.every((m) => m.phase === "playing"));
  const mover = matches.find((m) => m.canMove());
  const invalid = [];
  mover.on("invalid", (why) => invalid.push(why));
  await mover.play({ pass: true });
  assert.deepEqual(invalid, ["a hidden card can't change hands"]);
  sessions[mover.me].send({ t: "move", m: 1, move: { pass: true }, sh: [] });
  const others = matches.filter((m) => m !== mover);
  await until(() => others.every((m) => m.phase === "aborted"));
  for (const m of others) {
    assert.ok(m.abortSeat === mover.me || m.abortAbout === mover.me);
    assert.match(m.abortReason, /broke the rules: a hidden card can't change hands/);
  }
});

test("reading the face of a card opened in the same call is a bug in the rules, and says so", async () => {
  const honest = makeRules({ deckSize: 10 });
  const rules = {
    ...honest,
    settle(state, deck) {
      if (state.discard.length) return [];
      const top = state.draw.shift();
      deck.open(top);
      state.topFace = deck.face(top); // too early: the shares come after this call
      state.discard.push(top);
      return [];
    },
  };
  const { matches } = seated(2, rules);
  const errors = console.error;
  console.error = () => {};
  try {
    await until(() => matches.every((m) => m.phase === "aborted"));
  } finally {
    console.error = errors;
  }
  for (const m of matches) {
    assert.match(m.abortReason, /was opened in this call; read its face in a later call/);
    assert.equal(m.abortAbout, undefined, "a rules bug is nobody's cheat");
  }
  assert.ok(matches.some((m) => m.abortSeat === undefined), "the browser that hit it blames nobody");
});
