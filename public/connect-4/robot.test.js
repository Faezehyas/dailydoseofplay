import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { chooseMove, LEVELS } from "./robot.js";
import { newState as newTimedState, applyMove, openColumns, landing, SIZES, DRAW } from "./rules.js";

const newState = (first, size = "7x6") => newTimedState(first, { size, moveSeconds: 0, gameSeconds: 0 });

// Build a mid-game 7×6 state from rows written top to bottom:
// x = player 0, o = player 1, . = empty. Discs must rest on something.
function stateFrom(rows, turn, first = 0) {
  const lines = rows.trim().split("\n").map((r) => r.replace(/\s/g, ""));
  const s = newState(first);
  lines.forEach((line, r) =>
    [...line].forEach((ch, c) => {
      if (ch === ".") return;
      s.board[r * 7 + c] = ch === "x" ? 0 : 1;
      s.heights[c]++;
      s.moves.push(c);
    }),
  );
  s.turn = turn;
  return s;
}

const randomPlayer = (s, me, rng) => {
  const open = openColumns(s);
  return { col: open[Math.floor(rng() * open.length)] };
};

// Play `games` games, alternating who starts; returns [wins of a, wins of b, draws].
function duel(a, b, games, seed, size = "7x6") {
  const tally = [0, 0, 0];
  for (let g = 0; g < games; g++) {
    const rng = rngFromSeed(`${seed}-${g}`);
    const s = newState(g % 2, size);
    while (s.winner === -1) applyMove(s, s.turn, (s.turn === 0 ? a : b)(s, s.turn, rng));
    tally[s.winner === DRAW ? 2 : s.winner]++;
  }
  return tally;
}
const level = (name) => (s, me, rng) => chooseMove(s, me, rng, { level: name });

test("it takes an immediate win, even when it could block instead", () => {
  const s = stateFrom(
    `.......
     .......
     .......
     .o.....
     .ox....
     .oxx.x.`,
    0,
  );
  for (const name of Object.keys(LEVELS)) {
    for (let seed = 0; seed < 20; seed++) assert.equal(chooseMove(s, 0, rngFromSeed(seed), { level: name, randomChance: 1 }).col, 4, name);
  }
});

test("it blocks an immediate loss", () => {
  const s = stateFrom(
    `.......
     .......
     .......
     .......
     ...x...
     .ooox.x`,
    0,
  );
  for (const name of Object.keys(LEVELS)) {
    for (let seed = 0; seed < 20; seed++) assert.equal(chooseMove(s, 0, rngFromSeed(seed), { level: name, randomChance: 1 }).col, 0, name);
  }
});

test("it sets up an open three that can't be stopped", () => {
  const s = stateFrom(
    `.......
     .......
     .......
     .......
     ......o
     ..xx..o`,
    0,
  );
  for (const name of Object.keys(LEVELS)) {
    for (let seed = 0; seed < 10; seed++) assert.ok([1, 4].includes(chooseMove(s, 0, rngFromSeed(seed), { level: name, randomChance: 0 }).col), name);
  }
});

// o has three on the second row, so a disc in column 0 or 4 lets o win on top.
const UNDER_THREAT = stateFrom(
  `.......
   .......
   .......
   .......
   .ooo...
   .xxo.xx`,
  0,
);

test("it doesn't drop a disc under the opponent's winning square", () => {
  for (const name of ["medium", "hard"]) {
    for (let seed = 0; seed < 20; seed++) assert.ok(![0, 4].includes(chooseMove(UNDER_THREAT, 0, rngFromSeed(seed), { level: name }).col), name);
  }
});

test("the levels play visibly differently: Hard > Medium > Easy", () => {
  const [hardWins] = duel(level("hard"), level("easy"), 30, "hard-easy");
  const [mediumWins] = duel(level("medium"), level("easy"), 30, "medium-easy");
  assert.ok(hardWins >= 24, `Hard beat Easy ${hardWins}/30`);
  assert.ok(mediumWins >= 20, `Medium beat Easy ${mediumWins}/30`);
  // Easy's random moves can hand over a win; Medium's and Hard's never do.
  const picks = (name) => new Set(Array.from({ length: 60 }, (_, seed) => chooseMove(UNDER_THREAT, 0, rngFromSeed(seed), { level: name, randomChance: 1 }).col));
  assert.ok(picks("easy").has(0) || picks("easy").has(4), "Easy blunders sometimes");
  for (const name of ["medium", "hard"]) assert.ok(!picks(name).has(0) && !picks(name).has(4), name);
});

test("every level beats a random player almost always", () => {
  for (const name of Object.keys(LEVELS)) {
    const [won] = duel(level(name), randomPlayer, 30, `rand-${name}`);
    assert.ok(won >= 28, `${name} won ${won}/30`);
  }
});

test("robot vs robot over 20 seeded games always finishes with legal moves, on every board", () => {
  const names = Object.keys(LEVELS);
  for (const size of SIZES) {
    const games = size === "7x6" ? 20 : 4;
    for (let g = 0; g < games; g++) {
      const rng = rngFromSeed(`rvr-${size}-${g}`);
      const s = newState(g % 2, size);
      const levels = [names[g % 3], names[(g + 1) % 3]];
      while (s.winner === -1) {
        const move = chooseMove(s, s.turn, rng, { level: levels[s.turn] });
        assert.ok(landing(s, move.col) >= 0, "an open column");
        applyMove(s, s.turn, move);
        assert.ok(s.moves.length <= s.board.length);
      }
      assert.ok([0, 1, DRAW].includes(s.winner));
    }
  }
});

test("it answers well under 100 ms, from a cold start and on every board", async () => {
  const { chooseMove: fresh } = await import(`./robot.js?cold=${Date.now()}`);
  let worst = 0;
  for (const size of SIZES) {
    const t0 = performance.now();
    fresh(newState(0, size), 0, () => 0.99, { level: "hard" });
    worst = Math.max(worst, performance.now() - t0);
    // Mid-game positions from random openings.
    for (let g = 0; g < 4; g++) {
      const rng = rngFromSeed(`speed-${size}-${g}`);
      const s = newState(g % 2, size);
      for (let k = 0; k < 6 + 4 * g && s.winner === -1; k++) applyMove(s, s.turn, randomPlayer(s, s.turn, rng));
      if (s.winner !== -1) continue;
      const t1 = performance.now();
      fresh(s, s.turn, () => 0.99, { level: "hard" });
      worst = Math.max(worst, performance.now() - t1);
    }
  }
  assert.ok(worst < 100, `slowest answer ${worst.toFixed(1)} ms`);
});
