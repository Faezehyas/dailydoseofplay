import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { applyMove, newState, makeRules, legalMoves, square, STARTS, LOOP, YARD, HOME } from "./rules.js";
import { chooseMove } from "./robot.js";

const dieOf = (v) => () => (v - 0.5) / 6;
const at = (color, q) => (q - STARTS[color] + LOOP) % LOOP;
// A state where `player` has just rolled `v`.
function rolled(st, player, v) {
  st.turn = player;
  applyMove(st, player, { type: "roll" }, dieOf(v));
  assert.equal(st.rolled, true, "the roll has a move");
  return st;
}
const pick = (st, me, level) => chooseMove(st, me, rngFromSeed("pick"), { level });

test("it rolls when it's time to roll", () => {
  for (const level of ["easy", "medium", "hard"]) assert.deepEqual(pick(newState(0), 0, level), { type: "roll" });
});

test("every level only ever picks a legal token", () => {
  const rng = rngFromSeed("legal");
  for (let i = 0; i < 300; i++) {
    const st = newState(0, {}, 4);
    for (const side of st.tokens) for (let k = 0; k < 4; k++) side[k] = Math.floor(rng() * 58) - 1;
    const v = 1 + Math.floor(rng() * 6);
    st.turn = 0;
    st.rolled = true;
    st.die = v;
    const moves = legalMoves(st, 0);
    if (!moves.length) continue;
    for (const level of ["easy", "medium", "hard"]) {
      const mv = chooseMove(st, 0, rng, { level });
      assert.ok(moves.some((m) => m.token === mv.token), `${level} picked a legal token`);
    }
  }
});

test("Medium and Hard take a capture", () => {
  const st = newState(0, {}, 4);
  st.tokens[0] = [18, 5, YARD, YARD];
  st.tokens[1][0] = at(1, square(0, 20));
  rolled(st, 0, 2);
  for (const level of ["medium", "hard"]) assert.equal(pick(st, 0, level).token, 0, level);
});

test("Hard runs a token out of danger onto a safe star", () => {
  const st = newState(0);
  // Red's token at 6 has yellow two behind it; a 2 takes it to the star on 8.
  st.tokens[0] = [6, 30, YARD, YARD];
  st.tokens[1] = [at(2, square(0, 4)), YARD, YARD, YARD];
  rolled(st, 0, 2);
  assert.ok(legalMoves(st, 0).find((m) => m.token === 0).safe);
  assert.equal(pick(st, 0, "hard").token, 0);
});

test("Hard brings a token into its home column rather than leave it exposed", () => {
  const st = newState(0);
  st.tokens[0] = [48, 20, YARD, YARD];
  st.tokens[1] = [at(2, square(0, 44)), YARD, YARD, YARD];
  rolled(st, 0, 4);
  assert.equal(pick(st, 0, "hard").token, 0);
});

test("Hard uses a 6 to bring a token out when nothing is at stake", () => {
  const st = newState(0);
  st.tokens[0] = [30, YARD, YARD, YARD];
  rolled(st, 0, 6);
  assert.equal(legalMoves(st, 0).find((m) => m.token === pick(st, 0, "hard").token).enter, true);
});

test("Hard with blocks on keeps a pair in front of a rival", () => {
  const st = newState(0, { blocks: true });
  st.tokens[0] = [20, 20, 40, YARD];
  st.tokens[1] = [at(2, square(0, 17)), YARD, YARD, YARD];
  rolled(st, 0, 3);
  assert.equal(pick(st, 0, "hard").token, 2, "moves the free token, not one from the pair");
});

// Robot vs robot, applying moves straight to the rules.
function game(levels, config, seed) {
  const rules = makeRules(config);
  const dice = rngFromSeed(`dice ${seed}`);
  const rng = rngFromSeed(`robot ${seed}`);
  const st = rules.newState(Math.floor(dice() * levels.length), levels.length);
  let worst = 0;
  while (st.winner === -1) {
    const p = st.turn;
    const t0 = performance.now();
    const mv = chooseMove(st, p, rng, { level: levels[p] });
    worst = Math.max(worst, performance.now() - t0);
    rules.applyMove(st, p, mv, dice);
  }
  return { st, worst };
}

test("Hard beats Easy most of the time", () => {
  let wins = 0;
  const n = 200;
  for (let i = 0; i < n; i++) {
    const hardSeat = i % 2;
    const levels = hardSeat ? ["easy", "hard"] : ["hard", "easy"];
    if (game(levels, {}, `hve ${i}`).st.winner === hardSeat) wins++;
  }
  assert.ok(wins / n > 0.65, `Hard won ${wins} of ${n}`);
});

test("robot vs robot always finishes, every level and house rule, well under 100 ms a move", () => {
  let worst = 0;
  for (const config of [{}, { blocks: true, captureBonus: true, threeSixes: false }, { places: false }]) {
    for (const levels of [["hard", "medium"], ["easy", "hard", "medium"], ["hard", "hard", "hard", "hard"], ["easy", "medium", "hard", "easy"]]) {
      for (let s = 0; s < 8; s++) {
        const r = game(levels, config, `${levels}-${JSON.stringify(config)}-${s}`);
        worst = Math.max(worst, r.worst);
        assert.equal(r.st.order.length, levels.length);
        assert.ok(r.st.tokens[r.st.winner].every((t) => t === HOME));
      }
    }
  }
  assert.ok(worst < 100, `slowest move took ${worst.toFixed(1)} ms`);
});
