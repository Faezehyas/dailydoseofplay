import test from "node:test";
import assert from "node:assert/strict";
import { matchRouter } from "../engine/session.js";
import { localRoom } from "../engine/room.js";
import { TurnMatch } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, HOME } from "./rules.js";
import { chooseMove, startRobot } from "./robot.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 30_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

function seat(sessions, rules, m = 1) {
  return sessions.map((s) => {
    const match = new TurnMatch({ send: (msg) => s.send(msg), me: s.index, players: sessions.length, rules, m });
    matchRouter(s).start(match);
    return match;
  });
}

test("four seats agree on every roll and move through a full game, and a seat out of turn can't move", async () => {
  const sessions = localRoom({ game: "ludo", names: ["A", "B", "C", "D"], mode: "friend" });
  const rules = makeRules({ blocks: true, captureBonus: true });
  const matches = seat(sessions, rules);
  await until(() => matches.every((m) => m.phase === "playing"));
  assert.ok(matches.every((m) => m.state.first === matches[0].state.first && m.state.players === 4));
  const rng = rngFromSeed("four");
  while (matches[0].phase === "playing") {
    const mover = matches.find((m) => m.canMove());
    if (!mover) {
      await tick();
      continue;
    }
    const ply = mover.state.ply;
    await mover.play(chooseMove(mover.state, mover.me, rng, { level: ["easy", "medium", "hard", "hard"][mover.me] }));
    await until(() => matches.every((m) => m.state.ply > ply && !m.working) || matches.some((m) => m.phase === "aborted"));
  }
  await until(() => matches.every((m) => m.phase === "over"));
  for (const m of matches.slice(1)) assert.deepEqual(m.state, matches[0].state, "every seat ends on the same state");
  const st = matches[0].state;
  assert.equal(st.order.length, 4);
  assert.ok(st.order.slice(0, 3).every((p) => st.tokens[p].every((r) => r === HOME)), "three players finished for places");
  assert.ok(st.rolls.every((n) => n > 0), "everyone rolled");

  // A fresh match: a seat that is not on turn can't roll.
  const next = seat(sessions, makeRules({ first: "host" }), 2);
  await until(() => next.every((m) => m.phase === "playing"));
  next[2].play({ type: "roll" });
  await tick();
  assert.equal(next[2].state.ply, 0, "the out-of-turn seat's own match refuses it");
  next[3].send({ t: "move", move: { type: "roll" } });
  await until(() => next[0].phase === "aborted");
  assert.match(next[0].abortReason, /out of turn/);
});

test("three robot seats play a full game with a person over startRobot", async () => {
  const sessions = localRoom({ game: "ludo", names: ["You", "Robot 1", "Robot 2", "Robot 3"], mode: "robot" });
  const rules = makeRules({ first: "guest" });
  const robots = sessions.slice(1).map((s, i) =>
    startRobot(s, { rules, delay: () => 0, choose: (st, me, rng) => chooseMove(st, me, rng, { level: ["easy", "medium", "hard"][i] }) }),
  );
  const match = new TurnMatch({ send: (msg) => sessions[0].send(msg), me: 0, players: 4, rules });
  matchRouter(sessions[0]).start(match);
  await until(() => match.phase === "playing");
  assert.equal(match.state.turn, 1, "the room said the first friend in rolls first");
  const rng = rngFromSeed("person");
  while (match.phase === "playing") {
    if (match.canMove()) await match.play(chooseMove(match.state, 0, rng, { level: "medium" }));
    else await tick();
  }
  assert.equal(match.phase, "over");
  for (const robot of robots) {
    await until(() => robot.match.phase === "over");
    assert.deepEqual(robot.match.state, match.state);
    robot.destroy();
  }
});
