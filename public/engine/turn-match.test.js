import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "./channel.js";
import { openSession, matchRouter } from "./session.js";
import { TurnMatch, RuleError, startTurnRobot } from "./turn-match.js";

// A tiny game to exercise the protocol: players take turns adding 1 or 2 to
// a counter, or "roll" a shared die (1-3). Whoever reaches 10 wins.
const race = {
  newState: (first) => ({ turn: first, winner: -1, total: 0, log: [] }),
  needsRandom: (state, move) => move.type === "roll",
  applyMove(state, player, move, rng) {
    if (state.winner !== -1) throw new RuleError("game over");
    if (state.turn !== player) throw new RuleError("not your turn");
    let add;
    if (move.type === "add" && (move.n === 1 || move.n === 2)) add = move.n;
    else if (move.type === "roll") add = 1 + Math.floor(rng() * 3);
    else throw new RuleError("bad move");
    state.total += add;
    state.log.push([player, add]);
    if (state.total >= 10) state.winner = player;
    else state.turn = 1 - player;
    return [{ type: "added", n: add }];
  },
};

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
    openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "race" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "race" }),
  ]);
}

test("two peers agree on the first player, moves and shared dice", async () => {
  const [ha, hb] = await sessions();
  const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules: race });
  const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules: race });
  matchRouter(ha).start(a);
  matchRouter(hb).start(b);
  await until(() => a.phase === "playing" && b.phase === "playing");
  assert.equal(a.state.turn, b.state.turn);
  let k = 0;
  while (a.phase === "playing") {
    const mover = a.canMove() ? a : b.canMove() ? b : null;
    if (!mover) {
      await tick();
      continue;
    }
    await mover.play(k++ % 3 === 0 ? { type: "roll" } : { type: "add", n: 1 });
    await until(() => !a.working && !b.working && a.state.log.length === b.state.log.length);
  }
  await until(() => b.phase === "over");
  assert.deepEqual(a.state, b.state);
  assert.ok(a.state.log.some(([, n]) => n >= 1));
});

test("illegal local moves are refused without sending; illegal peer moves abort", async () => {
  const [ha, hb] = await sessions();
  const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules: race });
  const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules: race });
  matchRouter(ha).start(a);
  matchRouter(hb).start(b);
  await until(() => a.phase === "playing" && b.phase === "playing");
  const mover = a.canMove() ? a : b;
  const other = mover === a ? b : a;
  const invalid = new Promise((r) => mover.on("invalid", r));
  await mover.play({ type: "add", n: 5 });
  assert.equal(await invalid, "bad move");
  // Out-of-turn message straight onto the wire: the receiver aborts.
  const aborted = new Promise((r) => mover.on("abort", r));
  other.send({ t: "move", move: { type: "add", n: 1 } });
  assert.match((await aborted).reason, /broke the rules: move out of turn/);
});

test("startTurnRobot plays a whole game and accepts rematches", async () => {
  const [human, bot] = await sessions();
  bot.on("rematch", (v) => v.them && !v.me && bot.requestRematch());
  const robot = startTurnRobot(bot, { rules: race, choose: () => ({ type: "add", n: 2 }), delay: 0 });
  const router = matchRouter(human);
  let me = new TurnMatch({ send: (m) => human.send(m), me: 0, rules: race, m: 1 });
  router.start(me);
  while (me.phase !== "over") {
    assert.notEqual(me.phase, "aborted");
    if (me.canMove()) await me.play({ type: "add", n: 1 });
    await tick();
  }
  const started = new Promise((r) => human.on("rematch-start", r));
  human.requestRematch();
  await started;
  me = new TurnMatch({ send: (m) => human.send(m), me: 0, rules: race, m: 2 });
  router.start(me);
  await until(() => me.phase === "playing" && robot.match.m === 2);
  robot.destroy();
});
