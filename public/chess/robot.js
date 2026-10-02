// Chess robot: it takes a mate in one, avoids allowing one, then runs an
// alpha-beta search over material and piece-square tables, with captures
// searched until the position is quiet. Levels change the depth, how far it
// strays from its best move, and how often it plays a random safe move.
import { randInt } from "../engine/rng.js";
import {
  genMoves,
  makeMove,
  unmakeMove,
  isAttacked,
  legalMoves,
  inCheck,
  insufficientMaterial,
  positionKey,
  toMove,
  mFrom,
  mTo,
  mPromo,
  F_CASTLE,
  ROOK_HOP,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  WHITE,
} from "./rules.js";

// depth: plies of full search; margin: centipawns a move may trail the best
// and still be picked; maxNodes: search budget, so time stays bounded.
export const LEVELS = {
  easy: { depth: 2, margin: 150, randomChance: 0.2, maxNodes: 15_000 },
  medium: { depth: 3, margin: 40, randomChance: 0.05, maxNodes: 40_000 },
  hard: { depth: 4, margin: 0, randomChance: 0, maxNodes: 80_000 },
};

const MATE = 100_000;
const VALUE = [0, 100, 320, 330, 500, 900, 0];

// Piece-square tables from White's side, rank 8 first (the "simplified
// evaluation function" from chessprogramming.org).
const TABLES = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ROOK]: [
    0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0,
  ],
  [QUEEN]: [
    -20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  [KING]: [
    -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20,
  ],
};
const KING_ENDGAME = [
  -50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50,
];

// Value plus table bonus per square: positive for White, negative for Black.
function scoreTable(type, table) {
  const white = [];
  const black = [];
  for (let sq = 0; sq < 64; sq++) {
    const r = sq >> 3;
    const f = sq & 7;
    white[sq] = VALUE[type] + table[(7 - r) * 8 + f];
    black[sq] = -(VALUE[type] + table[r * 8 + f]);
  }
  return [white, black];
}
const SCORE = [];
for (let type = PAWN; type <= KING; type++) [SCORE[type], SCORE[8 + type]] = scoreTable(type, TABLES[type]);
const [KING_END_W, KING_END_B] = scoreTable(KING, KING_ENDGAME);

const centerDistance = (sq) => Math.max(3 - (sq >> 3), (sq >> 3) - 4, 0) + Math.max(3 - (sq & 7), (sq & 7) - 4, 0);
const distance = (a, b) => Math.max(Math.abs((a >> 3) - (b >> 3)), Math.abs((a & 7) - (b & 7)));

// A search position: the rules' fields plus running totals, so evaluation is O(1).
// psq: piece-square score without kings; mat: material per side; heavy: non-pawn material.
function searchPos(state) {
  const pos = {
    board: state.board.slice(),
    side: state.side,
    castling: state.castling,
    ep: state.ep,
    halfmove: state.halfmove,
    kings: state.kings.slice(),
    psq: 0,
    mat: [0, 0],
    heavy: 0,
  };
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    const t = p & 7;
    if (!p || t === KING) continue;
    pos.psq += SCORE[p][sq];
    pos.mat[p >> 3] += VALUE[t];
    if (t !== PAWN) pos.heavy += VALUE[t];
  }
  return pos;
}

function play(pos, m) {
  const from = m & 63;
  const to = (m >> 6) & 63;
  const piece = pos.board[from];
  const undo = makeMove(pos, m);
  undo.psq = pos.psq;
  undo.matW = pos.mat[0];
  undo.matB = pos.mat[1];
  undo.heavy = pos.heavy;
  const placed = pos.board[to];
  if ((piece & 7) !== KING) pos.psq += SCORE[placed][to] - SCORE[piece][from];
  else if (m >> 15 === F_CASTLE) {
    const rook = placed - KING + ROOK;
    const [rf, rt] = ROOK_HOP[to];
    pos.psq += SCORE[rook][rt] - SCORE[rook][rf];
  }
  const cap = undo.captured;
  if (cap) {
    pos.psq -= SCORE[cap][undo.capSq];
    pos.mat[cap >> 3] -= VALUE[cap & 7];
    if ((cap & 7) !== PAWN) pos.heavy -= VALUE[cap & 7];
  }
  const promo = (m >> 12) & 7;
  if (promo) {
    pos.mat[piece >> 3] += VALUE[promo] - VALUE[PAWN];
    pos.heavy += VALUE[promo];
  }
  return undo;
}

