import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import {
  makeRules,
  newState as newTimedState,
  applyMove,
  markOf,
  winningLine,
  emptyCells,
  linesFor,
  normalizeConfig,
  timeLeft,
  DEFAULT_CONFIG,
  EMPTY,
  DRAW,
} from "./rules.js";

const UNTIMED = { size: 3, moveSeconds: 0, gameSeconds: 0 };
const BIG = { size: 5, moveSeconds: 0, gameSeconds: 0 };
const CELLS = 9;
const LINES = linesFor(3);
const newState = (first, config = UNTIMED) => newTimedState(first, config);

// Play cells in order, alternating from whoever's turn it is.
function play(first, cells, config = UNTIMED) {
  const state = newState(first, config);
  for (const cell of cells) applyMove(state, state.turn, { cell });
  return state;
}

test("a new game is an empty board, and the starter plays X", () => {
  for (const first of [0, 1]) {
    const s = newState(first);
    assert.equal(s.turn, first);
    assert.equal(s.winner, -1);
    assert.deepEqual(s.board, Array(CELLS).fill(EMPTY));
    assert.equal(markOf(s, first), "X");
    assert.equal(markOf(s, 1 - first), "O");
  }
});

test("a legal move marks the square and passes the turn", () => {
  const s = newState(0);
  const events = applyMove(s, 0, { cell: 4 });
  assert.deepEqual(events, [{ type: "placed", cell: 4, player: 0 }]);
  assert.equal(s.board[4], 0);
  assert.equal(s.turn, 1);
  assert.deepEqual(s.moves, [4]);
  assert.deepEqual(emptyCells(s.board), [0, 1, 2, 3, 5, 6, 7, 8]);
});

test("every line of three wins, for either player", () => {
  for (const line of LINES) {
    for (const winner of [0, 1]) {
      // The loser gets only two marks, so it can never complete a line first.
      const [a, b] = [...Array(CELLS).keys()].filter((i) => !line.includes(i));
      const s = play(winner, [line[0], a, line[1], b, line[2]]);
      assert.equal(s.winner, winner, `line ${line} for ${winner}`);
      assert.deepEqual(s.line, line);
      assert.deepEqual(winningLine(s.board, 3), line);
    }
  }
});

test("the winning move reports the line and ends the game", () => {
  const s = newState(1);
  for (const cell of [0, 3, 1, 4]) applyMove(s, s.turn, { cell });
  const events = applyMove(s, 1, { cell: 2 });
  assert.deepEqual(events, [
    { type: "placed", cell: 2, player: 1 },
    { type: "win", player: 1, line: [0, 1, 2] },
  ]);
  assert.equal(s.winner, 1);
  assert.equal(s.turn, 1, "the turn stays put once the game is over");
});

test("a full board with no line is a draw", () => {
  // X O X / X X O / O X O
  const s = newState(0);
  const order = [0, 1, 2, 5, 3, 6, 4, 8];
  for (const cell of order) applyMove(s, s.turn, { cell });
  assert.equal(s.winner, -1);
  const events = applyMove(s, 0, { cell: 7 });
  assert.deepEqual(events.at(-1), { type: "draw" });
  assert.equal(s.winner, DRAW);
  assert.equal(s.line, null);
});

test("a win on the ninth square is a win, not a draw", () => {
  // X O X / O X O / O X X, with X's last mark on 8.
  const s = play(0, [0, 1, 2, 3, 4, 5, 7, 6]);
  assert.equal(s.winner, -1);
  applyMove(s, 0, { cell: 8 });
  assert.equal(s.moves.length, 9);
  assert.equal(s.winner, 0);
  assert.deepEqual(s.line, [0, 4, 8]);
});

