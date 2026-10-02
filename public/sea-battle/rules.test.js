import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import {
  FLEET,
  CELLS,
  GIFT_EVERY,
  MAX_GIFTS,
  RAIN_COUNT,
  UNKNOWN,
  MISS,
  HIT,
  CLEAR,
  idx,
  randomFleet,
  validateFleet,
  canPlace,
  shipCells,
  occupancy,
  patternCells,
  aimedCells,
  newMatchState,
  checkFire,
  answerShots,
  applyFire,
  giftsDue,
  spawnGifts,
  rainCells,
  auditBoard,
  normalizeFleet,
  normalizeConfig,
  applyTimeout,
  WEAPONS,
  isTimed,
  timeLeft,
  DEFAULT_CONFIG,
  RuleError,
} from "./rules.js";

// A fixed legal fleet used across tests:
//   row 0: carrier A1-E1, row 2: battleship A3-D3, row 4: cruiser A5-C5,
//   row 6: cruiser A7-C7, row 8: destroyer A9-B9
const FLEET_A = [
  { r: 0, c: 0, len: 5, vertical: false },
  { r: 2, c: 0, len: 4, vertical: false },
  { r: 4, c: 0, len: 3, vertical: false },
  { r: 6, c: 0, len: 3, vertical: false },
  { r: 8, c: 0, len: 2, vertical: false },
];

// Simulate a full fire step: defender answers from its fleet, then apply.
function fire(state, fleet, shooter, weapon, target, rng, ms, dir) {
  let cells = checkFire(state, shooter, weapon, target, ms, dir);
  if (weapon === "rain") cells = rainCells(state.boards[1 - shooter], rng);
  const { hits, sunk } = answerShots(fleet, state.boards[1 - shooter], cells);
  return { cells, events: applyFire(state, shooter, weapon, cells, hits, sunk, ms) };
}

test("random fleets are always legal and never touch side by side", () => {
  for (let s = 0; s < 300; s++) {
    const fleet = randomFleet(rngFromSeed(`fleet-${s}`));
    assert.deepEqual(validateFleet(fleet), { ok: true });
    assert.deepEqual(fleet.map((x) => x.len), FLEET);
    const grid = occupancy(fleet);
    for (let i = 0; i < CELLS; i++) {
      if (grid[i] === -1) continue;
      const r = Math.floor(i / 10);
      const c = i % 10;
      for (const [dr, dc] of [[0, 1], [1, 0]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 10 && cc < 10 && grid[idx(rr, cc)] !== -1) assert.equal(grid[idx(rr, cc)], grid[i]);
      }
    }
  }
});

test("fleet validation rejects bad layouts and allows diagonal contact", () => {
  assert.equal(validateFleet(FLEET_A).ok, true);
  const touching = FLEET_A.map((s) => ({ ...s }));
  touching[1] = { r: 1, c: 0, len: 4, vertical: false };
  assert.equal(validateFleet(touching).ok, false);
  const overlap = FLEET_A.map((s) => ({ ...s }));
  overlap[4] = { r: 0, c: 8, len: 2, vertical: true };
  overlap[4] = { r: 0, c: 3, len: 2, vertical: true };
  assert.equal(validateFleet(overlap).ok, false);
  const offBoard = FLEET_A.map((s) => ({ ...s }));
  offBoard[0] = { r: 0, c: 7, len: 5, vertical: false };
  assert.equal(validateFleet(offBoard).ok, false);
  assert.equal(validateFleet(FLEET_A.slice(0, 4)).ok, false);
  assert.equal(validateFleet([...FLEET_A.slice(0, 4), { r: 8, c: 0, len: 3, vertical: false }]).ok, false);
  assert.equal(validateFleet([null, 1, 2, 3, 4]).ok, false);
  // Diagonal contact: destroyer at B10-C10 touches nothing side by side... put one diagonal to the cruiser end.
  const diagonal = FLEET_A.map((s) => ({ ...s }));
  diagonal[4] = { r: 7, c: 3, len: 2, vertical: true }; // D8-D9, diagonal to C7
  assert.equal(canPlace(diagonal.slice(0, 4), diagonal[4]), true);
  assert.equal(validateFleet(diagonal).ok, true);
});

