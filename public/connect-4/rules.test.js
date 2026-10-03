import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import {
  makeRules,
  newState as newTimedState,
  applyMove,
  colorOf,
  landing,
  openColumns,
  linesFor,
  linesThrough,
  dimensions,
  normalizeConfig,
  timeLeft,
  DEFAULT_CONFIG,
  SIZES,
  EMPTY,
  DRAW,
} from "./rules.js";

const untimed = (size = "7x6") => ({ size, moveSeconds: 0, gameSeconds: 0 });
const newState = (first, size) => newTimedState(first, untimed(size));

// Drop discs in these columns in order, alternating from whoever's turn it is.
function play(first, cols, size) {
  const state = newState(first, size);
  for (const col of cols) applyMove(state, state.turn, { col });
  return state;
}

// Square for (column, row counted from the bottom, 0-based).
const at = (state, col, row) => (state.rows - 1 - row) * state.cols + col;

test("a new game is an empty 7×6 board, and the starter plays coral", () => {
  for (const first of [0, 1]) {
    const s = newState(first);
    assert.equal(s.turn, first);
    assert.equal(s.winner, -1);
    assert.equal(s.cols, 7);
    assert.equal(s.rows, 6);
    assert.deepEqual(s.board, Array(42).fill(EMPTY));
    assert.deepEqual(s.heights, Array(7).fill(0));
    assert.equal(colorOf(s, first), "coral");
    assert.equal(colorOf(s, 1 - first), "teal");
  }
});

test("a disc drops to the lowest free square, and discs stack", () => {
  const s = newState(0);
  assert.equal(landing(s, 3), 38);
  const events = applyMove(s, 0, { col: 3 });
  assert.deepEqual(events, [{ type: "dropped", col: 3, cell: 38, player: 0 }]);
  assert.equal(s.board[38], 0);
  assert.equal(s.turn, 1);
  applyMove(s, 1, { col: 3 });
  assert.equal(s.board[31], 1, "the second disc sits on the first");
  assert.deepEqual(s.heights, [0, 0, 0, 2, 0, 0, 0]);
  assert.deepEqual(s.moves, [3, 3]);
  assert.equal(landing(s, 3), 24);
});

test("a full column is illegal and drops out of the open columns", () => {
  const s = play(0, [2, 2, 2, 2, 2, 2]);
  assert.equal(s.heights[2], 6);
  assert.equal(landing(s, 2), -1);
  assert.deepEqual(openColumns(s), [0, 1, 3, 4, 5, 6]);
  const snapshot = structuredClone(s);
  assert.throws(() => applyMove(s, s.turn, { col: 2 }), (err) => err instanceof RuleError && /column is full/.test(err.message));
  assert.deepEqual(s, snapshot);
});

