// Tic Tac Toe rules for TurnMatch. A room picks a config: a 3×3 board (three
// in a row) or 5×5 (four in a row), optional clocks, and who moves first.
// The starter plays X. Pure: no DOM, timers or randomness.
import { RuleError } from "../engine/turn-match.js";

export const EMPTY = -1;
export const DRAW = 2;
export const IN_A_ROW = { 3: 3, 5: 4 }; // board size -> marks in a row to win
export const MOVE_SECONDS = [5, 10, 15, 30, 0]; // 0 = no limit
export const GAME_SECONDS = [60, 120, 180, 300, 0];
export const FIRST = ["random", "host", "guest"];
export const DEFAULT_CONFIG = { size: 3, moveSeconds: 30, gameSeconds: 120, first: "random" };

// Any unknown or missing value falls back to the default.
export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    size: pick(c.size, [3, 5], DEFAULT_CONFIG.size),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    gameSeconds: pick(c.gameSeconds, GAME_SECONDS, DEFAULT_CONFIG.gameSeconds),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
  };
}

const lineCache = new Map();

// Every run of k squares across, down or diagonal on a size×size board.
export function linesFor(size, k = IN_A_ROW[size]) {
  const key = `${size}/${k}`;
  if (!lineCache.has(key)) {
    const lines = [];
    const steps = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        for (const [dr, dc] of steps) {
          const endR = r + dr * (k - 1);
          const endC = c + dc * (k - 1);
          if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue;
          lines.push(Array.from({ length: k }, (_, j) => (r + dr * j) * size + c + dc * j));
        }
      }
    }
    lineCache.set(key, lines);
  }
  return lineCache.get(key);
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { size, moveSeconds, gameSeconds } = normalizeConfig(config);
  return {
    turn: first,
    winner: -1,
    first,
    size,
    k: IN_A_ROW[size],
    board: Array(size * size).fill(EMPTY),
    moves: [],
    line: null,
    reason: null, // "line" | "draw" | "timeout" once over
    moveMs: moveSeconds * 1000,
    clocks: gameSeconds ? [gameSeconds * 1000, gameSeconds * 1000] : null,
  };
}

export const markOf = (state, player) => (player === state.first ? "X" : "O");
export const isTimed = (state) => state.moveMs > 0 || state.clocks !== null;

// Milliseconds `player` may still spend on this move (Infinity without clocks).
export function timeLeft(state, player) {
  return Math.min(state.moveMs || Infinity, state.clocks ? state.clocks[player] : Infinity);
}

// The completed line on this board, or null.
export function winningLine(board, size, k = IN_A_ROW[size]) {
  return linesFor(size, k).find((line) => board[line[0]] !== EMPTY && line.every((i) => board[i] === board[line[0]])) || null;
}

export function emptyCells(board) {
  const out = [];
  for (let i = 0; i < board.length; i++) if (board[i] === EMPTY) out.push(i);
  return out;
}

// A move is { cell, ms } (ms = time the mover spent, required when timed),
// or { timeout: true } when the mover's own clock runs out.
export function applyMove(state, player, move) {
  if (state.winner !== -1) throw new RuleError("The game is over");
  if (state.turn !== player) throw new RuleError("Not your turn");
  if (move?.timeout === true) {
    if (!isTimed(state)) throw new RuleError("This game has no clock");
    state.winner = 1 - player;
    state.reason = "timeout";
    return [{ type: "timeout", player }];
  }
  const cell = move?.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.board.length) throw new RuleError("Pick a square on the board");
  if (state.board[cell] !== EMPTY) throw new RuleError("That square is taken");
  if (isTimed(state)) {
    const ms = move.ms;
    if (!Number.isInteger(ms) || ms < 0) throw new RuleError("Move time missing");
    if (ms > timeLeft(state, player)) throw new RuleError("Time ran out");
    if (state.clocks) state.clocks[player] -= ms;
  }
  state.board[cell] = player;
  state.moves.push(cell);
  const events = [{ type: "placed", cell, player }];
  const line = winningLine(state.board, state.size, state.k);
  if (line) {
    state.winner = player;
    state.line = line;
    state.reason = "line";
    events.push({ type: "win", player, line });
  } else if (state.moves.length === state.board.length) {
    state.winner = DRAW;
    state.reason = "draw";
    events.push({ type: "draw" });
  } else {
    state.turn = 1 - player;
  }
  return events;
}

// The rules object TurnMatch uses for a room's config. The coin toss only
// counts when the room leaves the first move to chance.
export function makeRules(config) {
  const c = normalizeConfig(config);
  return {
    config: c,
    newState: (coin) => newState(c.first === "random" ? coin : c.first === "host" ? 0 : 1, c),
    applyMove,
    needsRandom: () => false,
  };
}
