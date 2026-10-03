// Chess rules for TurnMatch: FIDE moves (castling, en passant, promotion),
// checkmate, stalemate, and automatic draws on threefold repetition, the
// 50-move rule and insufficient material. A room picks the clocks and who
// moves first; the first player plays White. Pure: no DOM, timers or randomness.
//
// Squares are 0..63 with a1 = 0, h1 = 7 and a8 = 56. A piece is 1..6 for
// White (pawn, knight, bishop, rook, queen, king) and 9..14 for Black.
import { RuleError } from "../engine/turn-match.js";

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const WHITE = 0;
export const BLACK = 1;
export const DRAW = 2;

export const MOVE_SECONDS = [30, 60, 90, 120, 0]; // 0 = no limit
export const GAME_SECONDS = [180, 300, 600, 900, 1200, 3600, 0];
export const FIRST = ["random", "host", "guest"];
export const LEVELS = ["easy", "medium", "hard"];
export const DEFAULT_CONFIG = { moveSeconds: 0, gameSeconds: 0, first: "random", level: "easy" };
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const colorOf = (p) => p >> 3;
export const typeOf = (p) => p & 7;
export const pieceOf = (color, type) => (color << 3) | type;

const FILES = "abcdefgh";
const LETTERS = ".PNBRQK..pnbrqk"; // FEN letter by piece code
export const PROMO_TYPES = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT };
const PROMO_LETTER = ["", "", "n", "b", "r", "q"];

export const squareName = (sq) => FILES[sq & 7] + ((sq >> 3) + 1);
export function parseSquare(name) {
  const m = /^([a-h])([1-8])$/.exec(name);
  return m ? (Number(m[2]) - 1) * 8 + FILES.indexOf(m[1]) : -1;
}

// Any unknown or missing value falls back to the default.
export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    gameSeconds: pick(c.gameSeconds, GAME_SECONDS, DEFAULT_CONFIG.gameSeconds),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
  };
}

// ---------- board geometry ----------

function targets(steps) {
  return Array.from({ length: 64 }, (_, sq) =>
    steps.flatMap(([df, dr]) => {
      const f = (sq & 7) + df;
      const r = (sq >> 3) + dr;
      return f >= 0 && f < 8 && r >= 0 && r < 8 ? [r * 8 + f] : [];
    }),
  );
}
export const KNIGHT_TARGETS = targets([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]);
export const KING_TARGETS = targets([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]);
// RAYS[d][sq]: squares outward from sq. Directions 0-3 are straight, 4-7 diagonal.
export const RAYS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(([df, dr]) =>
  Array.from({ length: 64 }, (_, sq) => {
    const ray = [];
    for (let f = (sq & 7) + df, r = (sq >> 3) + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) ray.push(r * 8 + f);
    return ray;
  }),
);