test("four across, down and along both diagonals win", () => {
  // Across the bottom row; the loser stacks on top.
  const across = play(0, [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(across.winner, 0);
  assert.deepEqual(across.line, [0, 1, 2, 3].map((c) => at(across, c, 0)).sort((a, b) => a - b));

  // Down a column.
  const down = play(1, [4, 5, 4, 5, 4, 5, 4]);
  assert.equal(down.winner, 1);
  assert.deepEqual(down.line, [0, 1, 2, 3].map((r) => at(down, 4, r)).sort((a, b) => a - b));

  // Up and to the right: (0,0) (1,1) (2,2) (3,3).
  const rising = play(0, [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  assert.equal(rising.winner, 0);
  assert.deepEqual(rising.line, [[0, 0], [1, 1], [2, 2], [3, 3]].map(([c, r]) => at(rising, c, r)).sort((a, b) => a - b));

  // Up and to the left: (6,0) (5,1) (4,2) (3,3).
  const falling = play(0, [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
  assert.equal(falling.winner, 0);
  assert.deepEqual(falling.line, [[6, 0], [5, 1], [4, 2], [3, 3]].map(([c, r]) => at(falling, c, r)).sort((a, b) => a - b));
  assert.equal(falling.reason, "line");
});

test("three in a row is not enough, and the winning drop reports the line", () => {
  const s = play(0, [0, 0, 1, 1, 2, 2]);
  assert.equal(s.winner, -1);
  const events = applyMove(s, 0, { col: 3 });
  assert.deepEqual(events[0], { type: "dropped", col: 3, cell: at(s, 3, 0), player: 0 });
  assert.equal(events[1].type, "win");
  assert.deepEqual(events[1].line, s.line);
  assert.equal(s.turn, 0, "the turn stays put once the game is over");
});

test("a drop that makes five in a row, or two lines at once, lights every disc in them", () => {
  // Bottom row 0 1 _ 3 4 for player 0, then the gap.
  const five = play(0, [0, 0, 1, 1, 3, 3, 4, 4, 2]);
  assert.equal(five.winner, 0);
  assert.deepEqual(five.line, [0, 1, 2, 3, 4].map((c) => at(five, c, 0)));
  const s = newState(0);
  s.board = Array(42).fill(EMPTY);
  for (const [c, r] of [[0, 0], [1, 0], [2, 0], [3, 1], [3, 2], [3, 3]]) s.board[at(s, c, r)] = 0;
  s.board[at(s, 3, 0)] = 0;
  assert.equal(linesThrough(s.board, 7, 6, at(s, 3, 0)).length, 7, "a row of four and a column of four share a square");
});

test("a full board with no four in a row is a draw", () => {
  const order = [0, 2, 2, 2, 4, 2, 3, 0, 2, 2, 1, 4, 5, 3, 1, 1, 0, 1, 0, 1, 0, 4, 1, 4, 5, 5, 5, 5, 4, 0, 3, 6, 3, 4, 6, 6, 3, 6, 5, 6, 6];
  const s = play(0, order);
  assert.equal(s.winner, -1);
  const events = applyMove(s, s.turn, { col: 3 });
  assert.deepEqual(events.at(-1), { type: "draw" });
  assert.equal(s.winner, DRAW);
  assert.equal(s.reason, "draw");
  assert.equal(s.line, null);
  assert.deepEqual(openColumns(s), []);
});

test("illegal moves throw RuleError and leave the state alone", () => {
  const s = newState(0);
  applyMove(s, 0, { col: 3 });
  const snapshot = structuredClone(s);
  const cases = [
    [0, { col: 0 }, /Not your turn/],
    [1, { col: 7 }, /column on the board/],
    [1, { col: -1 }, /column on the board/],
    [1, { col: 1.5 }, /column on the board/],
    [1, { col: "3" }, /column on the board/],
    [1, { cell: 3 }, /column on the board/],
    [1, {}, /column on the board/],
    [1, null, /column on the board/],
  ];
  for (const [player, move, msg] of cases) {
    assert.throws(() => applyMove(s, player, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
    assert.deepEqual(s, snapshot);
  }
});

test("no move is accepted after the game is over", () => {
  const s = play(0, [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(s.winner, 0);
  assert.throws(() => applyMove(s, 1, { col: 6 }), /game is over/);
  assert.throws(() => applyMove(s, 0, { col: 6 }), /game is over/);
});

test("a scripted full game ends in the expected state", () => {
  // The guest opens in the centre and wins on the diagonal that ends there.
  const s = play(1, [3, 2, 2, 1, 4, 1, 1, 0, 0, 0, 0]);
  assert.equal(s.winner, 1);
  assert.deepEqual(s.line, [[0, 3], [1, 2], [2, 1], [3, 0]].map(([c, r]) => at(s, c, r)).sort((a, b) => a - b));
  assert.deepEqual(s.heights, [4, 3, 2, 1, 1, 0, 0]);
  assert.equal(s.moves.length, 11);
  assert.equal(colorOf(s, 1), "coral");
  assert.equal(s.reason, "line");
});

// ---------- bigger boards ----------

test("every board size has the right lines, all four long", () => {
  for (const size of SIZES) {
    const { cols, rows } = dimensions(size);
    const lines = linesFor(cols, rows);
    const expected = (cols - 3) * rows + cols * (rows - 3) + 2 * (cols - 3) * (rows - 3);
    assert.equal(lines.length, expected, size);
    assert.ok(lines.every((l) => l.length === 4));
  }
  assert.deepEqual(dimensions("9x7"), { cols: 9, rows: 7 });
});

test("bigger boards: discs fall to their own bottom row, and the edges win", () => {
  const s = newState(0, "9x9");
  assert.equal(s.board.length, 81);
  assert.equal(landing(s, 8), 80);
  const edge = play(0, [8, 0, 8, 0, 8, 0, 8], "9x9");
  assert.equal(edge.winner, 0);
  assert.deepEqual(edge.line, [3, 2, 1, 0].map((r) => at(edge, 8, r)));
  const wide = play(1, [4, 4, 5, 5, 6, 6, 7], "8x7");
  assert.equal(wide.winner, 1, "four along the bottom right of an 8×7 board");
  assert.deepEqual(wide.line, [4, 5, 6, 7].map((c) => at(wide, c, 0)));
});

test("a full 9×9 board with no four in a row is a draw", () => {
  const order = [5, 7, 7, 5, 4, 6, 6, 0, 3, 5, 1, 8, 5, 5, 4, 0, 5, 3, 1, 3, 8, 1, 7, 0, 4, 3, 1, 1, 6, 6, 7, 4, 3, 3, 1, 8, 6, 2, 6, 7, 6, 1, 1, 8, 8, 5, 0, 0, 8, 1, 8, 3, 2, 7, 3, 5, 2, 8, 5, 6, 3, 7, 0, 2, 6, 8, 2, 0, 7, 4, 0, 2, 2, 2, 7, 0, 4, 4, 4, 4, 2];
  const s = play(0, order, "9x9");
  assert.equal(s.winner, DRAW);
  assert.equal(s.moves.length, 81);
});

// ---------- settings ----------

test("settings default to papergames' values and reject unknown ones", () => {
  assert.deepEqual(DEFAULT_CONFIG, { size: "7x6", moveSeconds: 40, gameSeconds: 240, first: "random", level: "medium" });
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ size: "6x7", moveSeconds: 5, gameSeconds: "240", first: "me", level: "expert" }), DEFAULT_CONFIG);
  const custom = { size: "9x7", moveSeconds: 0, gameSeconds: 60, first: "guest", level: "hard" };
  assert.deepEqual(normalizeConfig({ ...custom, extra: 1 }), custom);
});

test("who moves first: the coin toss, or the room's fixed choice", () => {
  for (const coin of [0, 1]) {
    assert.equal(makeRules({ first: "random" }).newState(coin).turn, coin);
    assert.equal(makeRules({ first: "host" }).newState(coin).turn, 0);
    assert.equal(makeRules({ first: "guest" }).newState(coin).turn, 1);
    assert.equal(colorOf(makeRules({ first: "guest" }).newState(coin), 1), "coral", "the starter plays coral");
  }
  assert.equal(makeRules({}).needsRandom(), false);
  assert.equal(makeRules({ size: "8x8" }).newState(0).board.length, 64);
});

// ---------- clocks ----------

test("timed moves spend the mover's clock", () => {
  const s = makeRules({ moveSeconds: 40, gameSeconds: 60 }).newState(0);
  assert.equal(s.moveMs, 40_000);
  assert.deepEqual(s.clocks, [60_000, 60_000]);
  applyMove(s, 0, { col: 3, ms: 12_345 });
  applyMove(s, 1, { col: 3, ms: 1_000 });
  assert.deepEqual(s.clocks, [47_655, 59_000]);
  assert.equal(timeLeft(s, 0), 40_000, "the move limit is the tighter one");
  s.clocks[0] = 2_000;
  assert.equal(timeLeft(s, 0), 2_000, "the game clock is the tighter one");
});

test("timed moves need an honest move time within the limits", () => {
  const s = makeRules({ moveSeconds: 10, gameSeconds: 0 }).newState(0);
  assert.equal(s.clocks, null);
  for (const [move, msg] of [
    [{ col: 3 }, /Move time missing/],
    [{ col: 3, ms: -1 }, /Move time missing/],
    [{ col: 3, ms: 1.5 }, /Move time missing/],
    [{ col: 3, ms: 10_001 }, /Time ran out/],
  ]) {
    assert.throws(() => applyMove(s, 0, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
  }
  applyMove(s, 0, { col: 3, ms: 10_000 });
  const bank = makeRules({ moveSeconds: 0, gameSeconds: 60 }).newState(0);
  bank.clocks[0] = 500;
  assert.throws(() => applyMove(bank, 0, { col: 0, ms: 501 }), /Time ran out/);
});

test("running out of time loses the round", () => {
  const s = makeRules({ moveSeconds: 10, gameSeconds: 60 }).newState(1);
  applyMove(s, 1, { col: 3, ms: 100 });
  assert.throws(() => applyMove(s, 1, { timeout: true }), /Not your turn/);
  const events = applyMove(s, 0, { timeout: true });
  assert.deepEqual(events, [{ type: "timeout", player: 0 }]);
  assert.equal(s.winner, 1);
  assert.equal(s.reason, "timeout");
  assert.throws(() => applyMove(s, 0, { col: 0, ms: 0 }), /game is over/);
});

test("an untimed game has no timeouts and ignores move times", () => {
  const s = newState(0);
  assert.throws(() => applyMove(s, 0, { timeout: true }), /no clock/);
  applyMove(s, 0, { col: 3, ms: 99_999_999 });
  assert.equal(s.heights[3], 1);
});
