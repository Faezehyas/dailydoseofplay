// Rummy melds over the standard deck (faces.js): sets (three or four of a
// rank) and runs (three or more in a row in one suit, aces low, so Q-K-A is
// not a run). Finds the arrangement of a hand that leaves the least deadwood,
// and the best lay-offs onto someone else's melds. Pure and exhaustive: it
// tries every arrangement, remembered by which cards are left, so a hand of
// 11 takes well under a millisecond. Faces in, faces out.
import { rankOf, suitOf } from "./faces.js";

// Deadwood points: aces 1, court cards 10, the rest their number.
export const cardPoints = (face) => Math.min(rankOf(face) + 1, 10);

const byRank = (a, b) => rankOf(a) - rankOf(b) || suitOf(a) - suitOf(b);
const sum = (faces, points) => faces.reduce((n, f) => n + points(f), 0);

export function isSet(faces) {
  return faces.length >= 3 && faces.length <= 4 && new Set(faces).size === faces.length && faces.every((f) => rankOf(f) === rankOf(faces[0]));
}

export function isRun(faces) {
  if (faces.length < 3 || faces.some((f) => suitOf(f) !== suitOf(faces[0]))) return false;
  const ranks = faces.map(rankOf).sort((a, b) => a - b);
  return ranks.every((r, i) => !i || r === ranks[i - 1] + 1);
}

export const isMeld = (faces) => isSet(faces) || isRun(faces);

// A meld in its usual order: a run low to high, a set by suit.
export const sortMeld = (faces) => faces.slice().sort(byRank);

// Every meld that can be made from `faces` (each as a list of faces): a rank's
// sets of three and four, and every stretch of three or more of a run.
export function meldsIn(faces) {
  const melds = [];
  const ranks = new Map();
  for (const f of faces) ranks.set(rankOf(f), [...(ranks.get(rankOf(f)) ?? []), f]);
  for (const group of ranks.values()) {
    if (group.length < 3) continue;
    const g = group.slice().sort((a, b) => a - b);
    if (g.length === 4) melds.push(g, ...g.map((_, skip) => g.filter((__, i) => i !== skip)));
    else melds.push(g);
  }
  for (let s = 0; s < 4; s++) {
    const has = new Set(faces.filter((f) => suitOf(f) === s).map(rankOf));
    for (let lo = 0; lo < 13; lo++) {
      if (!has.has(lo) || has.has(lo - 1)) continue;
      let hi = lo;
      while (has.has(hi + 1)) hi++;
      for (let a = lo; a <= hi - 2; a++) for (let b = a + 2; b <= hi; b++) melds.push(Array.from({ length: b - a + 1 }, (_, k) => s * 13 + a + k));
    }
  }
  return melds;
}

// The candidate melds as bit masks over `faces`' indices, grouped by their lowest index.
function masks(faces) {
  const at = new Map(faces.map((f, i) => [f, i]));
  const byLow = faces.map(() => []);
  for (const meld of meldsIn(faces)) {
    let mask = 0;
    let low = faces.length;
    for (const f of meld) {
      mask |= 1 << at.get(f);
      low = Math.min(low, at.get(f));
    }
    byLow[low].push(mask);
  }
  return byLow;
}

const lowestBit = (mask) => 31 - Math.clz32(mask & -mask);
const facesOf = (faces, mask) => faces.filter((_, i) => mask & (1 << i));

// The arrangement of `faces` (up to 30 cards) with the least deadwood:
// { melds: [[faces]], deadwood: [faces], points }.
export function bestMelds(faces, { points = cardPoints } = {}) {
  if (faces.length > 30) throw new RangeError("too many cards");
  faces = faces.slice().sort((a, b) => a - b); // ties settle the same way whatever the order given
  const byLow = masks(faces);
  const memo = new Map();
  function best(mask) {
    if (!mask) return { points: 0, melds: [] };
    if (memo.has(mask)) return memo.get(mask);
    const i = lowestBit(mask);
    const rest = best(mask & ~(1 << i));
    let out = { points: rest.points + points(faces[i]), melds: rest.melds };
    for (const m of byLow[i]) {
      if ((m & mask) !== m) continue;
      const r = best(mask & ~m);
      // Equal deadwood: fewer, longer melds (3-10♣ as one run, not two).
      if (r.points < out.points || (r.points === out.points && r.melds.length + 1 < out.melds.length)) out = { points: r.points, melds: [m, ...r.melds] };
    }
    memo.set(mask, out);
    return out;
  }
  const all = faces.length ? 2 ** faces.length - 1 : 0;
  const { points: dead, melds } = best(all);
  const used = melds.reduce((a, m) => a | m, 0);
  return { melds: melds.map((m) => sortMeld(facesOf(faces, m))).sort((a, b) => byRank(a[0], b[0])), deadwood: facesOf(faces, all & ~used).sort(byRank), points: dead };
}