test("weapon patterns: shot 1, big 5 (plus), nuke 14, trimmed at the edge", () => {
  assert.equal(patternCells("shot", idx(5, 5)).length, 1);
  assert.deepEqual(patternCells("big", idx(5, 5)).sort((a, b) => a - b), [idx(4, 5), idx(5, 4), idx(5, 5), idx(5, 6), idx(6, 5)]);
  assert.equal(patternCells("nuke", idx(5, 5)).length, 14);
  assert.equal(patternCells("big", idx(0, 0)).length, 3);
  assert.ok(patternCells("nuke", idx(0, 0)).length < 14);
});

test("a hit fires again, a miss passes the turn", () => {
  const state = newMatchState(0);
  let { events } = fire(state, FLEET_A, 0, "shot", idx(0, 0));
  assert.equal(state.boards[1].cells[idx(0, 0)], HIT);
  assert.equal(state.turn, 0);
  assert.ok(events.some((e) => e.type === "again"));
  ({ events } = fire(state, FLEET_A, 0, "shot", idx(9, 9)));
  assert.equal(state.boards[1].cells[idx(9, 9)], MISS);
  assert.equal(state.turn, 1);
  assert.throws(() => checkFire(state, 0, "shot", idx(5, 5)), RuleError);
  assert.throws(() => checkFire(state, 1, "shot", -1), RuleError);
  assert.throws(() => checkFire(state, 1, "nuke", idx(5, 5)), RuleError, "weapon not owned");
});

test("sinking a ship reveals it, clears the water beside it and ends the turn", () => {
  const state = newMatchState(0);
  for (const c of [0, 1]) fire(state, FLEET_A, 0, "shot", idx(8, c));
  assert.equal(state.turn, 1, "a sink passes the turn even though it was a hit");
  const board = state.boards[1];
  assert.equal(board.sunk.length, 1);
  assert.deepEqual(board.sunk[0], { len: 2, cells: [idx(8, 0), idx(8, 1)] });
  assert.equal(board.cells[idx(7, 0)], CLEAR);
  assert.equal(board.cells[idx(9, 1)], CLEAR);
  assert.equal(board.cells[idx(8, 2)], CLEAR);
  assert.equal(board.cells[idx(9, 2)], UNKNOWN, "diagonal stays unknown");
  assert.throws(() => checkFire(state, 0, "shot", idx(7, 0)), RuleError, "cleared water can't be targeted");
});

test("sinking the whole fleet wins", () => {
  const state = newMatchState(0);
  let last;
  for (const ship of FLEET_A) {
    for (const i of shipCells(ship)) {
      state.turn = 0; // each sink passes the turn; keep firing as player 0
      last = fire(state, FLEET_A, 0, "shot", i);
    }
  }
  assert.equal(state.winner, 0);
  assert.ok(last.events.some((e) => e.type === "win"));
  assert.throws(() => checkFire(state, 0, "shot", idx(9, 9)), RuleError);
});

test("impossible answers are rejected", () => {
  const state = newMatchState(0);
  assert.throws(() => applyFire(state, 0, "shot", [idx(0, 0)], [1, 1], []), RuleError);
  assert.throws(() => applyFire(newMatchState(0), 0, "shot", [idx(0, 0)], [1], [{ len: 2, cells: [idx(0, 0), idx(0, 1)] }]), RuleError);
  const s2 = newMatchState(0);
  applyFire(s2, 0, "shot", [idx(0, 0)], [1], []);
  assert.throws(() => applyFire(s2, 0, "shot", [idx(0, 0)], [1], []), RuleError, "fired twice");
  const s3 = newMatchState(0);
  applyFire(s3, 0, "shot", [idx(3, 3)], [1], []);
  applyFire(s3, 0, "shot", [idx(5, 5)], [1], []);
  assert.throws(() => applyFire(s3, 0, "shot", [idx(7, 7)], [1], [{ len: 3, cells: [idx(3, 3), idx(5, 5), idx(7, 7)] }]), RuleError, "not contiguous");
});

