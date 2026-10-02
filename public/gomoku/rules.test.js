import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import {
  makeRules,
  newState as newTimedState,
  applyMove,
  stoneOf,
  lineThrough,
  runThrough,
  normalizeConfig,
  timeLeft,
  DEFAULT_CONFIG,
  SIZE,
  EMPTY,
  DRAW,
} from "./rules.js";

const UNTIMED = { moveSeconds: 0, gameSeconds: 0 };
const CELLS = SIZE * SIZE;
const at = (r, c) => r * SIZE + c;
const newState = (first, config = UNTIMED) => newTimedState(first, config);

// Play cells in order, alternating from whoever's turn it is.
function play(first, cells, config = UNTIMED) {
  const state = newState(first, config);
  for (const cell of cells) applyMove(state, state.turn, { cell });
  return state;
}

// The starter plays `line`; the other player answers on `others`, far away.
function race(line, others, first = 0) {
  return play(first, line.flatMap((cell, k) => (k < others.length ? [cell, others[k]] : [cell])));
}

test("a new game is an empty 15×15 board, and the starter gets the first stones", () => {
  for (const first of [0, 1]) {
    const s = newState(first);
    assert.equal(s.turn, first);
    assert.equal(s.winner, -1);
    assert.equal(s.size, 15);
    assert.deepEqual(s.board, Array(CELLS).fill(EMPTY));
    assert.equal(stoneOf(s, first), "first");
    assert.equal(stoneOf(s, 1 - first), "second");
  }
});

test("any empty point may be played, from the first move on", () => {
  for (const cell of [0, 14, at(7, 7), 210, 224]) {
    const s = newState(1);
    const events = applyMove(s, 1, { cell });
    assert.deepEqual(events, [{ type: "placed", cell, player: 1 }]);
    assert.equal(s.board[cell], 1);
    assert.equal(s.turn, 0);
    assert.deepEqual(s.moves, [cell]);
  }
});

test("five in a row wins across, down and on both diagonals, anywhere on the board", () => {
  const far = [at(14, 0), at(14, 2), at(14, 4), at(14, 6)];
  const lines = [
    [0, 1, 2, 3, 4], // top-left corner, across
    [at(3, 10), at(3, 11), at(3, 12), at(3, 13), at(3, 14)], // touching the right edge
    [at(0, 7), at(1, 7), at(2, 7), at(3, 7), at(4, 7)], // down
    [at(5, 5), at(6, 6), at(7, 7), at(8, 8), at(9, 9)], // down-right
    [at(2, 12), at(3, 11), at(4, 10), at(5, 9), at(6, 8)], // down-left
  ];
  for (const line of lines) {
    for (const first of [0, 1]) {
      const s = race(line, far, first);
      assert.equal(s.winner, first, `line ${line}`);
      assert.equal(s.reason, "line");
      assert.deepEqual([...s.line].sort((a, b) => a - b), [...line].sort((a, b) => a - b));
    }
  }
});

test("the stone that completes five can land anywhere in the line, and the win reports it", () => {
  // Stones on 0, 1, 3, 4; the fifth fills the gap.
  const s = race([0, 1, 3, 4], [at(9, 0), at(9, 2), at(9, 4), at(9, 6)]);
  assert.equal(s.winner, -1);
  assert.equal(s.turn, 0);
  const events = applyMove(s, 0, { cell: 2 });
  assert.deepEqual(events, [
    { type: "placed", cell: 2, player: 0 },
    { type: "win", player: 0, line: [0, 1, 2, 3, 4] },
  ]);
  assert.equal(s.turn, 0, "the turn stays put once the game is over");
});

test("four in a row is not enough, and lines don't wrap around the edge", () => {
  const four = race([0, 1, 2, 3], [at(9, 0), at(9, 2), at(9, 4)]);
  assert.equal(four.winner, -1);
  // 12, 13, 14 on row 0 and 15, 16 on row 1 are neighbours in the array, not on the board.
  const wrap = race([12, 13, 14, 15, 16], [at(9, 0), at(9, 2), at(9, 4), at(9, 6)]);
  assert.equal(wrap.winner, -1);
  const diagonalWrap = race([at(0, 13), at(1, 14), at(2, 0), at(3, 1), at(4, 2)], [at(9, 0), at(9, 2), at(9, 4), at(9, 6)]);
  assert.equal(diagonalWrap.winner, -1);
});