export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;
// Rights kept when a piece moves from or to a square (a king or rook leaving, a rook captured).
const CASTLE_KEEP = Array(64).fill(15);
CASTLE_KEEP[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_KEEP[7] = 15 & ~CASTLE_WK;
CASTLE_KEEP[0] = 15 & ~CASTLE_WQ;
CASTLE_KEEP[60] = 15 & ~(CASTLE_BK | CASTLE_BQ);
CASTLE_KEEP[63] = 15 & ~CASTLE_BK;
CASTLE_KEEP[56] = 15 & ~CASTLE_BQ;
// King destination -> [rook from, rook to].
export const ROOK_HOP = { 6: [7, 5], 2: [0, 3], 62: [63, 61], 58: [56, 59] };

// ---------- moves as small ints, for speed (the robot searches with these) ----------

export const F_DOUBLE = 1;
export const F_EP = 2;
export const F_CASTLE = 3;
export const encode = (from, to, promo = 0, flag = 0) => from | (to << 6) | (promo << 12) | (flag << 15);
export const mFrom = (m) => m & 63;
export const mTo = (m) => (m >> 6) & 63;
export const mPromo = (m) => (m >> 12) & 7;
export const mFlag = (m) => m >> 15;

// The wire form: { from, to } plus promo ("q" | "r" | "b" | "n") for a promotion.
export function toMove(m) {
  const promo = mPromo(m);
  return promo ? { from: mFrom(m), to: mTo(m), promo: PROMO_LETTER[promo] } : { from: mFrom(m), to: mTo(m) };
}

// ---------- positions: { board, side, castling, ep, halfmove, kings } ----------

export function isAttacked(board, sq, by) {
  const f = sq & 7;
  const base = by << 3;
  // A pawn attacks diagonally forward, so look one row behind sq from its side.
  const back = by === WHITE ? sq - 8 : sq + 8;
  if (back >= 0 && back < 64 && ((f > 0 && board[back - 1] === base + PAWN) || (f < 7 && board[back + 1] === base + PAWN))) return true;
  for (const t of KNIGHT_TARGETS[sq]) if (board[t] === base + KNIGHT) return true;
  for (const t of KING_TARGETS[sq]) if (board[t] === base + KING) return true;
  for (let d = 0; d < 8; d++) {
    const slider = base + (d < 4 ? ROOK : BISHOP);
    for (const t of RAYS[d][sq]) {
      const p = board[t];
      if (!p) continue;
      if (p === slider || p === base + QUEEN) return true;
      break;
    }
  }
  return false;
}

export const inCheck = (pos, side = pos.side) => isAttacked(pos.board, pos.kings[side], side ^ 1);

function pushPromotions(from, to, out) {
  for (const t of [QUEEN, KNIGHT, ROOK, BISHOP]) out.push(encode(from, to, t));
}

// Pseudo-legal moves for the side to move (the king may be left in check).
// With capturesOnly, quiet moves are skipped, except promotions.
export function genMoves(pos, out = [], capturesOnly = false) {
  const { board, side } = pos;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || p >> 3 !== side) continue;
    switch (p & 7) {
      case PAWN: {
        const dir = side === WHITE ? 8 : -8;
        const one = sq + dir;
        const promo = one < 8 || one >= 56;
        const f = sq & 7;
        if (!board[one]) {
          if (promo) pushPromotions(sq, one, out);
          else if (!capturesOnly) {
            out.push(encode(sq, one));
            const home = side === WHITE ? sq < 16 : sq >= 48;
            if (home && !board[one + dir]) out.push(encode(sq, one + dir, 0, F_DOUBLE));
          }
        }
        for (const t of [f > 0 ? one - 1 : -1, f < 7 ? one + 1 : -1]) {
          if (t < 0) continue;
          const q = board[t];
          if (q && q >> 3 !== side) {
            if (promo) pushPromotions(sq, t, out);
            else out.push(encode(sq, t));
          } else if (t === pos.ep && !q) out.push(encode(sq, t, 0, F_EP));
        }
        break;
      }
      case KNIGHT:
        steps(board, sq, KNIGHT_TARGETS[sq], side, out, capturesOnly);
        break;
      case BISHOP:
        slides(board, sq, 4, 8, side, out, capturesOnly);
        break;
      case ROOK:
        slides(board, sq, 0, 4, side, out, capturesOnly);
        break;
      case QUEEN:
        slides(board, sq, 0, 8, side, out, capturesOnly);
        break;
      case KING:
        steps(board, sq, KING_TARGETS[sq], side, out, capturesOnly);
        if (!capturesOnly) castles(pos, sq, out);
        break;
    }
  }
  return out;
}

function steps(board, sq, list, side, out, capturesOnly) {
  for (const t of list) {
    const q = board[t];
    if (q ? q >> 3 !== side : !capturesOnly) out.push(encode(sq, t));
  }
}

function slides(board, sq, d0, d1, side, out, capturesOnly) {
  for (let d = d0; d < d1; d++) {
    for (const t of RAYS[d][sq]) {
      const q = board[t];
      if (!q) {
        if (!capturesOnly) out.push(encode(sq, t));
        continue;
      }
      if (q >> 3 !== side) out.push(encode(sq, t));
      break;
    }
  }
}