test("gifts pop every few moves, the shooter collects them, and weapons work", () => {
  const rng = rngFromSeed("gifts");
  const state = newMatchState(0);
  // Misses that alternate turns: player 0 on row 9, player 1 on row 9.
  const water = [idx(9, 4), idx(9, 5), idx(9, 6), idx(9, 7), idx(9, 8), idx(9, 9)];
  for (let k = 0; k < GIFT_EVERY; k++) {
    const shooter = state.turn;
    fire(state, FLEET_A, shooter, "shot", water[Math.floor(k / 2)]);
  }
  assert.equal(state.moves, GIFT_EVERY);
  assert.equal(giftsDue(state), true);
  const spawned = spawnGifts(state, rng);
  assert.equal(spawned.length, 2);
  assert.equal(state.boards[0].gifts.length, 1);
  assert.equal(state.boards[1].gifts.length, 1);
  for (let k = 0; k < 5; k++) spawnGifts(state, rng);
  assert.equal(state.boards[1].gifts.length, MAX_GIFTS);
  // Same rng seed -> same gifts on another peer.
  const twin = newMatchState(0);
  for (let k = 0; k < GIFT_EVERY; k++) fire(twin, FLEET_A, twin.turn, "shot", water[Math.floor(k / 2)]);
  assert.deepEqual(spawnGifts(twin, rngFromSeed("gifts")), spawned);

  // Collect a gift on board 1 with player 0's shot.
  const gift = state.boards[1].gifts[0];
  state.turn = 0;
  const before = state.inventory[0][gift.type];
  const { events } = fire(state, FLEET_A, 0, "shot", gift.cell);
  assert.equal(state.inventory[0][gift.type], before + 1);
  assert.ok(events.some((e) => e.type === "gift" && e.gift === gift.type));
  assert.ok(!state.boards[1].gifts.some((g) => g.cell === gift.cell));
});

test("a carpet bomb hits the whole row or column of the aimed square", () => {
  assert.deepEqual(patternCells("carpet", idx(3, 7), "row"), [...Array(10).keys()].map((c) => idx(3, c)));
  assert.deepEqual(patternCells("carpet", idx(3, 7), "col"), [...Array(10).keys()].map((r) => idx(r, 7)));
  const state = newMatchState(0);
  state.inventory[0].carpet = 1;
  assert.throws(() => checkFire(state, 0, "carpet", idx(0, 0)), RuleError, "a direction is required");
  assert.throws(() => checkFire(state, 0, "carpet", idx(0, 0), undefined, "diagonal"), RuleError);
  fire(state, FLEET_A, 0, "shot", idx(0, 0)); // carrier square: hit, fire again
  const { cells, events } = fire(state, FLEET_A, 0, "carpet", idx(5, 0), undefined, undefined, "col");
  assert.equal(cells.length, 9, "the square already hit is skipped");
  assert.ok(cells.every((i) => i % 10 === 0));
  assert.equal(events.filter((e) => e.type === "hit").length, 4, "the battleship, both cruisers and the destroyer");
  assert.equal(state.inventory[0].carpet, 0);
  assert.equal(WEAPONS.carpet.weight, WEAPONS.nuke.weight, "as rare as the nuclear missile");
});

