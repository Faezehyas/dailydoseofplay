// Checkers (English draughts) rules for TurnMatch: 8×8, 12 men each, forced
// captures, multi-jumps, kings. A room picks optional clocks and who moves
// first. Player 0 starts at the bottom, player 1 at the top; the view turns
// the board for player 1. Pure: no DOM, timers or randomness.
import { RuleError } from "../engine/turn-match.js";

export const SIZE = 8;
export const EMPTY = -1;
export const DRAW = 2;
export const QUIET_LIMIT = 40; // turns in a row with no capture and no new king
export const MOVE_SECONDS = [30, 60, 90, 120, 0]; // 0 = no limit
export const GAME_SECONDS = [180, 300, 480, 900, 1200, 3600, 0];
export const FIRST = ["random", "host", "guest"];
export const DEFAULT_CONFIG = { moveSeconds: 0, gameSeconds: 0, first: "random" };

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

// A square holds EMPTY or a piece: its owner (0 or 1), plus 2 for a king.
export const owner = (piece) => piece & 1;
export const isKing = (piece) => piece > 1;
export const rowOf = (sq) => sq >> 3;
export const colOf = (sq) => sq & 7;
export const isDark = (sq) => (rowOf(sq) + colOf(sq)) % 2 === 1;
export const DARK = Array.from({ length: SIZE * SIZE }, (_, i) => i).filter(isDark);
export const CROWN_ROW = [0, SIZE - 1];

// Diagonal neighbours and jump landings, 4 per square (-1 off the board).
// Directions 0 and 1 go up the board, 2 and 3 go down.
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const STEP = new Int8Array(SIZE * SIZE * 4).fill(-1);
export const JUMP = new Int8Array(SIZE * SIZE * 4).fill(-1);
for (let sq = 0; sq < SIZE * SIZE; sq++) {
  DIRS.forEach(([dr, dc], d) => {
    const r = rowOf(sq);
    const c = colOf(sq);
    const on = (k) => r + dr * k >= 0 && r + dr * k < SIZE && c + dc * k >= 0 && c + dc * k < SIZE;
    if (on(1)) STEP[sq * 4 + d] = (r + dr) * SIZE + c + dc;
    if (on(2)) JUMP[sq * 4 + d] = (r + 2 * dr) * SIZE + c + 2 * dc;
  });
}
const FORWARD = [[0, 1], [2, 3]];
const ALL_DIRS = [0, 1, 2, 3];
export const dirsOf = (piece) => (isKing(piece) ? ALL_DIRS : FORWARD[owner(piece)]);

export function initialBoard() {
  const board = Array(SIZE * SIZE).fill(EMPTY);
  for (const sq of DARK) {
    if (rowOf(sq) < 3) board[sq] = 1;
    else if (rowOf(sq) >= SIZE - 3) board[sq] = 0;
  }
  return board;
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { moveSeconds, gameSeconds } = normalizeConfig(config);
  return {
    turn: first,
    winner: -1,
    first,
    board: initialBoard(),
    moves: [], // every path played, in order
    quiet: 0, // turns since the last capture or new king
    reason: null, // "captured" | "blocked" | "draw" | "timeout" once over
    moveMs: moveSeconds * 1000,
    clocks: gameSeconds ? [gameSeconds * 1000, gameSeconds * 1000] : null,
  };
}

export const isTimed = (state) => state.moveMs > 0 || state.clocks !== null;

// Milliseconds `player` may still spend on this move (Infinity without clocks).
export function timeLeft(state, player) {
  return Math.min(state.moveMs || Infinity, state.clocks ? state.clocks[player] : Infinity);
}

export function countPieces(board, player) {
  let n = 0;
  for (const sq of DARK) if (board[sq] !== EMPTY && owner(board[sq]) === player) n++;
  return n;
}

// Every full jump sequence from `path[0]`. Jumped pieces stay on the board
// until the move ends, so none can be jumped twice; the mover's own start
// square counts as empty. A man that reaches the far row is crowned and stops.
function collectJumps(board, piece, path, taken, out) {
  const from = path[path.length - 1];
  let extended = false;
  for (const d of dirsOf(piece)) {
    const to = JUMP[from * 4 + d];
    if (to < 0 || (board[to] !== EMPTY && to !== path[0])) continue;
    const over = STEP[from * 4 + d];
    const v = board[over];
    if (v === EMPTY || owner(v) === owner(piece) || taken.includes(over)) continue;
    extended = true;
    path.push(to);
    taken.push(over);
    if (!isKing(piece) && rowOf(to) === CROWN_ROW[owner(piece)]) out.push(path.slice());
    else collectJumps(board, piece, path, taken, out);
    path.pop();
    taken.pop();
  }
  if (!extended && path.length > 1) out.push(path.slice());
}

