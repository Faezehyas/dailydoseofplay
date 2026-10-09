// Crazy Eights over the real card engine: robots in every seat of a
// localRoom(), each running its own CardMatch, shuffling with proofs and
// auditing at the end.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "../engine/room.js";
import { CardMatch } from "../engine/card-match.js";
import { matchRouter } from "../engine/session.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, playable, canDraw } from "./rules.js";
import { chooseMove, startRobot } from "./robot.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 280_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}
const done = (m) => m.verdict || m.phase === "aborted";

// Every face a seat knows is open to all or in its own hand.
function assertNoLeaks(match) {
  for (const [id, s] of match.slots.entries()) {
    if (s.face !== null && !s.gone) assert.ok(s.open || s.owner === match.me, `seat ${match.me} knows hidden slot ${id}`);
  }
}

async function play({ players, config = {}, choose = () => (st, me, rng, face) => chooseMove(st, me, rng, face, { level: "hard" }) }) {
  const sessions = localRoom({ game: "crazy-eights", names: Array.from({ length: players }, (_, i) => `P${i}`), mode: "friend" });
  const rules = makeRules(config);
  const robots = [];
  for (const [i, s] of sessions.entries()) robots.push(startRobot(s, { rules, choose: choose(i, () => robots[i].match), delay: () => 0, rng: rngFromSeed(`seat ${i} ${players}`) }));
  let checks = 0;
  for (const r of robots) {
    r.match.on("update", () => {
      assertNoLeaks(r.match);
      checks++;
    });
  }
  try {
    await until(() => robots.every((r) => done(r.match)));
  } finally {
    for (const r of robots) r.destroy();
  }
  return { matches: robots.map((r) => r.match), checks };
}

for (const players of [2, 4]) {
  test(`${players} seats: a full game, the same state everywhere, a passing audit and no seat ever knowing another's hidden card`, { timeout: 300_000 }, async () => {
    const { matches, checks } = await play({ players, config: { actions: players === 4 } });
    for (const m of matches) {
      assert.equal(m.phase, "over", m.abortReason);
      assert.deepEqual(m.verdict, { ok: true });
      assert.deepEqual(m.state, matches[0].state);
    }
    const st = matches[0].state;
    // Every seat applies every move in a step that ends with an update. A fixed
    // count would be flaky: the deal is random and a 2-seat game can take 13 moves.
    assert.ok(checks >= players * st.plays.reduce((a, b) => a + b), "checked as the game went");
    assert.ok(st.winner >= 0 && st.winner < players);
    assert.equal(st.players, players);
    assert.ok(st.plays.every((n) => n > 0), "everyone played");
    // After the audit every seat can show every hand, for the standings.
    for (const m of matches) for (const hand of st.hands) for (const slot of hand) assert.notEqual(m.face(slot), null);
  });
}

test("a seat out of turn can't move: refused at home, and stops the match if sent anyway", { timeout: 60_000 }, async () => {
  const sessions = localRoom({ game: "crazy-eights", names: ["A", "B", "C"], mode: "friend" });
  const rules = makeRules({ first: "host" });
  const matches = sessions.map((s) => {
    const m = new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 3, rules });
    matchRouter(s).start(m);
    return m;
  });
  await until(() => matches.every((m) => m.phase === "playing"));
  assert.equal(matches[0].state.turn, 0);
  const invalid = [];
  matches[2].on("invalid", (why) => invalid.push(why));
  await matches[2].play({ draw: true });
  assert.deepEqual(invalid, ["not your turn"]);
  sessions[2].send({ t: "move", m: 1, move: { draw: true }, sh: [] });
  await until(() => matches[0].phase === "aborted" && matches[1].phase === "aborted");
  for (const m of matches.slice(0, 2)) {
    assert.ok(m.abortSeat === 2 || m.abortAbout === 2);
    assert.match(m.abortReason, /moved out of turn/);
  }
});

// Draws whenever it can, even holding a card that plays, as long as no other
// browser can see that card (a face-up 8 from the stock's bottom would give
// it away at once); counts the times it did.
function cheater(match) {
  let n = 0;
  const choose = (st, me, rng, face) => {
    const plays = playable(st, me, face);
    if (canDraw(st) && plays.length && plays.every((slot) => !match().slots[slot].open)) {
      n++;
      return { draw: true };
    }
    return chooseMove(st, me, rng, face, { level: "easy" });
  };
  return { choose, cheats: () => n };
}

test("drawing while holding a card that plays goes unseen in play and is caught by the audit", { timeout: 300_000 }, async () => {
  let cheat;
  const { matches } = await play({ players: 2, choose: (i, match) => (i === 1 ? (cheat = cheater(match)).choose : (st, me, rng, face) => chooseMove(st, me, rng, face, { level: "easy" })) });
  assert.ok(cheat.cheats() > 0);
  for (const m of matches) {
    assert.equal(m.phase, "over", "nobody could tell during the game");
    assert.equal(m.verdict.ok, false);
    assert.equal(m.verdict.seat, 1);
    assert.match(m.verdict.reason, /drew while holding a card that plays/);
  }
});

test("with the rule off, the same draws are fair play", { timeout: 300_000 }, async () => {
  let cheat;
  const { matches } = await play({ players: 2, config: { strict: false }, choose: (i, match) => (i === 1 ? (cheat = cheater(match)).choose : (st, me, rng, face) => chooseMove(st, me, rng, face, { level: "easy" })) });
  assert.ok(cheat.cheats() > 0);
  for (const m of matches) assert.deepEqual(m.verdict, { ok: true });
});

test("a robot whose move is refused plays the timer's move instead of trying it again", { timeout: 300_000 }, async () => {
  let refusals = 0;
  // Seat 1 always tries to pass first, which is only rarely allowed.
  const { matches } = await play({
    players: 2,
    choose: (i) => (st, me, rng, face) => {
      if (i === 1 && st.drew === 0) {
        refusals++;
        return { pass: true };
      }
      return chooseMove(st, me, rng, face, { level: "easy" });
    },
  });
  assert.ok(refusals > 0);
  for (const m of matches) assert.deepEqual(m.verdict, { ok: true }, "the game finished");
});