test("big/nuke splash, rain hits 7 agreed squares", () => {
  const state = newMatchState(0);
  state.inventory[0] = { big: 1, rain: 1, nuke: 1 };
  assert.throws(() => checkFire(state, 0, "missile", idx(9, 9)), RuleError, "the simple missile is gone");
  const big = fire(state, FLEET_A, 0, "big", idx(5, 5));
  assert.equal(big.cells.length, 5);
  const rainA = rainCells(state.boards[1], rngFromSeed("rain"));
  const rainB = rainCells(state.boards[1], rngFromSeed("rain"));
  assert.deepEqual(rainA, rainB);
  assert.equal(new Set(rainA).size, RAIN_COUNT);
  assert.ok(rainA.every((i) => state.boards[1].cells[i] === UNKNOWN));
  state.turn = 0;
  const rain = fire(state, FLEET_A, 0, "rain", undefined, rngFromSeed("rain"));
  assert.deepEqual(rain.cells, rainA);
  state.turn = 0;
  const nuke = fire(state, FLEET_A, 0, "nuke", idx(1, 6));
  assert.ok(nuke.cells.length > 0 && nuke.cells.length <= 14);
  assert.deepEqual(aimedCells(state.boards[1], "nuke", idx(1, 6)), []);
  assert.deepEqual(state.inventory[0], { big: 0, rain: 0, nuke: 0 });
});

test("audit catches every kind of lie", () => {
  const honest = newMatchState(0);
  fire(honest, FLEET_A, 0, "shot", idx(0, 0));
  fire(honest, FLEET_A, 0, "shot", idx(9, 9));
  assert.deepEqual(auditBoard(honest.boards[1], normalizeFleet(FLEET_A)), { ok: true });

  const liar = newMatchState(0);
  applyFire(liar, 0, "shot", [idx(0, 0)], [0], []); // carrier square reported as water
  assert.equal(auditBoard(liar.boards[1], FLEET_A).ok, false);

  const fake = newMatchState(0);
  applyFire(fake, 0, "shot", [idx(9, 9)], [1], []); // water reported as hit
  assert.equal(auditBoard(fake.boards[1], FLEET_A).ok, false);

  const silent = newMatchState(0);
  applyFire(silent, 0, "shot", [idx(8, 0)], [1], []);
  applyFire(silent, 0, "shot", [idx(8, 1)], [1], []); // destroyer sunk, not announced
  assert.equal(auditBoard(silent.boards[1], FLEET_A).ok, false);

  const touching = FLEET_A.map((s) => ({ ...s }));
  touching[1] = { r: 1, c: 0, len: 4, vertical: false };
  assert.equal(auditBoard(newMatchState(0).boards[1], touching).ok, false);
});

test("room settings: unknown values fall back to the defaults", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ shotSeconds: 7, gameSeconds: "600" }), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ shotSeconds: 0, gameSeconds: 180 }), { shotSeconds: 0, gameSeconds: 180 });
  assert.equal(isTimed(newMatchState(0)), false, "no config, no clocks");
});

test("clocks: each shot spends its time; over the limit is refused; a clock running out loses", () => {
  const state = newMatchState(0, { shotSeconds: 10, gameSeconds: 180 });
  assert.equal(timeLeft(state, 0), 10_000, "the shot limit binds first");
  assert.throws(() => checkFire(state, 0, "shot", idx(9, 9)), RuleError, "time is required");
  assert.throws(() => checkFire(state, 0, "shot", idx(9, 9), 10_001), RuleError, "over the shot limit");
  fire(state, FLEET_A, 0, "shot", idx(9, 9), undefined, 4_000);
  assert.deepEqual(state.clocks, [176_000, 180_000]);
  state.clocks[1] = 3_000;
  assert.equal(timeLeft(state, 1), 3_000, "the game clock binds when it's lower");
  assert.throws(() => checkFire(state, 1, "shot", idx(9, 9), 3_500), RuleError);
  assert.throws(() => applyTimeout(state, 0), RuleError, "only the player on turn");
  assert.deepEqual(applyTimeout(state, 1), [{ type: "timeout", player: 1 }, { type: "win", winner: 0 }]);
  assert.equal(state.winner, 0);
  assert.equal(state.reason, "timeout");
  assert.throws(() => applyTimeout(newMatchState(0, { shotSeconds: 10, gameSeconds: 0 }), 0), RuleError, "no game clock, no timeout loss");
});
