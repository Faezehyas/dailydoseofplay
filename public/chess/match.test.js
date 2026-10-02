import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, parseSquare, colorOfPlayer, WHITE, DRAW } from "./rules.js";
import { chooseMove } from "./robot.js";

const rules = makeRules({ moveSeconds: 0, gameSeconds: 0 });
const fast = (state, me, rng) => chooseMove(state, me, rng, { level: "easy", maxNodes: 1500 });
const mv = (lan) => ({ from: parseSquare(lan.slice(0, 2)), to: parseSquare(lan.slice(2, 4)), ...(lan[4] && { promo: lan[4] }) });
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
    openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "chess" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "chess" }),
  ]);
  const a = new TurnMatch({ send: (m) => ha.send(m), me: 0, rules: r });
  const b = new TurnMatch({ send: (m) => hb.send(m), me: 1, rules: r });
  matchRouter(ha).start(a);
  matchRouter(hb).start(b);
  await until(() => a.phase === "playing" && b.phase === "playing");
  return { a, b, ha, hb };
}

// Play moves in order from whoever's turn it is, waiting for both sides to apply each.
async function playLine(a, b, lans) {
  for (const lan of lans) {
    const mover = a.canMove() ? a : b;
    const n = mover.state.moves.length;
    await mover.play(mv(lan));
    await until(() => a.state.moves.length === n + 1 && b.state.moves.length === n + 1 && !a.working && !b.working);
  }
}

test("two peers agree on who has White and on every move, through full games", async () => {
  for (let g = 0; g < 3; g++) {
    const { a, b } = await pair();
    assert.equal(a.state.white, b.state.white, "both agree who has White");
    assert.equal(a.state.turn, a.state.white, "White moves first");
    assert.equal(colorOfPlayer(a.state, a.state.white), WHITE);
    const rng = rngFromSeed(`proto-${g}`);
    while (a.phase === "playing") {
      const mover = a.canMove() ? a : b.canMove() ? b : null;
      if (!mover) {
        await tick();
        continue;
      }
      const n = mover.state.moves.length;
      await mover.play(fast(mover.state, mover.me, rng));
      await until(() => a.state.moves.length === n + 1 && b.state.moves.length === n + 1 && !a.working && !b.working);
    }
    await until(() => b.phase === "over");
    assert.deepEqual(a.state, b.state);
    assert.ok([0, 1, DRAW].includes(a.state.winner));
  }
});

test("an illegal move is refused locally; a forged one from the peer aborts", async () => {
  const { a, b } = await pair(makeRules({ first: "host" }));
  assert.equal(a.state.white, 0);
  const invalid = new Promise((r) => a.on("invalid", r));
  await a.play(mv("e2e5"));
  assert.equal(await invalid, "That piece can't move there");
  assert.equal(b.state.moves.length, 0, "nothing was sent");
  await playLine(a, b, ["e2e4"]);
  // The guest skips its own checks and moves a white pawn.
  const aborted = new Promise((r) => a.on("abort", r));
  b.send({ t: "move", move: mv("d2d4") });
  assert.match((await aborted).reason, /broke the rules: Pick one of your own pieces/);
});

test("promotion and resigning go over the wire", async () => {
  const { a, b } = await pair(makeRules({ first: "guest" }));
  assert.equal(b.state.white, 1);
  await playLine(a, b, ["e2e4", "d7d5", "e4d5", "c7c6", "d5c6", "g8f6", "c6b7", "b8d7"]);
  const n = b.state.moves.length;
  const invalid = new Promise((r) => b.on("invalid", r));
  await b.play(mv("b7a8"));
  assert.equal(await invalid, "Pick a piece to promote to");
  await b.play(mv("b7a8n"));
  await until(() => a.state.moves.length === n + 1);
  assert.equal(a.state.moves.at(-1).san, "bxa8=N");
  assert.equal(a.state.board[parseSquare("a8")], 2, "a white knight");
  await until(() => a.canMove());
  await a.play({ resign: true });
  await until(() => b.phase === "over");
  assert.equal(b.state.winner, 1);
  assert.equal(b.state.reason, "resign");
  assert.deepEqual(a.state, b.state);
});

test("the robot plays whole games over startTurnRobot and accepts a rematch", async () => {
  const [x, y] = localPair();
  const [human, bot] = await Promise.all([
    openSession({ channel: x, mode: "robot", index: 0, name: "Me", game: "chess" }),
    openSession({ channel: y, mode: "robot", index: 1, name: "Robot", game: "chess" }),
  ]);
  bot.on("rematch", (v) => v.them && !v.me && bot.requestRematch());
  const robot = startTurnRobot(bot, { rules, choose: fast, delay: 0, rng: rngFromSeed("bot") });
  const router = matchRouter(human);
  const rng = rngFromSeed("human");
  for (let m = 1; m <= 2; m++) {
    const me = new TurnMatch({ send: (msg) => human.send(msg), me: 0, rules, m });
    router.start(me);
    while (me.phase !== "over") {
      assert.notEqual(me.phase, "aborted");
      if (me.canMove()) await me.play(fast(me.state, 0, rng));
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

test("timed games: move times spend the same clocks on both sides, and a timeout ends the game", async () => {
  const timed = makeRules({ moveSeconds: 30, gameSeconds: 180, first: "host" });
  const { a, b } = await pair(timed);
  const lans = ["e2e4", "e7e5", "g1f3", "b8c6"];
  for (const [k, lan] of lans.entries()) {
    const mover = k % 2 === 0 ? a : b;
    await until(() => mover.canMove());
    await mover.play({ ...mv(lan), ms: 1000 + k });
    await until(() => a.state.moves.length === k + 1 && b.state.moves.length === k + 1);
  }
  assert.deepEqual(a.state.clocks, [180_000 - 1000 - 1002, 180_000 - 1001 - 1003]);
  await until(() => a.canMove());
  const invalid = new Promise((r) => a.on("invalid", r));
  await a.play({ ...mv("f1c4"), ms: 30_001 });
  assert.equal(await invalid, "Time ran out");
  await a.play({ timeout: true });
  await until(() => b.phase === "over");
  assert.equal(b.state.winner, 1);
  assert.equal(b.state.reason, "timeout");
  assert.deepEqual(a.state, b.state);
});