test("six or more in a row (an overline) also wins, and the whole run is reported", () => {
  // Stones on 0-2 and 4-5; filling 3 makes six.
  const s = race([0, 1, 2, 4, 5], [at(9, 0), at(9, 2), at(9, 4), at(9, 6), at(9, 8)]);
  assert.equal(s.winner, -1);
  applyMove(s, 0, { cell: 3 });
  assert.equal(s.winner, 0);
  assert.deepEqual(s.line, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(runThrough(s.board, 3, 0, 1), [0, 1, 2, 3, 4, 5]);
});

test("an opponent stone breaks a line", () => {
  // The starter has 0, 1, 3, 4 and 5 on the top row, with the other player on 2.
  const s = play(0, [0, 2, 1, at(9, 0), 3, at(9, 1), 4, at(9, 2), 5]);
  assert.equal(s.winner, -1);
  assert.equal(lineThrough(s.board, 3), null);
  applyMove(s, 1, { cell: at(9, 3) });
  applyMove(s, 0, { cell: 6 });
  assert.equal(s.winner, -1, "3 to 6 is only four");
  applyMove(s, 1, { cell: at(9, 4) });
  assert.equal(s.winner, 1, "while the other player lines up five");
  assert.deepEqual(s.line, [at(9, 0), at(9, 1), at(9, 2), at(9, 3), at(9, 4)]);
});

test("a full board with no five is a draw", () => {
  // Pairs across, flipped on every row: no five in any direction.
  const rows = Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => (Math.floor(c / 2) + r) % 2));
  const cells = (v) => rows.flatMap((row, r) => row.flatMap((x, c) => (x === v ? [at(r, c)] : [])));
  const [a, b] = [cells(0), cells(1)];
  const [more, fewer] = a.length >= b.length ? [a, b] : [b, a];
  assert.equal(more.length, fewer.length + 1);
  const order = more.flatMap((cell, k) => (k < fewer.length ? [cell, fewer[k]] : [cell]));
  const s = newState(0);
  for (const cell of order.slice(0, -1)) applyMove(s, s.turn, { cell });
  assert.equal(s.winner, -1);
  const events = applyMove(s, s.turn, { cell: order.at(-1) });
  assert.deepEqual(events.at(-1), { type: "draw" });
  assert.equal(s.winner, DRAW);
  assert.equal(s.reason, "draw");
  assert.equal(s.line, null);
  assert.equal(s.moves.length, CELLS);
});

test("illegal moves throw RuleError and leave the state alone", () => {
  const s = newState(0);
  applyMove(s, 0, { cell: at(7, 7) });
  const snapshot = structuredClone(s);
  const cases = [
    [1, { cell: at(7, 7) }, /taken/],
    [0, { cell: 0 }, /Not your turn/],
    [1, { cell: CELLS }, /point on the board/],
    [1, { cell: -1 }, /point on the board/],
    [1, { cell: 1.5 }, /point on the board/],
    [1, { cell: "3" }, /point on the board/],
    [1, {}, /point on the board/],
    [1, null, /point on the board/],
  ];
  for (const [player, move, msg] of cases) {
    assert.throws(() => applyMove(s, player, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
    assert.deepEqual(s, snapshot);
  }
});

test("no move is accepted after the game is over", () => {
  const s = race([0, 1, 2, 3, 4], [at(9, 0), at(9, 2), at(9, 4), at(9, 6)]);
  assert.equal(s.winner, 0);
  assert.throws(() => applyMove(s, 1, { cell: 100 }), /game is over/);
  assert.throws(() => applyMove(s, 0, { cell: 100 }), /game is over/);
});

test("a scripted full game ends in the expected state", () => {
  // The second player blocks every threat but one: an open three on the
  // anti-diagonal (move 15) that grows into an open four and then five.
  const moves = [
    at(7, 7), at(6, 6), at(7, 8), at(7, 6), at(8, 7), at(6, 7), at(9, 7), at(10, 7), at(8, 8), at(9, 9),
    at(8, 9), at(8, 10), at(8, 6), at(8, 5), at(6, 8), at(5, 8), at(9, 8), at(10, 8), at(9, 5), at(5, 9),
  ];
  const s = play(1, moves);
  assert.equal(s.winner, -1);
  assert.equal(s.turn, 1);
  applyMove(s, 1, { cell: at(10, 4) });
  assert.equal(s.winner, 1);
  assert.equal(s.reason, "line");
  assert.deepEqual(s.line, [at(6, 8), at(7, 7), at(8, 6), at(9, 5), at(10, 4)]);
  assert.equal(s.moves.length, 21);
  assert.equal(s.board.filter((v) => v === 1).length, 11);
  assert.equal(s.board.filter((v) => v === 0).length, 10);
  assert.equal(stoneOf(s, 1), "first");
});

// ---------- settings ----------

test("settings default to papergames' values and reject unknown ones", () => {
  assert.deepEqual(DEFAULT_CONFIG, { moveSeconds: 40, gameSeconds: 300, first: "random" });
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ moveSeconds: 5, gameSeconds: "300", first: "me" }), DEFAULT_CONFIG);
  const custom = { moveSeconds: 10, gameSeconds: 0, first: "guest" };
  assert.deepEqual(normalizeConfig({ ...custom, size: 19 }), custom);
  for (const moveSeconds of [10, 20, 30, 40, 0]) assert.equal(normalizeConfig({ moveSeconds }).moveSeconds, moveSeconds);
  for (const gameSeconds of [120, 180, 240, 300, 0]) assert.equal(normalizeConfig({ gameSeconds }).gameSeconds, gameSeconds);
});

