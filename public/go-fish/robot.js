// Go Fish robots: the public state, the log and their own face() only. Only
// the ask is chosen (Easy at random, Medium asks back, Hard weighs everything
// public); the rest is forcedMove(). See "Go Fish in depth" in ARCHITECTURE.md.
import { startPacedRobot } from "../engine/cards/paced-robot.js";
import { forcedMove, askable, ranksIn, rankOf, RANKS } from "./rules.js";

const pickOne = (rng, list) => list[Math.floor(rng() * list.length)];

// has[q][r]: r cards q has shown; lacks[q][r]: cards q drew since a "Go fish" to r (-1: none).
export function knowledge(state, face) {
  const n = state.players;
  const has = Array.from({ length: n }, () => Array(RANKS).fill(0));
  const lacks = Array.from({ length: n }, () => Array(RANKS).fill(-1));
  const booked = Array(RANKS).fill(0); // cards of each rank in books
  for (const e of state.log) {
    if (e.t === "ask") {
      has[e.p][e.rank] = Math.max(has[e.p][e.rank], 1);
      lacks[e.p][e.rank] = -1;
    } else if (e.t === "give") {
      has[e.to][e.rank] += e.n;
      has[e.p][e.rank] = 0;
      lacks[e.p][e.rank] = 0;
      lacks[e.to][e.rank] = -1;
    } else if (e.t === "fish") {
      has[e.p][e.rank] = 0;
      lacks[e.p][e.rank] = 0;
    } else if (e.t === "draw") {
      for (let r = 0; r < RANKS; r++) if (lacks[e.p][r] >= 0) lacks[e.p][r]++;
    } else if (e.t === "lucky") has[e.p][e.rank]++;
    else if (e.t === "book") {
      // A pair leaves the rank's other two in play: only all four booked clears everyone.
      booked[e.rank] += state.bookSize;
      has[e.p][e.rank] = Math.max(0, has[e.p][e.rank] - state.bookSize);
      if (booked[e.rank] === 4) {
        for (let q = 0; q < n; q++) {
          has[q][e.rank] = 0;
          lacks[q][e.rank] = -1;
        }
      }
    }
  }
  // What I have shown so far, before my own cards count: asking for anything else shows it.
  const shown = has.map((row) => row.map((n) => n > 0));
  // Open cards in a hand are known exactly.
  state.hands.forEach((hand, q) => {
    const open = Array(RANKS).fill(0);
    for (const slot of hand) if (face(slot) !== null) open[rankOf(face(slot))]++;
    for (let r = 0; r < RANKS; r++) has[q][r] = Math.min(Math.max(has[q][r], open[r]), hand.length);
  });
  return { has, lacks, shown };
}

// Asks back whoever recently asked for a rank I hold; else at random, avoiding fresh "Go fish" answers.
function mediumAsk(state, me, rng, face) {
  const mine = ranksIn(state.hands[me], face);
  const recent = state.log.slice(-12);
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (e.t !== "ask" || e.p === me || !mine.includes(e.rank) || !state.hands[e.p].length) continue;
    const later = recent.slice(i + 1);
    if (later.some((x) => (x.t === "give" && x.p === e.p && x.rank === e.rank) || (x.t === "book" && x.p === e.p && x.rank === e.rank))) continue;
    return { ask: e.rank, from: e.p };
  }
  const fished = (q, r) => recent.some((x) => x.t === "fish" && x.p === q && x.rank === r);
  const options = askable(state, me).flatMap((q) => mine.filter((r) => !fished(q, r)).map((r) => ({ ask: r, from: q })));
  return options.length ? pickOne(rng, options) : null;
}

function hardAsk(state, me, rng, face) {
  const { has, lacks, shown: told } = knowledge(state, face);
  const hand = state.hands[me];
  const count = Array(RANKS).fill(0);
  for (const slot of hand) count[rankOf(face(slot))]++;
  const others = askable(state, me);
  // Cards nobody can account for: every other hand's cards beyond what it has shown, and the stock.
  const hidden = (q) => Math.max(0, state.hands[q].length - has[q].reduce((a, b) => a + b, 0));
  let best = null;
  for (const r of ranksIn(hand, face)) {
    const shown = state.hands.reduce((a, _, q) => a + (q === me ? 0 : has[q][r]), 0);
    const inBooks = state.books.flat().filter((b) => b.rank === r).length * state.bookSize;
    const unseen = Math.max(0, 4 - inBooks - count[r] - shown);
    const unknown = state.stock.length + others.reduce((a, q) => a + hidden(q), 0);
    const pool = state.stock.length + others.reduce((a, q) => a + (lacks[q][r] >= 0 || has[q][r] ? 0 : hidden(q)), 0);
    // Asking shows I hold r: worth little if I already showed it, a risk if the ask fails.
    const known = told[me][r];
    const value = state.bookSize === 2 ? 1 : count[r] === 3 ? 2 : count[r] === 2 ? 1.4 : 1;
    for (const q of others) {
      let p;
      if (has[q][r] > 0) p = 0.97;
      // Each card drawn since a "Go fish" may have been one.
      else if (lacks[q][r] >= 0) p = unknown ? 1 - Math.pow(Math.max(0, 1 - unseen / unknown), lacks[q][r]) : 0;
      else p = pool ? 1 - Math.pow(Math.max(0, 1 - hidden(q) / pool), unseen) : 0;
      const score = p * value - (known ? 0 : (1 - p) * 0.05) + rng() * 0.01;
      if (!best || score > best.score) best = { score, move: { ask: r, from: q } };
    }
  }
  return best.move;
}

// The ask for `me`: level "easy", "medium" or "hard".
export function chooseAsk(state, me, rng, face, level = "easy") {
  if (level === "hard") return hardAsk(state, me, rng, face);
  if (level === "medium") {
    const move = mediumAsk(state, me, rng, face);
    if (move) return move;
  }
  return { ask: pickOne(rng, ranksIn(state.hands[me], face)), from: pickOne(rng, askable(state, me)) };
}

// Returns a legal move for `me`: the forced one, else an ask.
export function chooseMove(state, me, rng, face, { level = "easy" } = {}) {
  return forcedMove(state, me, face) ?? chooseAsk(state, me, rng, face, level);
}

// The move the timer makes for you, and a robot's when its own is refused: a sensible ask.
export function timeoutMove(state, me, face) {
  return forcedMove(state, me, face) ?? hardAsk(state, me, () => 0, face);
}

// A robot seat that pauses as the view asks: delay() returns ms, or -1 to wait for the screen.
export function startRobot(session, { rules, choose, delay, rng = Math.random }) {
  return startPacedRobot(session, { rules, choose, delay, rng, key: (st) => `${st.moves}`, fallback: timeoutMove });
}
