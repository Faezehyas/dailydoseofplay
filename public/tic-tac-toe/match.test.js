import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { rules, markOf, DRAW } from "./rules.js";
import { chooseMove } from "./robot.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

async function sessions() {
  const [x, y] = localPair();
  return Promise.all([
    openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "tic-tac-toe" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "tic-tac-toe" }),
  ]);
}

test("two peers agree on the coin toss and every move, through a full game", async () => {
  for (let g = 0; g < 5; g++) {
    const [ha, hb] = await sessions();
    const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules });
    const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules });
    matchRouter(ha).start(a);
    matchRouter(hb).start(b);
    await until(() => a.phase === "playing" && b.phase === "playing");
    assert.equal(a.state.first, b.state.first, "both agree who starts");
    assert.equal(markOf(a.state, a.state.first), "X");
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
  }
});

test("a taken square is refused locally; a forged move from the peer aborts", async () => {
  const [ha, hb] = await sessions();
  const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules });
  const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules });
  matchRouter(ha).start(a);
  matchRouter(hb).start(b);
  await until(() => a.phase === "playing" && b.phase === "playing");
  const mover = a.canMove() ? a : b;
  const other = mover === a ? b : a;
  await mover.play({ cell: 4 });
  await until(() => other.canMove());
  const invalid = new Promise((r) => other.on("invalid", r));
  await other.play({ cell: 4 });
  assert.equal(await invalid, "That square is taken");
  assert.equal(mover.state.moves.length, 1, "nothing was sent");
  // A peer that skips the checks and sends a move onto a taken square.
  const aborted = new Promise((r) => mover.on("abort", r));
  other.send({ t: "move", move: { cell: 4 } });
  assert.match((await aborted).reason, /broke the rules: That square is taken/);
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