function unplay(pos, m, undo) {
  unmakeMove(pos, m, undo);
  pos.psq = undo.psq;
  pos.mat[0] = undo.matW;
  pos.mat[1] = undo.matB;
  pos.heavy = undo.heavy;
}

// Static evaluation in centipawns, from the side to move's point of view.
export function evaluate(pos) {
  const [wk, bk] = pos.kings;
  let score = pos.psq;
  if (pos.heavy > 1300) score += SCORE[KING][wk] + SCORE[8 + KING][bk];
  else {
    score += KING_END_W[wk] + KING_END_B[bk];
    // Winning endgame: drive the lone king to the edge and walk ours over.
    const lead = pos.mat[0] - pos.mat[1];
    if (lead >= 300 || lead <= -300) {
      const push = 10 * centerDistance(lead > 0 ? bk : wk) + 4 * (7 - distance(wk, bk));
      score += lead > 0 ? push : -push;
    }
  }
  return pos.side === WHITE ? score : -score;
}

export const evaluateState = (state) => evaluate(searchPos(state));

class Stop extends Error {}

// Captures first (most valuable victim, cheapest attacker), then promotions
// and killer moves; quiet moves keep their order after them.
function ordered(board, moves, killers) {
  const front = [];
  const quiet = [];
  for (const m of moves) {
    const victim = board[mTo(m)] & 7;
    if (victim) front.push((10_000 + VALUE[victim] * 10 - (VALUE[board[mFrom(m)] & 7] >> 4)) * 262_144 + m);
    else if (mPromo(m)) front.push((9_000 + VALUE[mPromo(m)]) * 262_144 + m);
    else if (killers && (m === killers[0] || m === killers[1])) front.push(8_000 * 262_144 + m);
    else quiet.push(m);
  }
  if (!front.length) return quiet;
  front.sort((a, b) => b - a);
  for (let i = 0; i < front.length; i++) front[i] %= 262_144;
  return quiet.length ? front.concat(quiet) : front;
}

class Searcher {
  constructor({ maxNodes = Infinity, timeMs = Infinity }) {
    this.nodes = 0;
    this.maxNodes = maxNodes;
    this.deadline = timeMs === Infinity ? Infinity : performance.now() + timeMs;
    this.killers = [];
  }

  tick() {
    if (++this.nodes > this.maxNodes || ((this.nodes & 1023) === 0 && performance.now() > this.deadline)) throw new Stop();
  }

  search(pos, depth, alpha, beta, ply) {
    if (depth <= 0) return this.quiesce(pos, alpha, beta, ply, 0);
    this.tick();
    const side = pos.side;
    const checked = isAttacked(pos.board, pos.kings[side], side ^ 1);
    const killers = (this.killers[ply] ||= [0, 0]);
    let legal = 0;
    for (const m of ordered(pos.board, genMoves(pos), killers)) {
      const undo = play(pos, m);
      if (isAttacked(pos.board, pos.kings[side], side ^ 1)) {
        unplay(pos, m, undo);
        continue;
      }
      legal++;
      const score = -this.search(pos, depth - 1, -beta, -alpha, ply + 1);
      unplay(pos, m, undo);
      if (score >= beta) {
        if (!undo.captured && m !== killers[0]) {
          killers[1] = killers[0];
          killers[0] = m;
        }
        return score;
      }
      if (score > alpha) alpha = score;
    }
    if (!legal) return checked ? -MATE + ply : 0;
    return alpha;
  }