// The king may not castle out of, through or into check.
function castles(pos, sq, out) {
  const { board, side, castling } = pos;
  const home = side === WHITE ? 4 : 60;
  if (sq !== home || !(castling & (side === WHITE ? 3 : 12))) return;
  const foe = side ^ 1;
  const rook = pieceOf(side, ROOK);
  if (isAttacked(board, home, foe)) return;
  const kingSide = side === WHITE ? CASTLE_WK : CASTLE_BK;
  if (castling & kingSide && !board[home + 1] && !board[home + 2] && board[home + 3] === rook && !isAttacked(board, home + 1, foe) && !isAttacked(board, home + 2, foe)) {
    out.push(encode(home, home + 2, 0, F_CASTLE));
  }
  if (castling & (kingSide << 1) && !board[home - 1] && !board[home - 2] && !board[home - 3] && board[home - 4] === rook && !isAttacked(board, home - 1, foe) && !isAttacked(board, home - 2, foe)) {
    out.push(encode(home, home - 2, 0, F_CASTLE));
  }
}

// Plays m on pos and returns what unmakeMove needs to take it back.
export function makeMove(pos, m) {
  const { board } = pos;
  const from = m & 63;
  const to = (m >> 6) & 63;
  const promo = (m >> 12) & 7;
  const flag = m >> 15;
  const side = pos.side;
  const piece = board[from];
  const undo = { captured: board[to], capSq: to, castling: pos.castling, ep: pos.ep, halfmove: pos.halfmove };
  if (flag === F_EP) {
    undo.capSq = side === WHITE ? to - 8 : to + 8;
    undo.captured = board[undo.capSq];
    board[undo.capSq] = EMPTY;
  }
  board[to] = promo ? (side << 3) | promo : piece;
  board[from] = EMPTY;
  if (flag === F_CASTLE) {
    const [rf, rt] = ROOK_HOP[to];
    board[rt] = board[rf];
    board[rf] = EMPTY;
  }
  if ((piece & 7) === KING) pos.kings[side] = to;
  pos.castling &= CASTLE_KEEP[from] & CASTLE_KEEP[to];
  pos.ep = flag === F_DOUBLE ? (from + to) >> 1 : -1;
  pos.halfmove = (piece & 7) === PAWN || undo.captured ? 0 : pos.halfmove + 1;
  pos.side = side ^ 1;
  return undo;
}

export function unmakeMove(pos, m, undo) {
  const { board } = pos;
  const from = m & 63;
  const to = (m >> 6) & 63;
  const side = pos.side ^ 1;
  const moved = board[to];
  board[from] = (m >> 12) & 7 ? (side << 3) | PAWN : moved;
  board[to] = EMPTY;
  if (undo.captured) board[undo.capSq] = undo.captured;
  if (m >> 15 === F_CASTLE) {
    const [rf, rt] = ROOK_HOP[to];
    board[rf] = board[rt];
    board[rt] = EMPTY;
  }
  if ((moved & 7) === KING) pos.kings[side] = from;
  pos.side = side;
  pos.castling = undo.castling;
  pos.ep = undo.ep;
  pos.halfmove = undo.halfmove;
}

export function legalMoves(pos) {
  const side = pos.side;
  const out = [];
  for (const m of genMoves(pos)) {
    const undo = makeMove(pos, m);
    if (!isAttacked(pos.board, pos.kings[side], side ^ 1)) out.push(m);
    unmakeMove(pos, m, undo);
  }
  return out;
}

// Only kings, a king and one minor piece, or bishops all on one colour: nobody can mate.
export function insufficientMaterial(board) {
  let knights = 0;
  let bishops = 0;
  let bishopColors = 0;
  for (let sq = 0; sq < 64; sq++) {
    const t = board[sq] & 7;
    if (!t || t === KING) continue;
    if (t === KNIGHT) knights++;
    else if (t === BISHOP) {
      bishops++;
      bishopColors |= 1 << (((sq >> 3) + sq) & 1);
    } else return false;
  }
  return knights + bishops <= 1 || (knights === 0 && bishopColors !== 3);
}

// Same board, side to move, castling rights and en passant chance = same position.
export function positionKey(pos, legal = legalMoves(pos)) {
  let key = "";
  for (let sq = 0; sq < 64; sq++) key += LETTERS[pos.board[sq]];
  const ep = legal.some((m) => mFlag(m) === F_EP) ? squareName(pos.ep) : "-";
  return `${key} ${pos.side} ${pos.castling} ${ep}`;
}

