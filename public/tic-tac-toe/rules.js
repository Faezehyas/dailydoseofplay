// Tic Tac Toe rules for TurnMatch: 3×3, three in a row wins, a full board is
// a draw. The coin-toss winner starts and plays X. Pure: no DOM or randomness.
import { RuleError } from "../engine/turn-match.js";

export const SIZE = 3;
export const CELLS = SIZE * SIZE;
export const EMPTY = -1;
export const DRAW = 2;
export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function newState(first) {
  return { turn: first, winner: -1, first, board: Array(CELLS).fill(EMPTY), moves: [], line: null };
}

export const markOf = (state, player) => (player === state.first ? "X" : "O");

// The completed line on this board, or null.
export function winningLine(board) {
  return LINES.find(([a, b, c]) => board[a] !== EMPTY && board[a] === board[b] && board[a] === board[c]) || null;
}

export function emptyCells(board) {
  const out = [];
  for (let i = 0; i < CELLS; i++) if (board[i] === EMPTY) out.push(i);
  return out;
}

export function applyMove(state, player, move) {
  if (state.winner !== -1) throw new RuleError("The game is over");
  if (state.turn !== player) throw new RuleError("Not your turn");
  const cell = move?.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) throw new RuleError("Pick a square on the board");
  if (state.board[cell] !== EMPTY) throw new RuleError("That square is taken");
  state.board[cell] = player;
  state.moves.push(cell);
  const events = [{ type: "placed", cell, player }];
  const line = winningLine(state.board);
  if (line) {
    state.winner = player;
    state.line = line;
    events.push({ type: "win", player, line });
  } else if (state.moves.length === CELLS) {
    state.winner = DRAW;
    events.push({ type: "draw" });
  } else {
    state.turn = 1 - player;
  }
  return events;
}

export const rules = { newState, applyMove, needsRandom: () => false };
