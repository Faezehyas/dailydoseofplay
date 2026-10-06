import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { localRoom } from "../engine/room.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { makeRules, LAST } from "./rules.js";
import { chooseMove } from "./robot.js";

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
    openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "chutes-and-ladders" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "chutes-and-ladders" }),
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

test("chooseMove always spins", () => {
  assert.deepEqual(chooseMove(), { type: "spin" });
});

test("two peers agree on the coin toss and every spin, through full games", async () => {
  for (const config of [{ finish: "exact" }, { finish: "bounce", sixAgain: true }, { finish: "any" }]) {
    const [a, b] = await pair(makeRules(config));
    assert.equal(a.state.first, b.state.first);
    while (a.phase === "playing") {
      const mover = a.canMove() ? a : b.canMove() ? b : null;
      if (!mover) {
        await tick();
        continue;
      }
      const ply = mover.state.ply;
      await mover.play(chooseMove());
      await until(() => (a.state.ply > ply && b.state.ply > ply && !a.working && !b.working) || a.phase === "aborted");
      assert.deepEqual(a.state.pos, b.state.pos);
    }
    await until(() => b.phase === "over");
    assert.deepEqual(a.state, b.state);
    assert.equal(a.state.pos[a.state.winner], LAST);
  }
});

test("a spin out of turn from the peer aborts the match", async () => {
  const [a, b] = await pair(makeRules({ first: "host" }));
  assert.equal(a.state.turn, 0);
  b.send({ t: "move", move: { type: "spin" } });
  await until(() => a.phase === "aborted");
  assert.match(a.abortReason, /out of turn|broke the rules/);
});

test("a robot game plays to the end through startTurnRobot", async () => {
  const [human, robotSession] = await sessions();
  const rules = makeRules({ first: "guest" });
  const robot = startTurnRobot(robotSession, { rules, choose: chooseMove, delay: 0 });
  const match = new TurnMatch({ send: (m) => human.send(m), me: 0, rules });
  matchRouter(human).start(match);
  await until(() => match.phase === "playing");
  while (match.phase === "playing") {
    if (match.canMove()) await match.play({ type: "spin" });
    else await tick();
  }
  assert.equal(match.phase, "over");
  await until(() => robot.match.phase === "over");
  assert.deepEqual(robot.match.state.pos, match.state.pos);
  robot.destroy();
});

test("four players agree on every spin through a full game, and only the seat on turn may spin", async () => {
  const sessions = localRoom({ game: "chutes-and-ladders", names: ["A", "B", "C", "D"], mode: "friend" });
  const rules = makeRules({ sixAgain: true });
  const matches = sessions.map((s) => {
    const match = new TurnMatch({ send: (msg) => s.send(msg), me: s.index, players: 4, rules });
    matchRouter(s).start(match);
    return match;
  });
  await until(() => matches.every((m) => m.phase === "playing"));
  assert.ok(matches.every((m) => m.state.first === matches[0].state.first && m.state.pos.length === 4));
  while (matches[0].phase === "playing") {
    const mover = matches.find((m) => m.canMove());
    if (!mover) {
      await tick();
      continue;
    }
    const ply = mover.state.ply;
    await mover.play(chooseMove());
    await until(() => matches.every((m) => m.state.ply > ply && !m.working) || matches.some((m) => m.phase === "aborted"));
  }
  await until(() => matches.every((m) => m.phase === "over"));
  for (const m of matches.slice(1)) assert.deepEqual(m.state, matches[0].state);
  assert.ok(matches[0].state.spins.every((n) => n > 0), "everyone spun");

  // A fresh match: a seat that is not on turn can't spin.
  const next = sessions.map((s) => {
    const match = new TurnMatch({ send: (msg) => s.send(msg), me: s.index, players: 4, rules: makeRules({ first: "host" }), m: 2 });
    matchRouter(s).start(match);
    return match;
  });
  await until(() => next.every((m) => m.phase === "playing"));
  next[2].send({ t: "move", move: { type: "spin" } });
  await until(() => next[0].phase === "aborted");
  assert.match(next[0].abortReason, /out of turn/);
});
