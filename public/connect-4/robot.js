// Connect 4 robot: take a win, block a loss, otherwise search a few moves
// ahead (negamax with alpha-beta) and score the board by open lines, threats
// and the centre. Levels change the depth and how often it plays a random
// column instead, so Easy blunders, Medium slips now and then, and Hard rarely.
import { randInt } from "../engine/rng.js";
import { EMPTY, IN_A_ROW, linesFor, openColumns } from "./rules.js";

export const LEVELS = {
  easy: { depth: 4, randomChance: 0.3, safeRandom: false },
  medium: { depth: 5, randomChance: 0.1, safeRandom: true },
  hard: { depth: 6, randomChance: 0.03, safeRandom: true },
};

const WIN = 1_000_000;
const WEIGHT = [0, 1, 6, 40]; // an open line holding 0..3 of one player's discs
const PARITY_BONUS = 30; // a three whose gap is on the row that suits its owner
const CENTRE = 3;
const DIRS = [0, 1, 1, 0, 1, 1, 1, -1]; // (row, col) steps: across, down, two diagonals

// Per board size: every line, the lines through each square, and the column
// order to try (centre first).
const geometry = new Map();
function geometryFor(cols, rows) {
  const key = `${cols}x${rows}`;
  if (!geometry.has(key)) {
    const lines = linesFor(cols, rows);
    const through = Array.from({ length: cols * rows }, () => []);
    lines.forEach((line, i) => line.forEach((cell) => through[cell].push(i)));
    const mid = (cols - 1) / 2;
    const order = [...Array(cols).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
    const centre = new Set(cols % 2 ? [mid] : [mid - 0.5, mid + 0.5]);
    geometry.set(key, { lines, through, order, centre });
  }
  return geometry.get(key);
}

// A scratch board the search mutates and restores. It keeps how many discs
// each player has in every line, and the static score for player 0, up to date.
class Board {
  constructor(state) {
    this.cols = state.cols;
    this.rows = state.rows;
    this.first = state.first;
    Object.assign(this, geometryFor(this.cols, this.rows));
    this.cells = new Int8Array(state.board.length).fill(EMPTY);
    this.heights = new Int8Array(this.cols);
    this.count = [new Int8Array(this.lines.length), new Int8Array(this.lines.length)];
    this.free = this.cells.length;
    this.score = 0;
    this.saved = [];
    // Replay bottom-up so heights and counts match the real board.
    for (let r = this.rows - 1; r >= 0; r--) {
      for (let c = 0; c < this.cols; c++) {
        const v = state.board[r * this.cols + c];
        if (v !== EMPTY) this.drop(c, v);
      }
    }
  }
  landing(col) {
    const h = this.heights[col];
    return h < this.rows ? (this.rows - 1 - h) * this.cols + col : -1;
  }
  // Static value of line i for player 0.
  lineValue(i) {
    const a = this.count[0][i];
    const b = this.count[1][i];
    if (a && b) return 0;
    const n = a || b;
    if (!n) return 0;
    let s = WEIGHT[n] || 0;
    if (n === IN_A_ROW - 1) {
      const line = this.lines[i];
      let gap = line[0];
      for (const cell of line) if (this.cells[cell] === EMPTY) gap = cell;
      const rowFromBottom = this.rows - Math.floor(gap / this.cols); // 1-based
      const owner = a ? 0 : 1;
      if (rowFromBottom % 2 === (owner === this.first ? 1 : 0)) s += PARITY_BONUS;
    }
    return a ? s : -s;
  }
  drop(col, player) {
    const cell = this.landing(col);
    this.saved.push(this.score);
    const through = this.through[cell];
    for (const i of through) this.score -= this.lineValue(i);
    this.cells[cell] = player;
    this.heights[col]++;
    this.free--;
    const count = this.count[player];
    for (const i of through) count[i]++;
    for (const i of through) this.score += this.lineValue(i);
    if (this.centre.has(col)) this.score += player === 0 ? CENTRE : -CENTRE;
    return cell;
  }
  undo(col, cell) {
    const count = this.count[this.cells[cell]];
    for (const i of this.through[cell]) count[i]--;
    this.cells[cell] = EMPTY;
    this.heights[col]--;
    this.free++;
    this.score = this.saved.pop();
  }
  // True when `player` dropping on `cell` would complete a line.
  wouldWin(cell, player) {
    const { cells, cols, rows } = this;
    const r0 = (cell / cols) | 0;
    const c0 = cell % cols;
    for (let d = 0; d < 8; d += 2) {
      const dr = DIRS[d];
      const dc = DIRS[d + 1];
      let run = 1;
      let r = r0 + dr;
      let c = c0 + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols && cells[r * cols + c] === player) {
        run++;
        r += dr;
        c += dc;
      }
      r = r0 - dr;
      c = c0 - dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols && cells[r * cols + c] === player) {
        run++;
        r -= dr;
        c -= dc;
      }
      if (run >= IN_A_ROW) return true;
    }
    return false;
  }
  // Columns where `player` would complete a line right now.
  winningColumns(player) {
    const out = [];
    for (const col of this.order) {
      const cell = this.landing(col);
      if (cell >= 0 && this.wouldWin(cell, player)) out.push(col);
    }
    return out;
  }
  // True when a disc in `col` would let `opp` win on the square above it.
  givesWin(col, opp) {
    const above = this.landing(col) - this.cols;
    return above >= 0 && this.heights[col] + 1 < this.rows && this.wouldWin(above, opp);
  }
}

