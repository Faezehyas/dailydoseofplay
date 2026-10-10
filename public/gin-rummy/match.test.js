// Gin Rummy over the real card engine: a robot in each seat of a localRoom(),
// each running its own CardMatch, shuffling with proofs (again before every
// hand) and auditing at the end. Both seats end on the same state, the audit
// passes, and no seat ever knows a card that isn't open or its own.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "../engine/room.js";
import { CardMatch } from "../engine/card-match.js";
import { matchRouter } from "../engine/session.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, bestKnock } from "./rules.js";
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

async function play({ config = {}, levels = ["hard", "medium"] }) {
  const sessions = localRoom({ game: "gin-rummy", names: ["P0", "P1"], mode: "friend" });
  const rules = makeRules(config);
  const robots = sessions.map((s, i) => startRobot(s, { rules, choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: levels[i] }), delay: () => 0, rng: rngFromSeed(`seat ${i} ${JSON.stringify(config)}`) }));
  let checks = 0;
  let knocks = 0;
  for (const r of robots) {
    r.match.on("update", () => {
      assertNoLeaks(r.match);
      checks++;
    });
    r.match.on("events", ({ events }) => (knocks += events.filter((e) => e.type === "knock").length));
  }
  try {
    await until(() => robots.every((r) => done(r.match)));
  } finally {
    for (const r of robots) r.destroy();
  }
  return { matches: robots.map((r) => r.match), checks, knocks: knocks / 2 };
}

for (const config of [{ target: 0 }, { target: 100, knock: "oklahoma", bigGin: true }]) {
  test(`${JSON.stringify(config)}: a full game, the same state in both seats, a passing audit and no seat ever knowing a hidden card`, { timeout: 300_000 }, async () => {
    const { matches, checks, knocks } = await play({ config });
    for (const m of matches) {
      assert.equal(m.phase, "over", m.abortReason);
      assert.deepEqual(m.verdict, { ok: true });
      assert.deepEqual(m.state, matches[0].state);
    }
    const st = matches[0].state;
    assert.ok(checks >= 2 * st.moves, "checked as the game went");
    assert.ok(knocks >= st.history.filter((h) => h.kind !== "draw").length);
    if (config.target) {
      assert.ok(Math.max(...st.scores) >= 100);
      // Usually several hands, each from a deck shuffled again into new slots (one big gin can end it sooner).
      assert.equal(st.cards.every((s) => s >= 52), st.history.length > 1);
    }
    // Once the audit has passed, each seat sees every card: the deck was one full deck each hand.
    for (const m of matches) assert.deepEqual(st.cards.map((s) => m.face(s)).sort((a, b) => a - b), [...Array(52).keys()]);
  });
}

test("a seat out of turn can't move: refused at home, and stops the match if sent anyway", { timeout: 60_000 }, async () => {
  const sessions = localRoom({ game: "gin-rummy", names: ["A", "B"], mode: "friend" });
  const rules = makeRules({ dealer: "host" });
  const matches = sessions.map((s) => {
    const m = new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 2, rules });
    matchRouter(s).start(m);
    return m;
  });
  await until(() => matches.every((m) => m.phase === "playing"));
  assert.deepEqual([matches[0].state.turn, matches[0].state.phase], [1, "upcard"], "the non-dealer is offered the upcard");
  const invalid = [];
  matches[0].on("invalid", (why) => invalid.push(why));
  await matches[0].play({ take: true });
  assert.deepEqual(invalid, ["not your turn"]);
  sessions[0].send({ t: "move", m: 1, move: { take: true }, sh: [] });
  await until(() => matches[1].phase === "aborted");
  assert.ok(matches[1].abortSeat === 0 || matches[1].abortAbout === 0);
  assert.match(matches[1].abortReason, /moved out of turn/);
});

test("a knock over the limit is refused at home, and a card from the other hand can't be shown", { timeout: 60_000 }, async () => {
  const sessions = localRoom({ game: "gin-rummy", names: ["A", "B"], mode: "friend" });
  const rules = makeRules({ dealer: "host" });
  const matches = sessions.map((s) => {
    const m = new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 2, rules });
    matchRouter(s).start(m);
    return m;
  });
  await until(() => matches.every((m) => m.phase === "playing"));
  const b = matches[1];
  const invalid = [];
  b.on("invalid", (why) => invalid.push(why));
  await b.play({ take: true });
  await until(() => matches[0].state.phase === "discard");
  // A knock is checked on every card it shows; a fresh deal is almost never within 10.
  const k = bestKnock(b.state, 1, (s) => b.face(s));
  if (k.points > b.state.limit) {
    await b.play({ discard: k.discard, knock: true });
    assert.match(invalid.at(-1), /at most, not \d+/);
  }
  await b.play({ discard: matches[0].state.hands[0][0] });
  assert.match(invalid.at(-1), /only show cards from your own hand/);
  assert.deepEqual([b.state.phase, matches[0].state.phase, matches[0].phase], ["discard", "discard", "playing"], "nothing reached the other seat");
});
