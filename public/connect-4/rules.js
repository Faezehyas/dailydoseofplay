// Connect 4 rules for TurnMatch. A room picks a config: the board (7×6 up to
// 9×9, always four in a row), optional clocks, who moves first, and the robot's
// level. Discs drop to the lowest free row of a column. The starter plays the
// first colour. Pure: no DOM, timers or randomness.
import { RuleError } from "../engine/turn-match.js";

export const EMPTY = -1;
export const DRAW = 2;
export const IN_A_ROW = 4;
export const SIZES = ["7x6", "8x7", "8x8", "9x7", "9x9"]; // columns x rows
export const MOVE_SECONDS = [10, 20, 30, 40, 0]; // 0 = no limit
export const GAME_SECONDS = [60, 120, 180, 240, 0];
export const FIRST = ["random", "host", "guest"];
export const LEVELS = ["easy", "medium", "hard"]; // robot games only
export const DEFAULT_CONFIG = { size: "7x6", moveSeconds: 40, gameSeconds: 240, first: "random", level: "medium" };

// Any unknown or missing value falls back to the default.
export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    size: pick(c.size, SIZES, DEFAULT_CONFIG.size),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    gameSeconds: pick(c.gameSeconds, GAME_SECONDS, DEFAULT_CONFIG.gameSeconds),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
  };
}

export function dimensions(size) {
  const [cols, rows] = size.split("x").map(Number);
  return { cols, rows };
}

const lineCache = new Map();

// Every run of four squares across, down or diagonal. Squares are numbered
// row by row from the top: square = row * cols + col.
export function linesFor(cols, rows) {
  const key = `${cols}x${rows}`;
  if (!lineCache.has(key)) {
    const lines = [];
    const steps = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (const [dr, dc] of steps) {
          const endR = r + dr * (IN_A_ROW - 1);
          const endC = c + dc * (IN_A_ROW - 1);
          if (endR >= rows || endC < 0 || endC >= cols) continue;
          lines.push(Array.from({ length: IN_A_ROW }, (_, j) => (r + dr * j) * cols + c + dc * j));
        }
      }
    }
    lineCache.set(key, lines);
  }
  return lineCache.get(key);
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { size, moveSeconds, gameSeconds } = normalizeConfig(config);
  const { cols, rows } = dimensions(size);
  return {
    turn: first,
    winner: -1,
    first,
    cols,
    rows,
    board: Array(cols * rows).fill(EMPTY),
    heights: Array(cols).fill(0), // discs in each column
    moves: [], // columns, in play order
    line: null,
    reason: null, // "line" | "draw" | "timeout" once over
    moveMs: moveSeconds * 1000,
    clocks: gameSeconds ? [gameSeconds * 1000, gameSeconds * 1000] : null,
  };
}

export const colorOf = (state, player) => (player === state.first ? "coral" : "teal");
export const isTimed = (state) => state.moveMs > 0 || state.clocks !== null;

// Milliseconds `player` may still spend on this move (Infinity without clocks).
export function timeLeft(state, player) {
  return Math.min(state.moveMs || Infinity, state.clocks ? state.clocks[player] : Infinity);
}

// The square a disc dropped in `col` lands on, or -1 when the column is full.
export function landing(state, col) {
  const h = state.heights[col];
  return h < state.rows ? (state.rows - 1 - h) * state.cols + col : -1;
}

export function openColumns(state) {
  const out = [];
  for (let c = 0; c < state.cols; c++) if (state.heights[c] < state.rows) out.push(c);
  return out;
}

// Every square in a run of four or more through `cell`, or null.
export function linesThrough(board, cols, rows, cell) {
  const who = board[cell];
  if (who === EMPTY) return null;
  const r0 = Math.floor(cell / cols);
  const c0 = cell % cols;
  const won = [];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const run = [cell];
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (r >= 0 && r < rows && c >= 0 && c < cols && board[r * cols + c] === who) {
        run.push(r * cols + c);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (run.length >= IN_A_ROW) won.push(...run);
  }
  return won.length ? [...new Set(won)].sort((a, b) => a - b) : null;
}

// A move is { col, ms } (ms = time the mover spent, required when timed),
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
  const col = move?.col;
  if (!Number.isInteger(col) || col < 0 || col >= state.cols) throw new RuleError("Pick a column on the board");
  const cell = landing(state, col);
  if (cell < 0) throw new RuleError("That column is full");
  if (isTimed(state)) {
    const ms = move.ms;
    if (!Number.isInteger(ms) || ms < 0) throw new RuleError("Move time missing");
    if (ms > timeLeft(state, player)) throw new RuleError("Time ran out");
    if (state.clocks) state.clocks[player] -= ms;
  }
  state.board[cell] = player;
  state.heights[col] += 1;
  state.moves.push(col);
  const events = [{ type: "dropped", col, cell, player }];
  const line = linesThrough(state.board, state.cols, state.rows, cell);
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