// Where `face` goes on `meld` (any order): "set", "low" or "high" (a run's ends), else null.
export function fits(face, meld) {
  if (meld.includes(face)) return null;
  if (isSet(meld)) return meld.length < 4 && rankOf(face) === rankOf(meld[0]) ? "set" : null;
  if (!isRun(meld) || suitOf(face) !== suitOf(meld[0])) return null;
  const ranks = meld.map(rankOf);
  if (rankOf(face) === Math.min(...ranks) - 1) return "low";
  if (rankOf(face) === Math.max(...ranks) + 1) return "high";
  return null;
}

// The most deadwood `cards` can lay off onto `melds`, one at a time, so a run grows to take the next:
// { layoffs: [[face, meld index]] in order, points laid off }.
export function bestLayoffs(cards, melds, { points = cardPoints } = {}) {
  const memo = new Map();
  function go(left, now) {
    if (!left.length) return { points: 0, layoffs: [] };
    const key = `${left.join(",")}|${now.map((m) => m.length + ":" + Math.min(...m)).join(";")}`;
    if (memo.has(key)) return memo.get(key);
    let out = { points: 0, layoffs: [] };
    for (const f of left) {
      for (const [j, meld] of now.entries()) {
        if (!fits(f, meld)) continue;
        const r = go(left.filter((x) => x !== f), now.map((m, k) => (k === j ? [...m, f] : m)));
        if (r.points + points(f) > out.points) out = { points: r.points + points(f), layoffs: [[f, j], ...r.layoffs] };
      }
    }
    memo.set(key, out);
    return out;
  }
  return go(cards.slice().sort(byRank), melds.map((m) => m.slice()));
}

// A knock's best answer: own melds and lay-offs onto `theirMelds` that leave the least (none after gin:
// `layoff: false`), trying every arrangement, since one that melds less can lay off more.
export function bestDefence(faces, theirMelds, { points = cardPoints, layoff = true } = {}) {
  if (!layoff || !theirMelds.length) return { ...bestMelds(faces, { points }), layoffs: [] };
  if (faces.length > 30) throw new RangeError("too many cards");
  faces = faces.slice().sort((a, b) => a - b);
  const byLow = masks(faces);
  const all = faces.length ? 2 ** faces.length - 1 : 0;
  const offs = new Map(); // deadwood mask -> its best lay-offs
  // Cards that could ever go on their melds: a set's rank, a run's suit.
  const could = faces.reduce((m, f, i) => (theirMelds.some((x) => (isSet(x) ? x.length < 4 && rankOf(x[0]) === rankOf(f) : suitOf(x[0]) === suitOf(f))) ? m | (1 << i) : m), 0);
  let best = null;
  // Every set of disjoint melds: the lowest card left is deadwood or in one of its melds.
  function pack(mask, used, melds) {
    if (!mask) {
      const dead = all & ~used;
      // Not even laying off every card that could go would beat the best so far.
      if (best && sum(facesOf(faces, dead & ~could), points) > best.points) return;
      if (!offs.has(dead)) offs.set(dead, bestLayoffs(facesOf(faces, dead), theirMelds, { points }));
      const off = offs.get(dead);
      const left = sum(facesOf(faces, dead), points) - off.points;
      // Equal deadwood: lay down your own melds rather than lay off.
      if (!best || left < best.points || (left === best.points && off.layoffs.length < best.off.layoffs.length)) best = { points: left, melds, dead, off };
      return;
    }
    const i = lowestBit(mask);
    pack(mask & ~(1 << i), used, melds);
    for (const m of byLow[i]) if ((m & mask) === m) pack(mask & ~m, used | m, [...melds, m]);
  }
  pack(all, 0, []);
  const laid = new Set(best.off.layoffs.map(([f]) => f));
  return {
    melds: best.melds.map((m) => sortMeld(facesOf(faces, m))).sort((a, b) => byRank(a[0], b[0])),
    layoffs: best.off.layoffs,
    deadwood: facesOf(faces, best.dead).filter((f) => !laid.has(f)).sort(byRank),
    points: best.points,
  };
}
