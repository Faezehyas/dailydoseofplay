// Gomoku robot: take a win, block a loss, otherwise score every point near the
// stones by the shapes it makes for itself and stops for the opponent (fours,
// threes and twos, open or closed). Now and then it plays a random point next
// to the stones instead, so it can be beaten.
import { randInt } from "../engine/rng.js";
import { DIRECTIONS, EMPTY, SIZE } from "./rules.js";

export const RANDOM_CHANCE = 0.12;

// What one more stone makes along a single line, weakest first. "Open" means
// two ways to go up a step: an open four has two winning points.
export const SHAPE = { NONE: 0, ONE: 1, TWO: 2, OPEN_TWO: 3, THREE: 4, OPEN_THREE: 5, FOUR: 6, OPEN_FOUR: 7, FIVE: 8 };

// A line is the 4 points on each side of the new stone, each empty (0), the
// player's own (1), or blocked by the opponent or the edge (2): 3^8 patterns.
const OFFSETS = [-4, -3, -2, -1, 1, 2, 3, 4];
const POW = [1, 3, 9, 27, 81, 243, 729, 2187];
const digit = (key, j) => Math.floor(key / POW[j]) % 3;
const TABLE = new Uint8Array(3 ** 8).fill(255);

function shapeOfKey(key) {
  if (TABLE[key] !== 255) return TABLE[key];
  let run = 1;
  for (let j = 3; j >= 0 && digit(key, j) === 1; j--) run++;
  for (let j = 4; j < 8 && digit(key, j) === 1; j++) run++;
  let shape = SHAPE.NONE;
  if (run >= 5) shape = SHAPE.FIVE;
  else {
    let fives = 0;
    let best = SHAPE.NONE;
    for (let j = 0; j < 8; j++) {
      if (digit(key, j) !== 0) continue;
      const s = shapeOfKey(key + POW[j]);
      if (s === SHAPE.FIVE) fives++;
      else if (s > best) best = s;
    }
    if (fives >= 2) shape = SHAPE.OPEN_FOUR;
    else if (fives === 1) shape = SHAPE.FOUR;
    else shape = { [SHAPE.OPEN_FOUR]: SHAPE.OPEN_THREE, [SHAPE.FOUR]: SHAPE.THREE, [SHAPE.OPEN_THREE]: SHAPE.OPEN_TWO, [SHAPE.THREE]: SHAPE.TWO, [SHAPE.OPEN_TWO]: SHAPE.ONE, [SHAPE.TWO]: SHAPE.ONE }[best] ?? SHAPE.NONE;
  }
  TABLE[key] = shape;
  return shape;
}
for (let key = 0; key < TABLE.length; key++) shapeOfKey(key);

// The shape a `player` stone on the empty `cell` makes in each direction.
export function shapesAt(board, cell, player, size = SIZE) {
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  return DIRECTIONS.map(([dr, dc]) => {
    let key = 0;
    for (let j = 0; j < 8; j++) {
      const r = r0 + dr * OFFSETS[j];
      const c = c0 + dc * OFFSETS[j];
      const v = r < 0 || r >= size || c < 0 || c >= size ? -2 : board[r * size + c];
      key += (v === EMPTY ? 0 : v === player ? 1 : 2) * POW[j];
    }
    return TABLE[key];
  });
}

const ATTACK = [0, 1, 8, 30, 60, 800, 1000, 100_000, 10_000_000];
const DEFEND = [0, 1, 6, 25, 40, 600, 700, 50_000, 1_000_000];

// A point's worth for the player whose stone it would be: its shapes plus
// a bonus for a double threat (two fours, a four and an open three, or two open threes).
function worth(shapes, table, sure, fork) {
  let score = 0;
  let fours = 0;
  let threes = 0;
  for (const s of shapes) {
    score += table[s];
    if (s === SHAPE.FOUR || s === SHAPE.OPEN_FOUR) fours++;
    else if (s === SHAPE.OPEN_THREE) threes++;
  }
  if (fours >= 2 || (fours && threes)) score += sure;
  else if (threes >= 2) score += fork;
  return score;
}

// Empty points within two of a stone (the centre on an empty board).
export function candidates(board, size = SIZE, reach = 2) {
  const out = [];
  for (let cell = 0; cell < board.length; cell++) {
    if (board[cell] !== EMPTY) continue;
    const r0 = Math.floor(cell / size);
    const c0 = cell % size;
    let near = false;
    for (let r = Math.max(0, r0 - reach); r <= Math.min(size - 1, r0 + reach) && !near; r++) {
      for (let c = Math.max(0, c0 - reach); c <= Math.min(size - 1, c0 + reach); c++) {
        if (board[r * size + c] !== EMPTY) {
          near = true;
          break;
        }
      }
    }
    if (near) out.push(cell);
  }
  if (!out.length && board[(board.length - 1) / 2] === EMPTY) out.push((board.length - 1) / 2);
  return out;
}

// Every candidate point with its score for `me` (attack plus defence).
export function scoreMoves(board, me, size = SIZE) {
  return candidates(board, size).map((cell) => {
    const mine = shapesAt(board, cell, me, size);
    const theirs = shapesAt(board, cell, 1 - me, size);
    return {
      cell,
      mine,
      theirs,
      score: worth(mine, ATTACK, 100_000, 10_000) + worth(theirs, DEFEND, 40_000, 8_000),
    };
  });
}

const best = (list, rng) => {
  const top = Math.max(...list.map((m) => m.score));
  const picks = list.filter((m) => m.score === top);
  return picks[randInt(rng, picks.length)];
};

export function chooseMove(state, me, rng = Math.random, { randomChance = RANDOM_CHANCE } = {}) {
  const { board, size } = state;
  const scored = scoreMoves(board, me, size);
  const wins = scored.filter((m) => m.mine.includes(SHAPE.FIVE));
  if (wins.length) return { cell: best(wins, rng).cell };
  const blocks = scored.filter((m) => m.theirs.includes(SHAPE.FIVE));
  if (blocks.length) return { cell: best(blocks, rng).cell };
  if (rng() < randomChance) {
    const near = candidates(board, size, 1);
    return { cell: near[randInt(rng, near.length)] };
  }
  return { cell: best(scored, rng).cell };
}