test("who moves first: the coin toss, or the room's fixed choice", () => {
  for (const coin of [0, 1]) {
    assert.equal(makeRules({ first: "random" }).newState(coin).turn, coin);
    assert.equal(makeRules({ first: "host" }).newState(coin).turn, 0);
    assert.equal(makeRules({ first: "guest" }).newState(coin).turn, 1);
    const s = makeRules({ first: "guest" }).newState(coin);
    assert.equal(stoneOf(s, 1), "first", "the starter plays the first stones");
  }
  assert.equal(makeRules({}).needsRandom(), false);
  assert.deepEqual(makeRules({}).newState(0).clocks, [300_000, 300_000]);
  assert.equal(makeRules({}).newState(0).moveMs, 40_000);
});

// ---------- clocks ----------

test("timed moves spend the mover's clock", () => {
  const s = makeRules({ moveSeconds: 30, gameSeconds: 120 }).newState(0);
  assert.equal(s.moveMs, 30_000);
  assert.deepEqual(s.clocks, [120_000, 120_000]);
  applyMove(s, 0, { cell: 112, ms: 12_345 });
  applyMove(s, 1, { cell: 0, ms: 1_000 });
  assert.deepEqual(s.clocks, [107_655, 119_000]);
  assert.equal(timeLeft(s, 0), 30_000, "the move limit is the tighter one");
  s.clocks[0] = 2_000;
  assert.equal(timeLeft(s, 0), 2_000, "the game clock is the tighter one");
});

test("timed moves need an honest move time within the limits", () => {
  const s = makeRules({ moveSeconds: 10, gameSeconds: 0 }).newState(0);
  assert.equal(s.clocks, null);
  for (const [move, msg] of [
    [{ cell: 4 }, /Move time missing/],
    [{ cell: 4, ms: -1 }, /Move time missing/],
    [{ cell: 4, ms: 1.5 }, /Move time missing/],
    [{ cell: 4, ms: 10_001 }, /Time ran out/],
  ]) {
    assert.throws(() => applyMove(s, 0, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
  }
  applyMove(s, 0, { cell: 4, ms: 10_000 });
  const bank = makeRules({ moveSeconds: 0, gameSeconds: 120 }).newState(0);
  bank.clocks[0] = 500;
  assert.throws(() => applyMove(bank, 0, { cell: 0, ms: 501 }), /Time ran out/);
});

test("running out of time loses the round", () => {
  const s = makeRules({ moveSeconds: 10, gameSeconds: 120 }).newState(1);
  applyMove(s, 1, { cell: 112, ms: 100 });
  assert.throws(() => applyMove(s, 1, { timeout: true }), /Not your turn/);
  const events = applyMove(s, 0, { timeout: true });
  assert.deepEqual(events, [{ type: "timeout", player: 0 }]);
  assert.equal(s.winner, 1);
  assert.equal(s.reason, "timeout");
  assert.throws(() => applyMove(s, 0, { cell: 0, ms: 0 }), /game is over/);
});

test("an untimed game has no timeouts and ignores move times", () => {
  const s = newState(0);
  assert.throws(() => applyMove(s, 0, { timeout: true }), /no clock/);
  applyMove(s, 0, { cell: 4, ms: 99_999_999 });
  assert.equal(s.board[4], 0);
});