  // Captures only, until quiet. In check near the leaf every evasion counts, so mates are seen.
  quiesce(pos, alpha, beta, ply, qply) {
    this.tick();
    const side = pos.side;
    const checked = qply < 2 && isAttacked(pos.board, pos.kings[side], side ^ 1);
    let stand = 0;
    if (!checked) {
      stand = evaluate(pos);
      if (stand >= beta || qply >= 6) return stand;
      if (stand > alpha) alpha = stand;
    }
    let legal = 0;
    for (const m of ordered(pos.board, genMoves(pos, [], !checked))) {
      const attacker = VALUE[pos.board[mFrom(m)] & 7];
      const victim = VALUE[pos.board[mTo(m)] & 7] || VALUE[PAWN];
      // Even winning this piece cannot lift the score to alpha.
      if (!checked && !mPromo(m) && stand + victim + 200 <= alpha) continue;
      const undo = play(pos, m);
      // Illegal, or a big piece taking a smaller defended one.
      if (isAttacked(pos.board, pos.kings[side], side ^ 1) || (!checked && attacker > victim + 50 && isAttacked(pos.board, mTo(m), side ^ 1))) {
        unplay(pos, m, undo);
        continue;
      }
      legal++;
      const score = -this.quiesce(pos, -beta, -alpha, ply + 1, qply + 1);
      unplay(pos, m, undo);
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    if (checked && !legal) return -MATE + ply;
    return alpha;
  }
}

// True if the side to move is checkmated.
function mated(pos) {
  if (!inCheck(pos)) return false;
  const side = pos.side;
  for (const m of genMoves(pos)) {
    const undo = makeMove(pos, m);
    const safe = !isAttacked(pos.board, pos.kings[side], side ^ 1);
    unmakeMove(pos, m, undo);
    if (safe) return false;
  }
  return true;
}

// True if after m the opponent has a mate in one.
function allowsMate(pos, m) {
  const undo = makeMove(pos, m);
  const them = pos.side;
  let found = false;
  for (const reply of genMoves(pos)) {
    const u = makeMove(pos, reply);
    found = !isAttacked(pos.board, pos.kings[them], them ^ 1) && mated(pos);
    unmakeMove(pos, reply, u);
    if (found) break;
  }
  unmakeMove(pos, m, undo);
  return found;
}

// Score root moves (ints) by iterative deepening up to `depth`, within the
// node and time budget. A move that ends the game in a draw by rule scores 0.
// Moves trailing the best by more than `margin` may get only an upper bound.
export function scoreMoves(state, moves, { depth = 3, margin = 0, maxNodes = Infinity, timeMs = Infinity } = {}) {
  const pos = searchPos(state);
  const searcher = new Searcher({ maxNodes, timeMs });
  const draws = new Set();
  for (const m of moves) {
    const undo = makeMove(pos, m);
    const reply = legalMoves(pos);
    const key = pos.halfmove ? positionKey(pos, reply) : "";
    const repeats = key ? state.positions.filter((k) => k === key).length : 0;
    const drawn = reply.length ? repeats >= 2 || pos.halfmove >= 100 || insufficientMaterial(pos.board) : !inCheck(pos);
    if (drawn) draws.add(m);
    unmakeMove(pos, m, undo);
  }
  let done = moves.map((m) => ({ m, score: 0 }));
  let order = ordered(pos.board, moves.slice());
  let reached = 0;
  for (let d = 1; d <= depth; d++) {
    const scored = [];
    let best = -Infinity;
    try {
      for (const m of order) {
        let score = 0;
        if (!draws.has(m)) {
          const undo = play(pos, m);
          try {
            score = -searcher.search(pos, d - 1, -Infinity, -(best - margin - 1), 1);
          } finally {
            unplay(pos, m, undo);
          }
        }
        scored.push({ m, score });
        if (score > best) best = score;
      }
    } catch (err) {
      if (!(err instanceof Stop)) throw err;
      break;
    }
    done = scored;
    reached = d;
    order = scored.slice().sort((a, b) => b.score - a.score).map((s) => s.m);
  }
  return { scored: done, depth: reached, nodes: searcher.nodes };
}

export function chooseMove(state, me, rng = Math.random, { level = "easy", ...overrides } = {}) {
  const opts = { ...(LEVELS[level] || LEVELS.easy), ...overrides };
  const pos = searchPos(state);
  const legal = legalMoves(pos);
  // Take a mate in one.
  for (const m of legal) {
    const undo = makeMove(pos, m);
    const win = mated(pos);
    unmakeMove(pos, m, undo);
    if (win) return toMove(m);
  }
  // Never let the opponent mate next move, if that can be helped.
  const safe = legal.filter((m) => !allowsMate(pos, m));
  const pool = safe.length ? safe : legal;
  if (pool.length === 1) return toMove(pool[0]);
  if (rng() < opts.randomChance) return toMove(pool[randInt(rng, pool.length)]);
  const { scored } = scoreMoves(state, pool, opts);
  const best = Math.max(...scored.map((s) => s.score));
  const picks = scored.filter((s) => s.score >= best - opts.margin);
  return toMove(picks[randInt(rng, picks.length)].m);
}

