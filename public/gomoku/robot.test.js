import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { chooseMove, shapesAt, candidates, SHAPE } from "./robot.js";
import { newState as newTimedState, applyMove, SIZE, EMPTY, DRAW } from "./rules.js";

const newState = (first) => newTimedState(first, { moveSeconds: 0, gameSeconds: 0 });
const at = (r, c) => r * SIZE + c;

// A mid-game state with stones placed by [row, col]: xs for player 0, os for player 1.
function stateWith(xs, os, turn) {
  const s = newState(0);
  for (const [r, c] of xs) s.board[at(r, c)] = 0;
  for (const [r, c] of os) s.board[at(r, c)] = 1;
  s.moves = s.board.flatMap((v, i) => (v === EMPTY ? [] : [i]));
  s.turn = turn;
  return s;
}

// The shape a player-0 stone on "?" makes along a row pattern (x mine, o theirs, . empty).
function shapeOf(pattern) {
  const s = newState(0);
  let cell = -1;
  [...pattern].forEach((ch, i) => {
    if (ch === "x") s.board[at(7, i)] = 0;
    if (ch === "o") s.board[at(7, i)] = 1;
    if (ch === "?") cell = at(7, i);
  });
  return shapesAt(s.board, cell, 0)[0];
}

// Points where `player` would make five or an open four.
const threats = (s, player) => candidates(s.board).filter((cell) => shapesAt(s.board, cell, player).some((x) => x >= SHAPE.OPEN_FOUR));

test("it reads the shape a stone makes along a line", () => {
  const cases = {
    "xx?xx": SHAPE.FIVE,
    "xxx?xx": SHAPE.FIVE, // an overline wins too
    ".?xxx.": SHAPE.OPEN_FOUR,
    ".xx?x..": SHAPE.OPEN_FOUR,
    "o?xxx..": SHAPE.FOUR,
    "x.?xx.o": SHAPE.FOUR,
    "..?xx..": SHAPE.OPEN_THREE,
    ".x.?x.x.": SHAPE.OPEN_THREE,
    "o.?xx.o": SHAPE.THREE,
    "o?xx...": SHAPE.THREE,
    "..?x...": SHAPE.OPEN_TWO,
    "o?x....": SHAPE.TWO,
    "...?...": SHAPE.ONE,
    "o?xxxo": SHAPE.NONE, // no room left for five
  };
  for (const [pattern, shape] of Object.entries(cases)) assert.equal(shapeOf(pattern), shape, pattern);
});

test("the edge of the board blocks a line", () => {
  const s = newState(0);
  for (const c of [1, 2, 3]) s.board[at(0, c)] = 0;
  assert.equal(shapesAt(s.board, at(0, 0), 0)[0], SHAPE.FOUR);
  assert.equal(shapesAt(s.board, at(0, 4), 0)[0], SHAPE.OPEN_FOUR);
});

test("it takes an immediate win, even when it could block instead", () => {
  const s = stateWith([[3, 3], [3, 4], [3, 5], [3, 6]], [[9, 3], [9, 4], [9, 5], [9, 6], [3, 2]], 1);
  for (let seed = 0; seed < 30; seed++) {
    const move = chooseMove(s, 1, rngFromSeed(seed), { randomChance: 1 });
    assert.ok([at(9, 2), at(9, 7)].includes(move.cell), `seed ${seed}: ${move.cell}`);
  }
});

test("it blocks an immediate loss", () => {
  const s = stateWith([[3, 3], [4, 4], [5, 5], [6, 6]], [[2, 2], [9, 9], [9, 10]], 1);
  for (let seed = 0; seed < 30; seed++) assert.equal(chooseMove(s, 1, rngFromSeed(seed), { randomChance: 1 }).cell, at(7, 7));
});

test("it stops an open three before it becomes an open four", () => {
  const s = stateWith([[7, 6], [7, 7], [7, 8], [2, 2]], [[8, 8], [10, 2], [3, 12]], 1);
  assert.equal(threats(s, 0).length, 2);
  for (let seed = 0; seed < 30; seed++) {
    const next = structuredClone(s);
    applyMove(next, 1, chooseMove(next, 1, rngFromSeed(seed), { randomChance: 0 }));
    assert.deepEqual(threats(next, 0), [], `seed ${seed}`);
  }
});

