import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import { rules, newState, applyMove, markOf, winningLine, emptyCells, LINES, EMPTY, DRAW, CELLS } from "./rules.js";

// Play cells in order, alternating from whoever's turn it is.
function play(first, cells) {
  const state = newState(first);
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
      assert.deepEqual(winningLine(s.board), line);
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
});

test("the rules object never asks for randomness", () => {
  assert.equal(rules.needsRandom(newState(0), { cell: 0 }), false);
  assert.equal(rules.newState, newState);
  assert.equal(rules.applyMove, applyMove);
});
