// Backgammon robot: list every legal play for the roll and score the
// position it leaves (pips, made points, primes, blots the opponent can hit,
// checkers on the bar and borne off). It always takes a win, and hits when the
// opponent could otherwise finish next turn. The level sets how much it sees
// and how often it plays a random move instead; in a race, where nothing can
// be hit, every level plays its best move.
import { randInt } from "../engine/rng.js";
import { BAR, OFF, CHECKERS, legalPlays, pipCount } from "./rules.js";

export const LEVEL = {
  easy: { randomChance: 0.3, sight: "direct" }, // counts direct shots one blot at a time
  medium: { randomChance: 0.08, sight: "direct" },
  hard: { randomChance: 0, sight: "exact" }, // counts every roll that hits a blot
};

// Value of holding a point (two or more checkers), by your own point number.
const POINT = [0, 0.5, 1, 2, 3.5, 5, 4.5, 4, 2.5, 1.5, 1, 0.5, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 1.5, 3.5, 3, 2, 1.5, 1];
// Rolls out of 36 that hit a blot this far away, with nothing blocking.
const DIRECT = [0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1];
const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push({ a, b, weight: a === b ? 1 : 2 });

// Opponent checkers as distances along your points: their point m is your 25 − m (bar = 0).
function attackers(pos, p) {
  const opp = pos[1 - p];
  const out = [];
  for (let m = BAR; m >= 1; m--) if (opp[m]) out.push(25 - m);
  return out;
}

// Pips you lose when a blot on your point n is hit, plus the trouble of re-entering.
const hitLoss = (n, theirHome) => 25 - n + 4 + 2 * theirHome;

const madeOwn = (side, n) => side[n] >= 2;

// Expected pips lost to the opponent's next roll, exactly over all 36 rolls.
function exactRisk(pos, p, blots, theirHome) {
  const side = pos[p];
  const from = attackers(pos, p);
  const onBar = pos[1 - p][BAR];
  let total = 0;
  for (const { a, b, weight } of ROLLS) {
    let worst = 0;
    for (const n of blots) {
      if (hitLoss(n, theirHome) <= worst) continue;
      let hit = false;
      if (onBar) {
        // Checkers on the bar enter first; count only hits made while entering.
        hit = n === a || n === b || (a === b && onBar === 1 && n % a === 0 && n / a <= 4 && !blockedPath(side, 0, a, n / a));
      } else {
        for (const x of from) {
          if (x >= n) continue;
          const d = n - x;
          if (a === b) {
            hit = d % a === 0 && d / a <= 4 && !blockedPath(side, x, a, d / a);
          } else {
            hit = d === a || d === b || (d === a + b && (!madeOwn(side, x + a) || !madeOwn(side, x + b)));
          }
          if (hit) break;
        }
      }
      if (hit) worst = hitLoss(n, theirHome);
    }
    total += worst * weight;
  }
  return total / 36;
}

// True when one of the first k − 1 stops of a run of k steps lands on a point you hold.
function blockedPath(side, x, step, k) {
  for (let j = 1; j < k; j++) if (madeOwn(side, x + step * j)) return true;
  return false;
}

// Cheaper and rougher: each blot alone, direct shots only, nothing blocks.
function directRisk(pos, p, blots, theirHome) {
  const from = attackers(pos, p);
  let total = 0;
  for (const n of blots) {
    const near = from.filter((x) => x < n).map((x) => n - x);
    const shots = Math.min(36, near.reduce((s, d) => s + (DIRECT[d] || 0), 0));
    total += (shots / 36) * hitLoss(n, theirHome);
  }
  return total;
}

// True while some checker of yours still has to pass one of theirs.
export function inContact(pos, p) {
  let mine = 0;
  let theirsTop = 0;
  for (let n = BAR; n >= 1 && !mine; n--) if (pos[p][n]) mine = n;
  for (let n = BAR; n >= 1 && !theirsTop; n--) if (pos[1 - p][n]) theirsTop = n;
  return mine + theirsTop > 25;
}

// Score of a position for p, just after p's play (in pips, higher is better).
export function evaluate(pos, p, sight = "exact") {
  const side = pos[p];
  const opp = pos[1 - p];
  if (side[OFF] === CHECKERS) return 1e6;
  let score = pipCount(opp) - pipCount(side) + 2 * side[OFF] - 2 * opp[OFF];
  if (!inContact(pos, p)) {
    // A race: bear off and keep moving; spread checkers to avoid wasted pips.
    for (let n = 1; n <= 6; n++) if (side[n] > 3) score -= (side[n] - 3) * 0.3;
    return score + side[OFF] * 1.5;
  }
  let myHome = 0;
  let theirHome = 0;
  for (let n = 1; n <= 6; n++) {
    if (side[n] >= 2) myHome++;
    if (opp[n] >= 2) theirHome++;
  }
  const blots = [];
  let run = 0;
  for (let n = 1; n <= 24; n++) {
    if (side[n] >= 2) {
      score += POINT[n];
      if (side[n] > 3) score -= (side[n] - 3) * 0.4;
      run++;
      if (n <= 12 && run >= 3) score += 2 * (run - 2);
    } else {
      run = 0;
      if (side[n] === 1) blots.push(n);
    }
  }
  score += opp[BAR] * (2 + 1.5 * myHome);
  score -= side[BAR] * (2 + 1.5 * theirHome);
  score -= sight === "exact" ? exactRisk(pos, p, blots, theirHome) : directRisk(pos, p, blots, theirHome);
  return score;
}

// True when the opponent might bear off all their checkers on their next roll.
function couldFinish(pos, opp) {
  const side = pos[opp];
  if (side[BAR] || CHECKERS - side[OFF] > 4) return false;
  for (let n = 7; n <= 24; n++) if (side[n]) return false;
  return true;
}

// A move for player `me`: roll when it's time, else a play { steps }.
export function chooseMove(state, me, rng = Math.random, { level = "medium", randomChance } = {}) {
  if (!state.rolled) return { type: "roll" };
  const { randomChance: chance, sight } = LEVEL[level] || LEVEL.medium;
  const plays = legalPlays(state.pos, me, state.dice);
  const win = plays.find((pl) => pl.pos[me][OFF] === CHECKERS);
  if (win) return { type: "play", steps: win.steps };
  let pool = plays;
  if (couldFinish(state.pos, 1 - me)) {
    const hits = plays.filter((pl) => pl.pos[1 - me][BAR] > state.pos[1 - me][BAR]);
    if (hits.length) pool = hits;
  }
  const race = !inContact(state.pos, me);
  if (pool === plays && !race && rng() < (randomChance ?? chance)) return { type: "play", steps: pool[randInt(rng, pool.length)].steps };
  let best = -Infinity;
  let picks = [];
  for (const pl of pool) {
    const s = evaluate(pl.pos, me, sight);
    if (s > best + 1e-9) {
      best = s;
      picks = [pl];
    } else if (s > best - 1e-9) picks.push(pl);
  }
  return { type: "play", steps: picks[randInt(rng, picks.length)].steps };
}

