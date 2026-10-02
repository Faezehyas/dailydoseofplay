// Checkers robot: take a win, avoid a move that loses on the spot, otherwise
// search with alpha-beta (deeper and steadier at higher levels), except that
// now and then it plays a random move so it can be beaten.
import { randInt } from "../engine/rng.js";
import { legalMoves, capturedBy, isJump, isKing, owner, rowOf, colOf, dirsOf, DARK, EMPTY, STEP, CROWN_ROW, QUIET_LIMIT } from "./rules.js";

export const LEVELS = {
  easy: { depth: 4, randomChance: 0.3 },
  medium: { depth: 5, randomChance: 0.1 },
  hard: { depth: 6, randomChance: 0 },
};
export const DEFAULT_LEVEL = "easy";

const WIN = 100_000;
const MAN = 100;
const KING = 150;
const MAX_PLY = 24; // forced captures extend the search, up to this far
const NODE_BUDGET = 20_000; // across all depths, so a move stays well under 100 ms

function make(board, path) {
  const from = path[0];
  const to = path[path.length - 1];
  const piece = board[from];
  const caps = capturedBy(path);
  const capVals = caps.map((sq) => board[sq]);
  const crowned = !isKing(piece) && rowOf(to) === CROWN_ROW[owner(piece)];
  board[from] = EMPTY;
  for (const sq of caps) board[sq] = EMPTY;
  board[to] = crowned ? piece + 2 : piece;
  return { from, to, piece, caps, capVals, crowned };
}

function unmake(board, u) {
  board[u.to] = EMPTY;
  board[u.from] = u.piece;
  u.caps.forEach((sq, k) => (board[sq] = u.capVals[k]));
}

// Static score for `player`: material, men's advance, a guarded back row,
// central kings and mobility. When ahead, it likes trades and kings that close in.
export function evaluate(board, player) {
  let score = 0;
  let mobility = 0;
  let mine = 0;
  let theirs = 0;
  let count = 0;
  for (const sq of DARK) {
    const p = board[sq];
    if (p === EMPTY) continue;
    const who = owner(p);
    const r = rowOf(sq);
    const c = colOf(sq);
    let v;
    if (isKing(p)) v = KING + 6 - Math.abs(3.5 - r) - Math.abs(3.5 - c);
    else {
      const advance = who === 0 ? 7 - r : r;
      v = MAN + advance * 3 + (advance === 0 ? 8 : 0) + (c === 0 || c === 7 ? -4 : 0);
    }
    let free = 0;
    for (const d of dirsOf(p)) {
      const to = STEP[sq * 4 + d];
      if (to >= 0 && board[to] === EMPTY) free++;
    }
    count++;
    if (who === player) {
      score += v;
      mobility += free;
      mine += isKing(p) ? KING : MAN;
    } else {
      score -= v;
      mobility -= free;
      theirs += isKing(p) ? KING : MAN;
    }
  }
  score += 2 * mobility;
  if (mine !== theirs) score += mine > theirs ? endgame(board, player, count) : -endgame(board, 1 - player, count);
  return score;
}

// For the side that is ahead: fewer pieces left, and kings near the enemy.
function endgame(board, ahead, count) {
  let bonus = (24 - count) * 4;
  for (const k of DARK) {
    if (board[k] === EMPTY || owner(board[k]) !== ahead || !isKing(board[k])) continue;
    let near = 8;
    for (const e of DARK) {
      if (board[e] === EMPTY || owner(board[e]) === ahead) continue;
      near = Math.min(near, Math.max(Math.abs(rowOf(k) - rowOf(e)), Math.abs(colOf(k) - colOf(e))));
    }
    bonus -= near * 3;
  }
  return bonus;
}

// Captures that take more pieces first, then crownings.
function order(board, moves) {
  if (moves.length < 2) return moves;
  const key = (m) => m.length * 4 + (!isKing(board[m[0]]) && rowOf(m[m.length - 1]) === CROWN_ROW[owner(board[m[0]])] ? 2 : 0);
  return moves.slice().sort((a, b) => key(b) - key(a));
}

function search(ctx, board, player, depth, alpha, beta, ply, quiet) {
  if (++ctx.nodes > ctx.budget) return 0; // out of budget: this depth's result is thrown away
  const moves = legalMoves(board, player);
  if (!moves.length) return -WIN + ply;
  if (quiet >= QUIET_LIMIT) return 0;
  const forced = isJump(moves[0]) || moves.length === 1;
  if ((depth <= 0 && !forced) || ply >= MAX_PLY) return evaluate(board, player);
  let best = -Infinity;
  for (const m of order(board, moves)) {
    const u = make(board, m);
    const q = u.caps.length || u.crowned ? 0 : quiet + 1;
    const s = -search(ctx, board, 1 - player, depth - 1, -beta, -alpha, ply + 1, q);
    unmake(board, u);
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return best;
}

// Best of `moves` for `player`, searched `depth` plies deep; ties go to the
// earliest in `moves`, which the caller shuffles.
function bestMove(board, player, moves, depth, quiet, ctx) {
  let best = moves[0];
  let alpha = -Infinity;
  for (const m of moves) {
    const u = make(board, m);
    const q = u.caps.length || u.crowned ? 0 : quiet + 1;
    const s = -search(ctx, board, 1 - player, depth - 1, -Infinity, -alpha, 1, q);
    unmake(board, u);
    if (s > alpha) {
      alpha = s;
      best = m;
    }
  }
  return { move: best, score: alpha };
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns { path } for `me`. Options override the level's depth and random chance.
export function chooseMove(state, me, rng = Math.random, { level = DEFAULT_LEVEL, depth, randomChance, budget = NODE_BUDGET } = {}) {
  const preset = LEVELS[level] || LEVELS[DEFAULT_LEVEL];
  depth ??= preset.depth;
  randomChance ??= preset.randomChance;
  const board = state.board.slice();
  const opp = 1 - me;
  const moves = shuffle(legalMoves(board, me), rng);
  if (moves.length === 1) return { path: moves[0] };
  // A move that leaves the opponent stuck wins; one that lets them do that to us loses.
  const safe = [];
  for (const m of moves) {
    const u = make(board, m);
    const replies = legalMoves(board, opp);
    let loses = false;
    for (const r of replies) {
      const v = make(board, r);
      loses = legalMoves(board, me).length === 0;
      unmake(board, v);
      if (loses) break;
    }
    unmake(board, u);
    if (!replies.length) return { path: m };
    if (!loses) safe.push(m);
  }
  const pool = safe.length ? safe : moves;
  if (rng() < randomChance) return { path: pool[randInt(rng, pool.length)] };
  const ctx = { nodes: 0, budget };
  let best = pool[0];
  // Iterative deepening: a finished shallower search is the fallback when the budget runs out.
  for (let d = 2; d <= depth; d++) {
    const ordered = [best, ...pool.filter((m) => m !== best)];
    const result = bestMove(board, me, ordered, d, state.quiet, ctx);
    if (ctx.nodes > budget && d > 2) break;
    best = result.move;
    if (result.score >= WIN - 100) break;
  }
  return { path: best };
}
