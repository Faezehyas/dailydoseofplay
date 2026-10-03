import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { TurnMatch } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, DRAW } from "./rules.js";
import { chooseMove, startRobot } from "./robot.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 20_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

async function sessions() {
  const [x, y] = localPair();
  return Promise.all([
    openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "dots-and-boxes" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "dots-and-boxes" }),
  ]);
}

async function pair(rules) {
  const [ha, hb] = await sessions();
  const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules });
  const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules });
  matchRouter(ha).start(a);
  matchRouter(hb).start(b);
  await until(() => a.phase === "playing" && b.phase === "playing");
  return [a, b];
}

// Whoever may move plays a robot's line (with `ms` when the game is timed).
async function playOut(a, b, levels, ms) {
  const rng = rngFromSeed("wire");
  let extra = 0;
  while (a.phase === "playing") {
    const mover = a.canMove() ? a : b.canMove() ? b : null;
    if (!mover) {
      await tick();
      continue;
    }
    const before = mover.state.drawn;
    const move = chooseMove(mover.state, mover.me, rng, { level: levels[mover.me] });
    await mover.play(ms === undefined ? move : { ...move, ms });
    await until(() => (a.state.drawn > before && b.state.drawn > before && !a.working && !b.working) || a.phase === "aborted");
    assert.deepEqual(a.state.lines, b.state.lines);
    if (a.state.last.boxes.length && a.phase === "playing") {
      assert.equal(a.state.turn, mover.me, "closing a box keeps the turn on both sides");
      extra++;
    }
  }
  await until(() => b.phase === a.phase);
  return extra;
}

test("two peers agree on the coin toss, every line and every extra turn, through full games", async () => {
  for (const size of [3, 5]) {
    const [a, b] = await pair(makeRules({ size, moveSeconds: 0, gameSeconds: 0 }));
    assert.equal(a.state.first, b.state.first);
    const extra = await playOut(a, b, ["medium", "hard"]);
    assert.ok(extra > 0, "someone closed a box and went again");
    assert.equal(a.phase, "over");
    assert.deepEqual(a.state, b.state);
    assert.equal(a.state.score[0] + a.state.score[1], size * size);
    assert.notEqual(a.state.winner, -1);
  }
});

test("timed lines: both peers take the same time off the same clock", async () => {
  const [a, b] = await pair(makeRules({ size: 3, moveSeconds: 10, gameSeconds: 60, first: "host" }));
  await playOut(a, b, ["easy", "easy"], 250);
  assert.deepEqual(a.state, b.state);
  const lines = a.state.drawn;
  const [mine, theirs] = [0, 1].map((p) => a.state.lines.filter((x) => x === p).length);
  assert.equal(mine + theirs, lines);
  assert.deepEqual(a.state.clocks, [60_000 - 250 * mine, 60_000 - 250 * theirs]);
});

test("a timeout over the wire ends the game the same way on both sides", async () => {
  const [a, b] = await pair(makeRules({ size: 4, moveSeconds: 10, first: "guest" }));
  await b.play({ line: 0, ms: 1200 });
  await until(() => a.state.drawn === 1);
  await a.play({ timeout: true });
  await until(() => b.phase === "over");
  assert.equal(a.state.winner, 1);
  assert.equal(b.state.reason, "timeout");
  assert.deepEqual(a.state, b.state);
});

test("a line out of turn, or one already drawn, from the peer aborts the match", async () => {
  {
    const [a, b] = await pair(makeRules({ first: "host" }));
    b.send({ t: "move", move: { line: 3 } });
    await until(() => a.phase === "aborted");
    assert.match(a.abortReason, /out of turn|broke the rules/);
  }
  {
    const [a, b] = await pair(makeRules({ first: "host" }));
    await a.play({ line: 3 });
    await until(() => b.state.drawn === 1);
    a.send({ t: "move", move: { line: 3 } }); // a modified client replays a line
    await until(() => b.phase === "aborted");
    assert.match(b.abortReason, /broke the rules/);
  }
});

test("a robot game plays to the end through startRobot, with the robot's extra turns", async () => {
  const [human, robotSession] = await sessions();
  const rules = makeRules({ size: 3, first: "guest", level: "hard" });
  const robot = startRobot(robotSession, { rules, level: "hard", rng: rngFromSeed("robot"), think: () => 0 });
  const match = new TurnMatch({ send: (m) => human.send(m), me: 0, rules });
  matchRouter(human).start(match);
  await until(() => match.phase === "playing");
  const rng = rngFromSeed("human");
  while (match.phase === "playing") {
    if (match.canMove()) await match.play(chooseMove(match.state, 0, rng, { level: "easy" }));
    else await tick();
  }
  assert.equal(match.phase, "over");
  await until(() => robot.match.phase === "over");
  assert.deepEqual(robot.match.state, match.state);
  assert.ok([0, 1, DRAW].includes(match.state.winner));
  robot.destroy();
});

test("the robot forfeits rather than send a line past its limit", async () => {
  const [human, robotSession] = await sessions();
  const base = makeRules({ size: 3, moveSeconds: 10, first: "guest" });
  // A 20 ms limit per line on both sides, and a robot that thinks for 60 ms.
  const rules = { ...base, newState: (coin) => ({ ...base.newState(coin), moveMs: 20 }) };
  const robot = startRobot(robotSession, { rules, think: () => 60 });
  const match = new TurnMatch({ send: (m) => human.send(m), me: 0, rules });
  matchRouter(human).start(match);
  await until(() => match.phase === "over");
  assert.equal(match.state.reason, "timeout");
  assert.equal(match.state.winner, 0);
  assert.equal(match.state.drawn, 0);
  robot.destroy();
});