// Standard algebraic notation, without the check suffix. legal = the mover's legal moves.
function sanOf(pos, m, legal) {
  const from = mFrom(m);
  const to = mTo(m);
  if (mFlag(m) === F_CASTLE) return (to & 7) === 6 ? "O-O" : "O-O-O";
  const piece = pos.board[from];
  const capture = pos.board[to] !== EMPTY || mFlag(m) === F_EP;
  let san = "";
  if ((piece & 7) === PAWN) {
    if (capture) san = `${FILES[from & 7]}x`;
  } else {
    san = LETTERS[piece & 7];
    const rivals = legal.filter((o) => mTo(o) === to && mFrom(o) !== from && pos.board[mFrom(o)] === piece);
    if (rivals.length) {
      if (!rivals.some((o) => (mFrom(o) & 7) === (from & 7))) san += FILES[from & 7];
      else if (!rivals.some((o) => mFrom(o) >> 3 === from >> 3)) san += (from >> 3) + 1;
      else san += squareName(from);
    }
    if (capture) san += "x";
  }
  san += squareName(to);
  if (mPromo(m)) san += `=${LETTERS[mPromo(m)]}`;
  return san;
}

// ---------- FEN ----------

export function parseFen(fen) {
  const [placement, side, castling, ep, halfmove, fullmove] = String(fen).trim().split(/\s+/);
  const board = Array(64).fill(EMPTY);
  const kings = [-1, -1];
  const rows = placement.split("/");
  if (rows.length !== 8) throw new Error(`bad FEN: ${fen}`);
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        const p = LETTERS.indexOf(ch);
        if (p < 1) throw new Error(`bad FEN piece: ${ch}`);
        const sq = (7 - i) * 8 + f++;
        board[sq] = p;
        if ((p & 7) === KING) kings[p >> 3] = sq;
      }
    }
    if (f !== 8) throw new Error(`bad FEN row: ${row}`);
  });
  let rights = 0;
  for (const [ch, bit] of [["K", CASTLE_WK], ["Q", CASTLE_WQ], ["k", CASTLE_BK], ["q", CASTLE_BQ]]) if (castling?.includes(ch)) rights |= bit;
  return {
    board,
    side: side === "b" ? BLACK : WHITE,
    castling: rights,
    ep: ep && ep !== "-" ? parseSquare(ep) : -1,
    halfmove: Number(halfmove) || 0,
    fullmove: Number(fullmove) || 1,
    kings,
  };
}

export function toFen(pos) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "";
    let gap = 0;
    for (let f = 0; f < 8; f++) {
      const p = pos.board[r * 8 + f];
      if (!p) gap++;
      else {
        row += (gap || "") + LETTERS[p];
        gap = 0;
      }
    }
    rows.push(row + (gap || ""));
  }
  const rights = [["K", CASTLE_WK], ["Q", CASTLE_WQ], ["k", CASTLE_BK], ["q", CASTLE_BQ]].filter(([, bit]) => pos.castling & bit).map(([ch]) => ch).join("");
  return `${rows.join("/")} ${pos.side ? "b" : "w"} ${rights || "-"} ${pos.ep >= 0 ? squareName(pos.ep) : "-"} ${pos.halfmove} ${pos.fullmove ?? 1}`;
}

// ---------- game state ----------

// `white` is the player (0 = host, 1 = guest) with the white pieces.
export function stateFromFen(fen, { white = 0, moveSeconds = 0, gameSeconds = 0 } = {}) {
  const pos = parseFen(fen);
  return {
    turn: pos.side === WHITE ? white : 1 - white,
    winner: -1,
    white,
    ...pos,
    moves: [],
    captured: [[], []], // piece types taken by White, by Black
    positions: [positionKey(pos)],
    reason: null, // "checkmate" | "stalemate" | "repetition" | "fifty" | "material" | "timeout" | "resign" once over
    moveMs: moveSeconds * 1000,
    clocks: gameSeconds ? [gameSeconds * 1000, gameSeconds * 1000] : null,
  };
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { moveSeconds, gameSeconds } = normalizeConfig(config);
  return stateFromFen(START_FEN, { white: first, moveSeconds, gameSeconds });
}

