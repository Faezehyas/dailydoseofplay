// Tic Tac Toe robot: take a win, block a loss, otherwise play a minimax-best
// square, except that now and then it plays a random square so it can be beaten.
import { randInt } from "../engine/rng.js";
import { EMPTY, emptyCells, winningLine } from "./rules.js";

export const RANDOM_CHANCE = 0.25;

const memo = new Map();

// Best outcome for `player` to move: a win scores the squares still free
// when it lands (sooner is higher), a loss the negative, a draw 0.
function value(board, player) {
  const key = board.join("") + player;
  if (memo.has(key)) return memo.get(key);
  const free = emptyCells(board);
  let best = free.length ? -Infinity : 0;
  for (const i of free) {
    board[i] = player;
    const s = winningLine(board) ? free.length : -value(board, 1 - player);
    board[i] = EMPTY;
    if (s > best) best = s;
  }
  memo.set(key, best);
  return best;
}

function completes(board, cell, player) {
  board[cell] = player;
  const won = winningLine(board) !== null;
  board[cell] = EMPTY;
  return won;
}

// Minimax score of each free square for `me`.
export function scoreMoves(board, me) {
  const b = board.slice();
  const free = emptyCells(b);
  return free.map((cell) => {
    b[cell] = me;
    const score = winningLine(b) ? free.length : -value(b, 1 - me);
    b[cell] = EMPTY;
    return { cell, score };
  });
}

export function chooseMove(state, me, rng = Math.random, { randomChance = RANDOM_CHANCE } = {}) {
  const board = state.board.slice();
  const free = emptyCells(board);
  const win = free.find((i) => completes(board, i, me));
  if (win !== undefined) return { cell: win };
  const block = free.find((i) => completes(board, i, 1 - me));
  if (block !== undefined) return { cell: block };
  if (rng() < randomChance) return { cell: free[randInt(rng, free.length)] };
  const scored = scoreMoves(board, me);
  const best = Math.max(...scored.map((m) => m.score));
  const picks = scored.filter((m) => m.score === best);
  return { cell: picks[randInt(rng, picks.length)].cell };
}