// Negamax with alpha-beta. Scores are for `player`, who is about to move;
// sooner wins score higher. Forced moves are found before searching: win now,
// block the only threat, and never drop under the opponent's winning square.
function negamax(b, depth, alpha, beta, player, ply) {
  if (b.free === 0) return 0;
  const opp = 1 - player;
  const { order, cols, rows, heights } = b;
  let threats = 0;
  let forced = -1;
  for (let k = 0; k < cols; k++) {
    const col = order[k];
    const cell = b.landing(col);
    if (cell < 0) continue;
    if (b.wouldWin(cell, player)) return WIN - ply;
    if (b.wouldWin(cell, opp)) {
      threats++;
      forced = col;
    }
  }
  if (threats > 1) return -(WIN - ply - 1);
  const moves = [];
  for (let k = 0; k < cols; k++) {
    const col = threats ? forced : order[k];
    if (heights[col] < rows && !b.givesWin(col, opp)) moves.push(col);
    if (threats) break;
  }
  if (!moves.length) return -(WIN - ply - 1);
  if (depth === 0) return player === 0 ? b.score : -b.score;
  if (depth > 2 && moves.length > 1) {
    // Try the moves that look best first, so alpha-beta cuts more.
    const sign = player === 0 ? 1 : -1;
    const keys = new Map();
    for (const col of moves) {
      const cell = b.drop(col, player);
      keys.set(col, sign * b.score);
      b.undo(col, cell);
    }
    moves.sort((x, y) => keys.get(y) - keys.get(x));
  }
  let best = -Infinity;
  for (const col of moves) {
    const cell = b.drop(col, player);
    const score = -negamax(b, depth - 1, -beta, -alpha, opp, ply + 1);
    b.undo(col, cell);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

// Search score of each open column for `me`: exact for the best ones, an upper
// bound for the rest.
export function scoreColumns(state, me, depth) {
  const b = new Board(state);
  const scored = [];
  let alpha = -Infinity;
  for (const col of b.order) {
    const cell = b.landing(col);
    if (cell < 0) continue;
    let score;
    if (b.wouldWin(cell, me)) score = WIN;
    else {
      b.drop(col, me);
      score = -negamax(b, depth - 1, -Infinity, -(alpha - 1), 1 - me, 1);
      b.undo(col, cell);
    }
    scored.push({ col, score });
    if (score > alpha) alpha = score;
  }
  return scored;
}

export function chooseMove(state, me, rng = Math.random, { level = "medium", ...overrides } = {}) {
  const { depth, randomChance, safeRandom } = { ...(LEVELS[level] || LEVELS.medium), ...overrides };
  const b = new Board(state);
  const [win] = b.winningColumns(me);
  if (win !== undefined) return { col: win };
  const [block] = b.winningColumns(1 - me);
  if (block !== undefined) return { col: block };
  if (rng() < randomChance) {
    const open = openColumns(state);
    const safe = safeRandom ? open.filter((col) => !b.givesWin(col, 1 - me)) : [];
    const pool = safe.length ? safe : open;
    return { col: pool[randInt(rng, pool.length)] };
  }
  const scored = scoreColumns(state, me, depth);
  const best = Math.max(...scored.map((m) => m.score));
  const picks = scored.filter((m) => m.score === best);
  return { col: picks[randInt(rng, picks.length)].col };
}