export const colorOfPlayer = (state, player) => (player === state.white ? WHITE : BLACK);
export const isTimed = (state) => state.moveMs > 0 || state.clocks !== null;

// Milliseconds `player` may still spend on this move (Infinity without clocks).
export function timeLeft(state, player) {
  return Math.min(state.moveMs || Infinity, state.clocks ? state.clocks[player] : Infinity);
}

// Legal moves for the side to move, in wire form.
export const listMoves = (state) => legalMoves(state).map(toMove);

const isSquare = (v) => Number.isInteger(v) && v >= 0 && v < 64;

// The legal move matching a wire move, or a RuleError saying why there is none.
function findMove(state, move) {
  const { from, to, promo } = move;
  if (!isSquare(from) || !isSquare(to)) throw new RuleError("Pick a square on the board");
  const piece = state.board[from];
  if (!piece || piece >> 3 !== state.side) throw new RuleError("Pick one of your own pieces");
  if (promo !== undefined && !Object.hasOwn(PROMO_TYPES, promo)) throw new RuleError("Promote to a queen, rook, bishop or knight");
  const matches = legalMoves(state).filter((m) => mFrom(m) === from && mTo(m) === to);
  if (!matches.length) {
    const pseudo = genMoves(state).some((m) => mFrom(m) === from && mTo(m) === to);
    throw new RuleError(pseudo ? "That would leave your king in check" : "That piece can't move there");
  }
  if (!mPromo(matches[0])) {
    if (promo !== undefined) throw new RuleError("Only a pawn reaching the last row promotes");
    return matches[0];
  }
  if (promo === undefined) throw new RuleError("Pick a piece to promote to");
  return matches.find((m) => mPromo(m) === PROMO_TYPES[promo]);
}

// A move is { from, to, promo?, ms } (ms = time the mover spent, required when
// timed), { timeout: true } when the mover's own clock runs out, or
// { resign: true }.
export function applyMove(state, player, move) {
  if (state.winner !== -1) throw new RuleError("The game is over");
  if (state.turn !== player) throw new RuleError("Not your turn");
  if (move?.timeout === true) {
    if (!isTimed(state)) throw new RuleError("This game has no clock");
    state.winner = 1 - player;
    state.reason = "timeout";
    return [{ type: "timeout", player }];
  }
  if (move?.resign === true) {
    state.winner = 1 - player;
    state.reason = "resign";
    return [{ type: "resign", player }];
  }
  if (!move || typeof move !== "object") throw new RuleError("Pick a square on the board");
  const legal = legalMoves(state);
  const m = findMove(state, move);
  if (isTimed(state)) {
    const ms = move.ms;
    if (!Number.isInteger(ms) || ms < 0) throw new RuleError("Move time missing");
    if (ms > timeLeft(state, player)) throw new RuleError("Time ran out");
    if (state.clocks) state.clocks[player] -= ms;
  }
  const mover = state.side;
  const san = sanOf(state, m, legal);
  const undo = makeMove(state, m);
  if (undo.captured) state.captured[mover].push(undo.captured & 7);
  if (state.side === WHITE) state.fullmove++;
  state.turn = 1 - player;
  const reply = legalMoves(state);
  const check = inCheck(state);
  const record = { ...toMove(m), san: san + (check ? (reply.length ? "+" : "#") : "") };
  state.moves.push(record);
  const key = positionKey(state, reply);
  if (state.halfmove === 0) state.positions = [key];
  else state.positions.push(key);

  // capturedAt differs from `to` only for en passant.
  const events = [{ type: "moved", player, ...record, captured: undo.captured & 7, capturedAt: undo.captured ? undo.capSq : -1, check }];
  let reason = null;
  if (!reply.length) reason = check ? "checkmate" : "stalemate";
  else if (insufficientMaterial(state.board)) reason = "material";
  else if (state.positions.filter((k) => k === key).length >= 3) reason = "repetition";
  else if (state.halfmove >= 100) reason = "fifty";
  if (reason) {
    state.reason = reason;
    state.winner = reason === "checkmate" ? player : DRAW;
    events.push(reason === "checkmate" ? { type: "checkmate", player } : { type: "draw", reason });
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
