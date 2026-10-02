import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { chooseMove, scoreMoves } from "./robot.js";
import { newState as newTimedState, applyMove, emptyCells, EMPTY, DRAW } from "./rules.js";

const newState = (first, size = 3) => newTimedState(first, { size, moveSeconds: 0, gameSeconds: 0 });

// Build a mid-game state from a board string: x = player 0, o = player 1, . = empty.
function stateFrom(rows, turn) {
  const cells = rows.replace(/\s/g, "");
  const s = newState(0, Math.sqrt(cells.length));
  s.board = cells.split("").map((ch) => (ch === "x" ? 0 : ch === "o" ? 1 : EMPTY));
  s.moves = s.board.flatMap((v, i) => (v === EMPTY ? [] : [i]));
  s.turn = turn;
  return s;
}

const perfect = (state, me) => {
  const scored = scoreMoves(state.board, me);
  return { cell: scored.reduce((a, b) => (b.score > a.score ? b : a)).cell };
};

test("it takes an immediate win, even when it could block instead", () => {
  const s = stateFrom("xx. oo. ...", 1);
  for (let seed = 0; seed < 50; seed++) assert.equal(chooseMove(s, 1, rngFromSeed(seed), { randomChance: 1 }).cell, 5);
});

test("it blocks an immediate loss", () => {
  const s = stateFrom("x.. .x. o..", 1);
  for (let seed = 0; seed < 50; seed++) assert.equal(chooseMove(s, 1, rngFromSeed(seed), { randomChance: 1 }).cell, 8);
});

test("without random moves it never loses, whatever the opponent does", () => {
  let games = 0;
  function explore(state, robot) {
    if (state.winner !== -1) {
      assert.notEqual(state.winner, 1 - robot, `robot lost: ${state.moves}`);
      games++;
      return;
    }
    if (state.turn === robot) {
      const next = structuredClone(state);
      applyMove(next, robot, chooseMove(next, robot, () => 0, { randomChance: 0 }));
      return explore(next, robot);
    }
    for (const cell of emptyCells(state.board)) {
      const next = structuredClone(state);
      applyMove(next, next.turn, { cell });
      explore(next, robot);
    }
  }
  for (const first of [0, 1]) explore(newState(first), 1);
  assert.ok(games > 100);
});

test("it is beatable: a perfect player wins sometimes, but not most games", () => {
  let lost = 0;
  let won = 0;
  const games = 300;
  for (let g = 0; g < games; g++) {
    const rng = rngFromSeed(`beat-${g}`);
    const s = newState(g % 2);
    while (s.winner === -1) applyMove(s, s.turn, s.turn === 1 ? chooseMove(s, 1, rng) : perfect(s, 0));
    if (s.winner === 0) lost++;
    if (s.winner === 1) won++;
  }
  assert.equal(won, 0, "nobody beats a perfect player");
  assert.ok(lost > games * 0.05, `robot lost ${lost}/${games}`);
  assert.ok(lost < games * 0.5, `robot lost ${lost}/${games}`);
});

test("it beats a random player most of the time", () => {
  let won = 0;
  let lost = 0;
  for (let g = 0; g < 200; g++) {
    const rng = rngFromSeed(`rand-${g}`);
    const s = newState(g % 2);
    while (s.winner === -1) {
      const free = emptyCells(s.board);
      applyMove(s, s.turn, s.turn === 1 ? chooseMove(s, 1, rng) : { cell: free[Math.floor(rng() * free.length)] });
    }
    if (s.winner === 1) won++;
    if (s.winner === 0) lost++;
  }
  assert.ok(won > 120, `won ${won}/200`);
  assert.ok(lost < 20, `lost ${lost}/200`);
});

test("robot vs robot over 20 seeded games always finishes with legal moves, on both boards", () => {
  for (const size of [3, 5]) {
    for (let g = 0; g < 20; g++) {
      const rng = rngFromSeed(`rvr-${size}-${g}`);
      const s = newState(g % 2, size);
      let moves = 0;
      while (s.winner === -1) {
        const move = chooseMove(s, s.turn, rng);
        assert.equal(s.board[move.cell], EMPTY);
        applyMove(s, s.turn, move);
        assert.ok(++moves <= size * size);
      }
      assert.ok([0, 1, DRAW].includes(s.winner));
    }
  }
});

test("it answers well under 100 ms, even on an empty board", async () => {
  const { chooseMove: fresh } = await import(`./robot.js?cold=${Date.now()}`);
  for (const size of [3, 5]) {
    const t0 = performance.now();
    fresh(newState(0, size), 0, () => 0.99);
    assert.ok(performance.now() - t0 < 100, `${size}×${size}`);
  }
});

// ---------- 5×5, four in a row ----------

test("5×5: it takes a win, then blocks one", () => {
  const win = stateFrom(". o o o .  x x x . .  . . . . .  . . . . .  . . . . .", 0);
  for (let seed = 0; seed < 20; seed++) assert.equal(chooseMove(win, 0, rngFromSeed(seed), { randomChance: 1 }).cell, 8);
  const block = stateFrom("x . . . .  . x . . .  . . x . .  o o . . .  . . . . .", 1);
  for (let seed = 0; seed < 20; seed++) assert.equal(chooseMove(block, 1, rngFromSeed(seed), { randomChance: 1 }).cell, 18);
});

test("5×5: it sets up a double threat when it can", () => {
  // x to move: only the centre gives two ways to make four at once.
  const s = stateFrom("o . . . o  . . x . .  . x . x .  . . x . .  o . . . o", 0);
  for (let seed = 0; seed < 20; seed++) assert.equal(chooseMove(s, 0, rngFromSeed(seed), { randomChance: 0 }).cell, 12);
});

test("5×5: it beats a random player almost always", () => {
  let won = 0;
  for (let g = 0; g < 100; g++) {
    const rng = rngFromSeed(`rand5-${g}`);
    const s = newState(g % 2, 5);
    while (s.winner === -1) {
      const free = emptyCells(s.board);
      applyMove(s, s.turn, s.turn === 1 ? chooseMove(s, 1, rng) : { cell: free[Math.floor(rng() * free.length)] });
    }
    if (s.winner === 1) won++;
  }
  assert.ok(won >= 95, `won ${won}/100`);
});
