// Tic Tac Toe robot: take a win, block a loss, otherwise play a strong square
// (exact minimax on 3×3, a threat heuristic on 5×5), except that now and then
// it plays a random square so it can be beaten.
import { randInt } from "../engine/rng.js";
import { EMPTY, emptyCells, linesFor, winningLine } from "./rules.js";

export const RANDOM_CHANCE = 0.25;

const memo = new Map();

// 3×3 only. Best outcome for `player` to move: a win scores the squares still
// free when it lands (sooner is higher), a loss the negative, a draw 0.
function value(board, player) {
  const key = board.join("") + player;
  if (memo.has(key)) return memo.get(key);
  const free = emptyCells(board);
  let best = free.length ? -Infinity : 0;
  for (const i of free) {
    board[i] = player;
    const s = winningLine(board, 3) ? free.length : -value(board, 1 - player);
    board[i] = EMPTY;
    if (s > best) best = s;
  }
  memo.set(key, best);
  return best;
}

// Minimax score of each free square for `me` on a 3×3 board.
export function scoreMoves(board, me) {
  const b = board.slice();
  const free = emptyCells(b);
  return free.map((cell) => {
    b[cell] = me;
    const score = winningLine(b, 3) ? free.length : -value(b, 1 - me);
    b[cell] = EMPTY;
    return { cell, score };
  });
}

// Squares that would complete a line for `player` right now.
function winningSquares(board, lines, player) {
  const out = new Set();
  for (const line of lines) {
    let mine = 0;
    let gap = -1;
    for (const i of line) {
      if (board[i] === player) mine++;
      else if (board[i] === EMPTY) gap = i;
    }
    if (mine === line.length - 1 && gap >= 0) out.add(gap);
  }
  return out;
}

// 5×5: favour forks, stopping the opponent's forks, and open lines.
function heuristicScores(board, lines, me) {
  const b = board.slice();
  const opp = 1 - me;
  return emptyCells(b).map((cell) => {
    let score = 0;
    b[cell] = me;
    if (winningSquares(b, lines, me).size >= 2) score += 1000;
    b[cell] = opp;
    if (winningSquares(b, lines, opp).size >= 2) score += 500;
    b[cell] = EMPTY;
    for (const line of lines) {
      if (!line.includes(cell)) continue;
      let mine = 0;
      let theirs = 0;
      for (const i of line) {
        if (b[i] === me) mine++;
        else if (b[i] === opp) theirs++;
      }
      if (!theirs) score += 4 ** mine;
      if (!mine) score += 3 ** theirs;
    }
    return { cell, score };
  });
}

export function chooseMove(state, me, rng = Math.random, { randomChance = RANDOM_CHANCE } = {}) {
  const { board, size } = state;
  const lines = linesFor(size, state.k);
  const free = emptyCells(board);
  const [win] = winningSquares(board, lines, me);
  if (win !== undefined) return { cell: win };
  const [block] = winningSquares(board, lines, 1 - me);
  if (block !== undefined) return { cell: block };
  if (rng() < randomChance) return { cell: free[randInt(rng, free.length)] };
  const scored = size === 3 ? scoreMoves(board, me) : heuristicScores(board, lines, me);
  const best = Math.max(...scored.map((m) => m.score));
  const picks = scored.filter((m) => m.score === best);
  return { cell: picks[randInt(rng, picks.length)].cell };
}
