// Gomoku rules for TurnMatch: a 15×15 board, and five or more stones in a row
// wins (an overline counts). Any empty point may be played from the first
// move. A room picks optional clocks and who moves first. Pure: no DOM,
// timers or randomness.
import { RuleError } from "../engine/turn-match.js";

export const SIZE = 15;
export const WIN = 5;
export const EMPTY = -1;
export const DRAW = 2;
export const MOVE_SECONDS = [10, 20, 30, 40, 0]; // 0 = no limit
export const GAME_SECONDS = [120, 180, 240, 300, 0];
export const FIRST = ["random", "host", "guest"];
export const DEFAULT_CONFIG = { moveSeconds: 40, gameSeconds: 300, first: "random" };
export const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]]; // across, down, and both diagonals

// Any unknown or missing value falls back to the default.
export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    gameSeconds: pick(c.gameSeconds, GAME_SECONDS, DEFAULT_CONFIG.gameSeconds),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
  };
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { moveSeconds, gameSeconds } = normalizeConfig(config);
  return {
    turn: first,
    winner: -1,
    first,
    size: SIZE,
    board: Array(SIZE * SIZE).fill(EMPTY),
    moves: [],
    line: null,
    reason: null, // "line" | "draw" | "timeout" once over
    moveMs: moveSeconds * 1000,
    clocks: gameSeconds ? [gameSeconds * 1000, gameSeconds * 1000] : null,
  };
}

// The starter's stones are drawn solid ("first"), the other player's ringed ("second").
export const stoneOf = (state, player) => (player === state.first ? "first" : "second");
export const isTimed = (state) => state.moveMs > 0 || state.clocks !== null;

// Milliseconds `player` may still spend on this move (Infinity without clocks).
export function timeLeft(state, player) {
  return Math.min(state.moveMs || Infinity, state.clocks ? state.clocks[player] : Infinity);
}

// The run of the same stones through `cell` along (dr, dc), in board order.
export function runThrough(board, cell, dr, dc, size = SIZE) {
  const who = board[cell];
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  const at = (k) => {
    const r = r0 + dr * k;
    const c = c0 + dc * k;
    return r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === who ? r * size + c : -1;
  };
  let lo = 0;
  while (at(lo - 1) >= 0) lo--;
  let hi = 0;
  while (at(hi + 1) >= 0) hi++;
  const out = [];
  for (let k = lo; k <= hi; k++) out.push(at(k));
  return out;
}

// The first run of five or more through `cell` (across, down, then diagonals), or null.
export function lineThrough(board, cell, size = SIZE) {
  if (board[cell] === EMPTY) return null;
  for (const [dr, dc] of DIRECTIONS) {
    const run = runThrough(board, cell, dr, dc, size);
    if (run.length >= WIN) return run;
  }
  return null;
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
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.board.length) throw new RuleError("Pick a point on the board");
  if (state.board[cell] !== EMPTY) throw new RuleError("That point is taken");
  if (isTimed(state)) {
    const ms = move.ms;
    if (!Number.isInteger(ms) || ms < 0) throw new RuleError("Move time missing");
    if (ms > timeLeft(state, player)) throw new RuleError("Time ran out");
    if (state.clocks) state.clocks[player] -= ms;
  }
  state.board[cell] = player;
  state.moves.push(cell);
  const events = [{ type: "placed", cell, player }];
  const line = lineThrough(state.board, cell, state.size);
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
