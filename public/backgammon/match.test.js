import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, CHECKERS, OFF } from "./rules.js";
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

async function pair(r = rules) {
  const [x, y] = localPair();
  const [ha, hb] = await Promise.all([
    openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "backgammon" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "backgammon" }),
  ]);
  const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules: r });
  const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules: r });
  matchRouter(ha).start(a);
  matchRouter(hb).start(b);
  await until(() => a.phase === "playing" && b.phase === "playing");
  return [a, b];
}

// Whoever may move plays the robot's choice; waits until both sides applied it.
async function step(a, b, rng, extra = {}) {
  const mover = a.canMove() ? a : b.canMove() ? b : null;
  if (!mover) return tick();
  const ply = mover.state.ply;
  await mover.play({ ...chooseMove(mover.state, mover.me, rng, { level: "medium" }), ...extra });
  await until(() => (a.state.ply > ply && b.state.ply > ply && !a.working && !b.working) || a.phase === "aborted");
}

test("two peers agree on the coin toss, every roll and every play, through full games", async () => {
  for (let g = 0; g < 3; g++) {
    const [a, b] = await pair();
    assert.equal(a.state.first, b.state.first, "both agree who starts");
    const rng = rngFromSeed(`proto-${g}`);
    while (a.phase === "playing") {
      await step(a, b, rng);
      assert.deepEqual(a.state.pos, b.state.pos);
    }
    await until(() => b.phase === "over");
    assert.deepEqual(a.state, b.state);
    assert.equal(a.state.pos[a.state.winner][OFF], CHECKERS);
    assert.ok(a.state.ply > 40, `${a.state.ply} moves`);
  }
});

test("an illegal play is refused locally; a forged play from the peer aborts the match", async () => {
  const [a, b] = await pair();
  const mover = a.canMove() ? a : b;
  const other = mover === a ? b : a;
  await mover.play({ type: "roll" });
  await until(() => other.state.rolled && !other.working);
  const invalid = new Promise((r) => mover.on("invalid", r));
  await mover.play({ type: "play", steps: [[24, mover.state.dice[0]], [24, 6], [24, 6]] });
  assert.match(await invalid, /can't move there|isn't yours|play as many/);
  assert.equal(other.state.ply, 1, "nothing was sent");
  // A peer that skips the checks: a roll out of turn.
  const aborted = new Promise((r) => mover.on("abort", r));
  other.send({ t: "move", move: { type: "roll" } });
  assert.match((await aborted).reason, /broke the rules: move out of turn/);
});

test("the robot plays whole games over startTurnRobot and accepts a rematch", async () => {
  const [x, y] = localPair();
  const [human, bot] = await Promise.all([
    openSession({ channel: x, mode: "robot", index: 0, name: "A", game: "backgammon" }),
    openSession({ channel: y, mode: "robot", index: 1, name: "Robot", game: "backgammon" }),
  ]);
  bot.on("rematch", (v) => v.them && !v.me && bot.requestRematch());
  const choose = (state, me, rng) => chooseMove(state, me, rng, { level: "hard" });
  const robot = startTurnRobot(bot, { rules, choose, delay: 0, rng: rngFromSeed("bot") });
  const router = matchRouter(human);
  const rng = rngFromSeed("human");
  for (let m = 1; m <= 2; m++) {
    const me = new TurnMatch({ send: (msg) => human.send(msg), me: 0, rules, m });
    router.start(me);
    while (me.phase !== "over") {
      assert.notEqual(me.phase, "aborted");
      if (me.canMove()) await me.play(chooseMove(me.state, 0, rng, { level: "easy" }));
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

test("timed games: rolls and plays spend the same clocks on both sides, and a timeout ends the round", async () => {
  const timed = makeRules({ moveSeconds: 30, gameSeconds: 300, first: "guest" });
  const [a, b] = await pair(timed);
  assert.equal(a.state.turn, 1, "the room says the guest starts, whatever the coin");
  const rng = rngFromSeed("timed");
  for (let k = 0; k < 6; k++) await step(a, b, rng, { ms: 1000 });
  assert.deepEqual(a.state.clocks, b.state.clocks);
  assert.ok(a.state.clocks.every((ms) => ms < 300_000 && ms % 1000 === 0), `${a.state.clocks}`);
  const mover = a.canMove() ? a : b;
  await mover.play({ timeout: true });
  await until(() => a.phase === "over" && b.phase === "over");
  assert.equal(b.state.winner, 1 - mover.me);
  assert.equal(b.state.reason, "timeout");
  assert.deepEqual(a.state, b.state);
});