function canJump(board, sq, piece) {
  for (const d of dirsOf(piece)) {
    const to = JUMP[sq * 4 + d];
    if (to < 0 || board[to] !== EMPTY) continue;
    const v = board[STEP[sq * 4 + d]];
    if (v !== EMPTY && owner(v) !== owner(piece)) return true;
  }
  return false;
}

// All legal moves for `player`, each a path [from, ..., to]. When any capture
// is possible only captures are listed, each jumping as far as it can.
export function legalMoves(board, player) {
  const jumps = [];
  for (const sq of DARK) {
    const p = board[sq];
    if (p !== EMPTY && owner(p) === player && canJump(board, sq, p)) collectJumps(board, p, [sq], [], jumps);
  }
  if (jumps.length) return jumps;
  const steps = [];
  for (const sq of DARK) {
    const p = board[sq];
    if (p === EMPTY || owner(p) !== player) continue;
    for (const d of dirsOf(p)) {
      const to = STEP[sq * 4 + d];
      if (to >= 0 && board[to] === EMPTY) steps.push([sq, to]);
    }
  }
  return steps;
}

export const isJump = (path) => Math.abs(rowOf(path[1]) - rowOf(path[0])) === 2;

// The squares a path jumps over, in order.
export function capturedBy(path) {
  if (!isJump(path)) return [];
  const out = [];
  for (let k = 1; k < path.length; k++) out.push((path[k - 1] + path[k]) >> 1);
  return out;
}

const samePath = (a, b) => a.length === b.length && a.every((sq, k) => sq === b[k]);

function checkPath(state, player, path) {
  if (!Array.isArray(path) || path.length < 2 || path.length > 13 || !path.every((sq) => Number.isInteger(sq) && sq >= 0 && sq < SIZE * SIZE)) {
    throw new RuleError("Pick a piece and where it goes");
  }
  const piece = state.board[path[0]];
  if (piece === EMPTY || owner(piece) !== player) throw new RuleError("Pick one of your pieces");
  const legal = legalMoves(state.board, player);
  if (legal.some((m) => samePath(m, path))) return;
  if (legal.some((m) => m.length > path.length && samePath(m.slice(0, path.length), path))) throw new RuleError("Keep jumping: another capture is possible");
  if (legal.length && isJump(legal[0]) && !isJump(path)) throw new RuleError("You must capture");
  throw new RuleError("That piece can't move there");
}

// A move is { path, ms } (ms = time the mover spent, required when timed),
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
  const path = move?.path;
  checkPath(state, player, path);
  if (isTimed(state)) {
    const ms = move.ms;
    if (!Number.isInteger(ms) || ms < 0) throw new RuleError("Move time missing");
    if (ms > timeLeft(state, player)) throw new RuleError("Time ran out");
    if (state.clocks) state.clocks[player] -= ms;
  }
  const { board } = state;
  const from = path[0];
  const to = path[path.length - 1];
  const piece = board[from];
  const captured = capturedBy(path);
  const crowned = !isKing(piece) && rowOf(to) === CROWN_ROW[player];
  board[from] = EMPTY;
  for (const sq of captured) board[sq] = EMPTY;
  board[to] = crowned ? piece + 2 : piece;
  state.moves.push(path.slice());
  state.quiet = captured.length || crowned ? 0 : state.quiet + 1;
  const events = [{ type: "moved", player, path: path.slice(), captured, crowned }];
  const opp = 1 - player;
  if (legalMoves(board, opp).length === 0) {
    state.winner = player;
    state.reason = countPieces(board, opp) === 0 ? "captured" : "blocked";
    events.push({ type: "win", player, reason: state.reason });
  } else if (state.quiet >= QUIET_LIMIT) {
    state.winner = DRAW;
    state.reason = "draw";
    events.push({ type: "draw" });
  } else {
    state.turn = opp;
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