test("it turns its own open three into an open four rather than defend", () => {
  const s = stateWith([[2, 6], [2, 7], [2, 8], [12, 1]], [[7, 6], [7, 7], [7, 8], [0, 14]], 1);
  for (let seed = 0; seed < 30; seed++) {
    const { cell } = chooseMove(s, 1, rngFromSeed(seed), { randomChance: 0 });
    assert.ok([at(7, 5), at(7, 9)].includes(cell), `seed ${seed}: ${cell}`);
  }
});

test("it plays a double threat when it has one", () => {
  // Two crossing twos: only (7, 8) makes two open threes at once.
  const s = stateWith([[7, 5], [7, 6], [5, 8], [6, 8]], [[0, 0], [0, 14], [14, 0], [14, 14]], 0);
  for (let seed = 0; seed < 30; seed++) assert.equal(chooseMove(s, 0, rngFromSeed(seed), { randomChance: 0 }).cell, at(7, 8));
});

test("it opens in the centre and answers next to the first stone", () => {
  assert.equal(chooseMove(newState(0), 0, rngFromSeed(1)).cell, at(7, 7));
  const s = newState(0);
  applyMove(s, 0, { cell: at(3, 11) });
  for (let seed = 0; seed < 30; seed++) {
    const { cell } = chooseMove(s, 1, rngFromSeed(seed));
    assert.ok(Math.abs(Math.floor(cell / SIZE) - 3) <= 2 && Math.abs((cell % SIZE) - 11) <= 2, `seed ${seed}: ${cell}`);
  }
});

function playGame(players, seed, first = 0) {
  const rng = rngFromSeed(seed);
  const s = newState(first);
  while (s.winner === -1) {
    const move = players[s.turn](s, s.turn, rng);
    assert.equal(s.board[move.cell], EMPTY);
    applyMove(s, s.turn, move);
  }
  return s;
}
const robot = (s, me, rng) => chooseMove(s, me, rng);
const steady = (s, me, rng) => chooseMove(s, me, rng, { randomChance: 0 });
const random = (s, me, rng) => {
  const free = s.board.flatMap((v, i) => (v === EMPTY ? [i] : []));
  return { cell: free[Math.floor(rng() * free.length)] };
};

test("robot vs robot over 20 seeded games always finishes with legal moves", () => {
  for (let g = 0; g < 20; g++) {
    const s = playGame([robot, robot], `rvr-${g}`, g % 2);
    assert.ok([0, 1, DRAW].includes(s.winner));
    assert.ok(s.moves.length <= SIZE * SIZE);
    assert.equal(new Set(s.moves).size, s.moves.length);
  }
});

test("it beats a random player every time", () => {
  for (let g = 0; g < 100; g++) assert.equal(playGame([random, robot], `rand-${g}`, g % 2).winner, 1, `game ${g}`);
});

test("it is beatable: without its random moves it wins most games against itself", () => {
  const wins = [0, 0];
  for (let g = 0; g < 100; g++) {
    const { winner } = playGame([steady, robot], `beat-${g}`, g % 2);
    if (winner !== DRAW) wins[winner]++;
  }
  assert.ok(wins[0] > 60, `steady won ${wins[0]}/100`);
  assert.ok(wins[1] > 5, `robot won ${wins[1]}/100`);
});

test("it answers well under 100 ms, on an empty board and a crowded one", async () => {
  const { chooseMove: fresh } = await import(`./robot.js?cold=${Date.now()}`);
  let t0 = performance.now();
  fresh(newState(0), 0, () => 0.99);
  assert.ok(performance.now() - t0 < 100, "empty board");
  // 150 stones in pairs flipped on every row, so nobody has five.
  const s = newState(0);
  for (let i = 0; i < 150; i++) {
    const [r, c] = [Math.floor(i / SIZE), i % SIZE];
    s.board[i] = (Math.floor(c / 2) + r) % 2;
  }
  t0 = performance.now();
  for (let k = 0; k < 10; k++) fresh(s, k % 2, () => 0.99);
  assert.ok((performance.now() - t0) / 10 < 100, "crowded board");
});
