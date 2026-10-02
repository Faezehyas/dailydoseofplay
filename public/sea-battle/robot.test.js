import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { rngFromSeed, randInt } from "../engine/rng.js";
import { chooseMove, analyze, startRobot } from "./robot.js";
import { SeaBattleMatch } from "./match.js";
import {
  newMatchState,
  randomFleet,
  checkFire,
  answerShots,
  applyFire,
  rainCells,
  giftsDue,
  spawnGifts,
  idx,
  orthoNeighbors,
  UNKNOWN,
  CELLS,
} from "./rules.js";

// Headless robot-vs-fleet: count the shots needed to sink a fleet with plain shots.
function shotsToSink(fleet, choose, rng) {
  const state = newMatchState(0);
  let shots = 0;
  while (state.winner === -1 && shots < CELLS) {
    state.turn = 0;
    const { target } = choose(state, rng);
    const cells = checkFire(state, 0, "shot", target);
    const { hits, sunk } = answerShots(fleet, state.boards[1], cells);
    applyFire(state, 0, "shot", cells, hits, sunk);
    shots++;
  }
  return shots;
}

const robotShots = (state, rng) => chooseMove(state, 0, rng);
const randomShots = (state, rng) => {
  const free = [...Array(CELLS).keys()].filter((i) => state.boards[1].cells[i] === UNKNOWN);
  return { target: free[randInt(rng, free.length)] };
};

test("robot sinks a fleet far faster than random shooting", () => {
  let robot = 0;
  let random = 0;
  const games = 40;
  for (let g = 0; g < games; g++) {
    const fleet = randomFleet(rngFromSeed(`fleet-${g}`));
    robot += shotsToSink(fleet, robotShots, rngFromSeed(`r-${g}`));
    random += shotsToSink(fleet, randomShots, rngFromSeed(`x-${g}`));
  }
  robot /= games;
  random /= games;
  assert.ok(robot < 55, `robot averaged ${robot} shots`);
  assert.ok(random > 80, `random averaged ${random} shots`);
});

test("after a hit the robot fires next to it, and follows a line", () => {
  const state = newMatchState(0);
  const board = state.boards[1];
  board.cells[idx(4, 4)] = 2; // HIT
  const { target } = chooseMove(state, 0, rngFromSeed("t"));
  assert.ok(orthoNeighbors(idx(4, 4)).includes(target), `target ${target}`);
  board.cells[idx(4, 5)] = 2;
  const next = chooseMove(state, 0, rngFromSeed("t2")).target;
  assert.ok([idx(4, 3), idx(4, 6)].includes(next), `line target ${next}`);
});

test("in hunt mode the robot uses parity and ignores impossible squares", () => {
  const state = newMatchState(0);
  const { density, targetMode } = analyze(state.boards[1]);
  assert.equal(targetMode, false);
  const { target } = chooseMove(state, 0, rngFromSeed("p"));
  assert.equal((Math.floor(target / 10) + (target % 10)) % 2, 0);
  assert.ok(density[idx(4, 4)] > density[idx(0, 0)], "centre squares are likelier than corners");
});

test("robot uses gifts: splash weapons when hunting, missile for a bonus shot", () => {
  const state = newMatchState(0);
  state.inventory[0].nuke = 1;
  assert.equal(chooseMove(state, 0, rngFromSeed("w")).weapon, "nuke");
  state.inventory[0] = { missile: 0, big: 1, rain: 0, nuke: 0 };
  assert.equal(chooseMove(state, 0, rngFromSeed("w")).weapon, "big");
  state.inventory[0] = { missile: 0, big: 0, rain: 1, nuke: 0 };
  assert.equal(chooseMove(state, 0, rngFromSeed("w")).weapon, "rain");
  state.inventory[0] = { missile: 1, big: 0, rain: 0, nuke: 0 };
  assert.equal(chooseMove(state, 0, rngFromSeed("w")).weapon, "missile");
});

test("robot vs robot through the full rules (gifts and weapons included) always finishes", () => {
  for (let g = 0; g < 20; g++) {
    const rng = rngFromSeed(`rr-${g}`);
    const fleets = [randomFleet(rng), randomFleet(rng)];
    const state = newMatchState(g % 2);
    let moves = 0;
    while (state.winner === -1) {
      assert.ok(moves++ < 400, "game should end");
      const me = state.turn;
      const { weapon, target } = chooseMove(state, me, rng);
      let cells = checkFire(state, me, weapon, target);
      if (weapon === "rain") cells = rainCells(state.boards[1 - me], rng);
      const { hits, sunk } = answerShots(fleets[1 - me], state.boards[1 - me], cells);
      applyFire(state, me, weapon, cells, hits, sunk);
      if (giftsDue(state)) spawnGifts(state, rng);
    }
    assert.ok(state.winner === 0 || state.winner === 1);
  }
});

test("startRobot plays a whole match against a scripted human over the session protocol", async () => {
  const [x, y] = localPair();
  const [human, bot] = await Promise.all([
    openSession({ channel: x, mode: "robot", index: 0, name: "Me", game: "sea-battle" }),
    openSession({ channel: y, mode: "robot", index: 1, name: "Robot", game: "sea-battle" }),
  ]);
  bot.on("rematch", (v) => v.them && !v.me && bot.requestRematch());
  const robot = startRobot(bot, { delay: 0, rng: rngFromSeed("bot") });
  const router = matchRouter(human);
  const rng = rngFromSeed("human");
  let me = new SeaBattleMatch({ send: (m) => human.send(m), me: 0, fleet: randomFleet(rng), m: 1 });
  router.start(me);
  await me.ready();
  const deadline = Date.now() + 20000;
  while (me.phase !== "over") {
    assert.ok(Date.now() < deadline, "match should finish");
    assert.notEqual(me.phase, "aborted");
    if (me.canFire()) {
      const move = chooseMove(me.state, 0, rng);
      await me.fire(move.weapon, move.target);
    }
    await new Promise((r) => setTimeout(r, 1));
  }
  while (!me.verdict) await new Promise((r) => setTimeout(r, 1));
  assert.deepEqual(me.verdict, { ok: true }, "robot answered honestly");

  // Rematch: the robot accepts and readies a fresh fleet for match 2.
  const started = new Promise((r) => human.on("rematch-start", r));
  human.requestRematch();
  await started;
  me = new SeaBattleMatch({ send: (m) => human.send(m), me: 0, fleet: randomFleet(rng), m: 2 });
  router.start(me);
  await me.ready();
  while (me.phase !== "playing") await new Promise((r) => setTimeout(r, 1));
  assert.equal(robot.match.m, 2);
  robot.destroy();
});
