import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, stoneOf, DRAW } from "./rules.js";
import { chooseMove } from "./robot.js";

const rules = makeRules({ moveSeconds: 0, gameSeconds: 0 });
const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 10_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

async function sessions() {
  const [x, y] = localPair();
  return Promise.all([
    openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "gomoku" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "gomoku" }),
  ]);
}

async function pair(r = rules) {
  const [ha, hb] = await sessions();
  const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules: r });
  const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules: r });
  matchRouter(ha).start(a);
  matchRouter(hb).start(b);
  await until(() => a.phase === "playing" && b.phase === "playing");
  return [a, b];
}

test("two peers agree on the coin toss and every move, through a full game", async () => {
  for (let g = 0; g < 4; g++) {
    const [a, b] = await pair();
    assert.equal(a.state.first, b.state.first, "both agree who starts");
    assert.equal(stoneOf(a.state, a.state.first), "first");
    const rng = rngFromSeed(`proto-${g}`);
    while (a.phase === "playing") {
      const mover = a.canMove() ? a : b.canMove() ? b : null;
      if (!mover) {
        await tick();
        continue;
      }
      const n = mover.state.moves.length;
      await mover.play(chooseMove(mover.state, mover.me, rng));
      await until(() => a.state.moves.length === n + 1 && b.state.moves.length === n + 1 && !a.working && !b.working);
    }
    await until(() => b.phase === "over");
    assert.deepEqual(a.state, b.state);
    assert.ok([0, 1, DRAW].includes(a.state.winner));
    if (a.state.winner !== DRAW) assert.ok(a.state.line.length >= 5);
  }
});

test("a taken point is refused locally; a forged move from the peer aborts", async () => {
  const [a, b] = await pair();
  const mover = a.canMove() ? a : b;
  const other = mover === a ? b : a;
  await mover.play({ cell: 112 });
  await until(() => other.canMove());
  const invalid = new Promise((r) => other.on("invalid", r));
  await other.play({ cell: 112 });
  assert.equal(await invalid, "That point is taken");
  assert.equal(mover.state.moves.length, 1, "nothing was sent");
  // A peer that skips the checks and sends a move onto a taken point.
  const aborted = new Promise((r) => mover.on("abort", r));
  other.send({ t: "move", move: { cell: 112 } });
  assert.match((await aborted).reason, /broke the rules: That point is taken/);
});

test("the robot plays whole games over startTurnRobot and accepts a rematch", async () => {
  const [human, bot] = await sessions();
  bot.on("rematch", (v) => v.them && !v.me && bot.requestRematch());
  const robot = startTurnRobot(bot, { rules, choose: chooseMove, delay: 0, rng: rngFromSeed("bot") });
  const router = matchRouter(human);
  const rng = rngFromSeed("human");
  for (let m = 1; m <= 2; m++) {
    const me = new TurnMatch({ send: (msg) => human.send(msg), me: 0, rules, m });
    router.start(me);
    while (me.phase !== "over") {
      assert.notEqual(me.phase, "aborted");
      if (me.canMove()) await me.play(chooseMove(me.state, 0, rng));
      await tick();
    }
    await until(() => robot.match.m === m && robot.match.phase === "over");
    assert.deepEqual(me.state, robot.match.state);
    if (m === 1) {
      const started = new Promise((r) => human.on("rematch-start", r));
      human.requestRematch();
      await started;
    }
  }
  robot.destroy();
});

test("timed games: move times spend the same clocks on both sides, and a timeout ends the round", async () => {
  const timed = makeRules({ moveSeconds: 10, gameSeconds: 120, first: "host" });
  const [a, b] = await pair(timed);
  assert.equal(a.state.turn, 0, "the room says the host starts, whatever the coin");
  assert.equal(a.state.board.length, 225);
  const rng = rngFromSeed("timed");
  for (let k = 0; k < 4; k++) {
    const mover = k % 2 === 0 ? a : b;
    await until(() => mover.canMove());
    await mover.play({ ...chooseMove(mover.state, mover.me, rng), ms: 1000 + k });
    await until(() => a.state.moves.length === k + 1 && b.state.moves.length === k + 1);
  }
  assert.deepEqual(a.state.clocks, [120_000 - 1000 - 1002, 120_000 - 1001 - 1003]);
  // A move slower than the per-move limit is refused before it is sent.
  await until(() => a.canMove());
  const invalid = new Promise((r) => a.on("invalid", r));
  await a.play({ ...chooseMove(a.state, 0, rng), ms: 10_001 });
  assert.equal(await invalid, "Time ran out");
  await a.play({ timeout: true });
  await until(() => b.phase === "over");
  assert.equal(b.state.winner, 1);
  assert.equal(b.state.reason, "timeout");
  assert.deepEqual(a.state, b.state);
});
