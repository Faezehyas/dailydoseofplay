import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { chooseMove } from "./robot.js";
import { newState as newTimedState, applyMove, legalPlays, CHECKERS, BAR, OFF } from "./rules.js";

const newState = (first = 0) => newTimedState(first, { moveSeconds: 0, gameSeconds: 0 });
const dice = (...values) => {
  let i = 0;
  return () => (values[i++ % values.length] - 0.5) / 6;
};
function side(spec) {
  const s = Array(26).fill(0);
  for (const [k, v] of Object.entries(spec)) s[k === "bar" ? BAR : Number(k)] = v;
  s[OFF] = CHECKERS - s.reduce((a, b) => a + b, 0);
  return s;
}
function rolled(mine, theirs, a, b) {
  const s = newState(0);
  s.pos = [side(mine), side(theirs)];
  applyMove(s, 0, { type: "roll" }, dice(a, b));
  return s;
}
const notation = (steps) => steps.map(([from, die]) => `${from}/${Math.max(0, from - die)}`).join(" ");

test("it rolls first, then plays a legal play for the roll", () => {
  const s = newState(1);
  assert.deepEqual(chooseMove(s, 1, rngFromSeed("r")), { type: "roll" });
  applyMove(s, 1, { type: "roll" }, dice(6, 4));
  const move = chooseMove(s, 1, rngFromSeed("r"));
  assert.equal(move.type, "play");
  applyMove(s, 1, move);
  assert.equal(s.turn, 0);
});

test("it takes a win, even at its most random", () => {
  // 2/off 1/off wins; 2/1 1/off leaves a checker.
  const s = rolled({ 2: 1, 1: 1 }, { 6: 15 }, 2, 1);
  for (let seed = 0; seed < 30; seed++) {
    for (const level of ["easy", "medium", "hard"]) {
      const move = chooseMove(s, 0, rngFromSeed(seed), { level, randomChance: 1 });
      const t = structuredClone(s);
      applyMove(t, 0, move);
      assert.equal(t.winner, 0, `${level} ${notation(move.steps)}`);
    }
  }
});

test("it blocks a loss: when the opponent could bear off next turn, it hits", () => {
  // They have two checkers left; their blot on their 2 point is your 23.
  const s = rolled({ 24: 1, 6: 5, 5: 5, 4: 4 }, { 2: 1, 1: 1 }, 3, 1);
  for (let seed = 0; seed < 30; seed++) {
    for (const level of ["easy", "medium", "hard"]) {
      const move = chooseMove(s, 0, rngFromSeed(seed), { level, randomChance: 1 });
      const t = structuredClone(s);
      applyMove(t, 0, move);
      assert.equal(t.pos[1][BAR], 1, `${level} ${notation(move.steps)}`);
    }
  }
});

test("Hard plays the standard strong openings", () => {
  const best = { "3-1": "8/5 6/5", "4-2": "8/4 6/4", "6-1": "13/7 8/7", "5-3": "8/3 6/3", "6-5": "24/18 18/13" };
  for (const [roll, play] of Object.entries(best)) {
    const [a, b] = roll.split("-").map(Number);
    const s = newState(0);
    applyMove(s, 0, { type: "roll" }, dice(a, b));
    assert.equal(notation(chooseMove(s, 0, rngFromSeed(roll), { level: "hard" }).steps), play, roll);
  }
});

test("it keeps its checkers safe when it can: 8/2 6/2 leaves no blot", () => {
  // Every other 6-4 leaves a blot within reach of their back checkers.
  const s = rolled({ 13: 2, 8: 3, 6: 5, 5: 2, 4: 3 }, { 24: 2, 13: 5, 8: 3, 6: 5 }, 6, 4);
  assert.ok(legalPlays(s.pos, 0, s.dice).length > 5);
  for (const level of ["easy", "medium", "hard"]) {
    assert.equal(notation(chooseMove(s, 0, rngFromSeed(level), { level, randomChance: 0 }).steps), "8/2 6/2", level);
  }
});

// Play a whole game between two choosers; returns the winner.
function game(choosers, seed, first) {
  const rng = rngFromSeed(`pick-${seed}`);
  const roll = rngFromSeed(`dice-${seed}`);
  const s = newState(first);
  let moves = 0;
  while (s.winner === -1) {
    applyMove(s, s.turn, choosers[s.turn](s, s.turn, rng), roll);
    assert.ok(++moves < 3000, "the game ends");
  }
  return s;
}
const level = (name) => (s, me, rng) => chooseMove(s, me, rng, { level: name });
function winRate(a, b, games = 200) {
  let wins = 0;
  for (let g = 0; g < games; g++) {
    // a sits on each side and starts in half of the games.
    const swap = g % 2 === 1;
    const s = game(swap ? [b, a] : [a, b], `${g}`, (g >> 1) % 2);
    if (s.winner === (swap ? 1 : 0)) wins++;
  }
  return wins / games;
}

test("robot vs robot over 20 seeded games always finishes with legal moves, at every level", () => {
  const levels = ["easy", "medium", "hard"];
  for (let g = 0; g < 20; g++) {
    const s = game([level(levels[g % 3]), level(levels[(g + 1) % 3])], `rvr-${g}`, g % 2);
    assert.equal(s.reason, "off");
    assert.equal(s.pos[s.winner][OFF], CHECKERS);
  }
});

test("the levels play visibly differently: Hard beats Medium, and both beat Easy", () => {
  const hardEasy = winRate(level("hard"), level("easy"));
  const hardMedium = winRate(level("hard"), level("medium"));
  const mediumEasy = winRate(level("medium"), level("easy"));
  assert.ok(hardEasy > 0.75, `hard beat easy ${hardEasy}`);
  assert.ok(hardMedium > 0.55, `hard beat medium ${hardMedium}`);
  assert.ok(mediumEasy > 0.6, `medium beat easy ${mediumEasy}`);
});

test("Easy still beats a random player most of the time", () => {
  const random = (s, me, rng) => {
    if (!s.rolled) return { type: "roll" };
    const plays = legalPlays(s.pos, me, s.dice);
    return { type: "play", steps: plays[Math.floor(rng() * plays.length)].steps };
  };
  assert.ok(winRate(level("easy"), random, 100) > 0.85);
});

test("it answers well under 100 ms, even with doubles on a crowded board", async () => {
  const { chooseMove: fresh } = await import(`./robot.js?cold=${Date.now()}`);
  const spread = [side({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1 }), side({ 24: 3, 20: 3, 16: 3, 12: 3, 8: 3 })];
  let worst = 0;
  for (const pos of [newState().pos, spread]) {
    for (let a = 1; a <= 6; a++) {
      for (let b = a; b <= 6; b++) {
        const s = newState(0);
        s.pos = structuredClone(pos);
        applyMove(s, 0, { type: "roll" }, dice(a, b));
        if (s.turn !== 0) continue;
        for (const lvl of ["easy", "hard"]) {
          const t0 = performance.now();
          fresh(s, 0, () => 0.99, { level: lvl });
          worst = Math.max(worst, performance.now() - t0);
        }
      }
    }
  }
  assert.ok(worst < 100, `${worst.toFixed(1)} ms`);
});