test("illegal moves throw RuleError and leave the state alone", () => {
  const s = newState(0);
  applyMove(s, 0, { cell: 4 });
  const snapshot = structuredClone(s);
  const cases = [
    [1, { cell: 4 }, /taken/],
    [0, { cell: 0 }, /Not your turn/],
    [1, { cell: 9 }, /square on the board/],
    [1, { cell: -1 }, /square on the board/],
    [1, { cell: 1.5 }, /square on the board/],
    [1, { cell: "3" }, /square on the board/],
    [1, {}, /square on the board/],
    [1, null, /square on the board/],
  ];
  for (const [player, move, msg] of cases) {
    assert.throws(() => applyMove(s, player, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
    assert.deepEqual(s, snapshot);
  }
});

test("no move is accepted after the game is over", () => {
  const s = play(0, [0, 3, 1, 4, 2]);
  assert.equal(s.winner, 0);
  assert.throws(() => applyMove(s, 1, { cell: 8 }), /game is over/);
  assert.throws(() => applyMove(s, 0, { cell: 8 }), /game is over/);
});

test("a scripted full game ends in the expected state", () => {
  // The starter takes three corners for a fork, then wins along the bottom row.
  const s = play(1, [0, 4, 8, 2, 6, 3, 7]);
  assert.equal(s.winner, 1);
  assert.deepEqual(s.line, [6, 7, 8]);
  assert.deepEqual(s.board, [1, EMPTY, 0, 0, 0, EMPTY, 1, 1, 1]);
  assert.deepEqual(s.moves, [0, 4, 8, 2, 6, 3, 7]);
  assert.equal(markOf(s, 1), "X");
  assert.equal(s.reason, "line");
});

test("3×3 has the 8 classic lines", () => {
  const key = (l) => l.join();
  assert.deepEqual(
    LINES.map(key).sort(),
    [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]].map(key).sort(),
  );
});

// ---------- 5×5, four in a row ----------

test("5×5 needs four in a row, in any direction and at any offset", () => {
  const lines = linesFor(5);
  // 2 per row and column, 4 down-right and 4 down-left diagonals.
  assert.equal(lines.length, 5 * 2 * 2 + 4 + 4);
  assert.ok(lines.every((l) => l.length === 4));
  for (const line of [[1, 2, 3, 4], [5, 10, 15, 20], [1, 7, 13, 19], [4, 8, 12, 16], [9, 13, 17, 21]]) {
    assert.ok(lines.some((l) => l.join() === line.join()), `${line} is a line`);
    // The loser gets only three marks, so it can never make four first.
    const others = [...Array(25).keys()].filter((i) => !line.includes(i));
    const s = play(0, [line[0], others[0], line[1], others[1], line[2], others[2], line[3]], BIG);
    assert.equal(s.winner, 0, `${line}`);
    assert.deepEqual(s.line, line);
  }
  const three = play(0, [0, 24, 1, 23, 2], BIG);
  assert.equal(three.winner, -1, "three in a row is not enough on 5×5");
});

test("a full 5×5 board with no four in a row is a draw", () => {
  // X X O O X / O O X X O / X X O O X / O O X X O / X X O O X
  const rows = ["xxoox", "ooxxo", "xxoox", "ooxxo", "xxoox"].join("");
  const xs = [...rows].flatMap((ch, i) => (ch === "x" ? [i] : []));
  const os = [...rows].flatMap((ch, i) => (ch === "o" ? [i] : []));
  assert.equal(xs.length, 13);
  const order = xs.flatMap((x, i) => (i < os.length ? [x, os[i]] : [x]));
  const s = play(0, order, BIG);
  assert.equal(s.winner, DRAW);
  assert.equal(s.reason, "draw");
  assert.equal(winningLine(s.board, 5), null);
});

// ---------- settings ----------

test("settings default to papergames-style values and reject unknown ones", () => {
  assert.deepEqual(DEFAULT_CONFIG, { size: 3, moveSeconds: 30, gameSeconds: 120, first: "random" });
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ size: 4, moveSeconds: 7, gameSeconds: "120", first: "me" }), DEFAULT_CONFIG);
  const custom = { size: 5, moveSeconds: 0, gameSeconds: 300, first: "guest" };
  assert.deepEqual(normalizeConfig({ ...custom, extra: 1 }), custom);
});

test("who moves first: the coin toss, or the room's fixed choice", () => {
  for (const coin of [0, 1]) {
    assert.equal(makeRules({ first: "random" }).newState(coin).turn, coin);
    assert.equal(makeRules({ first: "host" }).newState(coin).turn, 0);
    assert.equal(makeRules({ first: "guest" }).newState(coin).turn, 1);
    const s = makeRules({ first: "guest" }).newState(coin);
    assert.equal(markOf(s, 1), "X", "the starter plays X");
  }
  assert.equal(makeRules({}).needsRandom(), false);
});

// ---------- clocks ----------

test("timed moves spend the mover's clock", () => {
  const s = makeRules({ moveSeconds: 30, gameSeconds: 60 }).newState(0);
  assert.equal(s.moveMs, 30_000);
  assert.deepEqual(s.clocks, [60_000, 60_000]);
  applyMove(s, 0, { cell: 4, ms: 12_345 });
  applyMove(s, 1, { cell: 0, ms: 1_000 });
  assert.deepEqual(s.clocks, [47_655, 59_000]);
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
  const bank = makeRules({ moveSeconds: 0, gameSeconds: 60 }).newState(0);
  bank.clocks[0] = 500;
  assert.throws(() => applyMove(bank, 0, { cell: 0, ms: 501 }), /Time ran out/);
});

test("running out of time loses the round", () => {
  const s = makeRules({ moveSeconds: 5, gameSeconds: 60 }).newState(1);
  applyMove(s, 1, { cell: 4, ms: 100 });
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
