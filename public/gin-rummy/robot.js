// Gin Rummy robots: the public state, this hand's log and their own face()
// only. They choose whether to take the upcard, which pile to draw from,
// what to discard and when to knock; laying down and the defence are
// forcedMove(). Easy throws its highest deadwood; Medium keeps cards that
// may still meld and doesn't feed what you just took; Hard also counts every
// card that is gone, keeps clear of what you want, and plays on for gin (or
// an undercut) while its deadwood is low. See "Gin Rummy in depth" in
// ARCHITECTURE.md.
import { startPacedRobot } from "../engine/cards/paced-robot.js";
import { rankOf, suitOf } from "../engine/cards/faces.js";
import { bestMelds, isMeld } from "../engine/cards/melds.js";
import { forcedMove, bestKnock, cardPoints } from "./rules.js";

// Two cards that could end up in one meld: a pair, or the same suit within two ranks.
const near = (a, b) => a !== b && (rankOf(a) === rankOf(b) || (suitOf(a) === suitOf(b) && Math.abs(rankOf(a) - rankOf(b)) <= 2));
// Next to it: the same rank, or the same suit one rank away.
const touches = (a, b) => a !== b && (rankOf(a) === rankOf(b) || (suitOf(a) === suitOf(b) && Math.abs(rankOf(a) - rankOf(b)) === 1));

// What `me` knows this hand: the cards it has seen, those out of play (its own and the pile's),
// and what the other player took, passed on or threw.
export function knowledge(state, me, face) {
  const them = 1 - me;
  const seen = new Set();
  const took = [];
  const passed = [];
  const threw = [];
  for (const s of [...state.hands[me], ...state.discard]) seen.add(face(s));
  for (const s of state.hands[them]) if (face(s) !== null) seen.add(face(s));
  const log = state.log.slice(state.since);
  for (const [i, e] of log.entries()) {
    if (e.p !== them) continue;
    if (e.t === "take") took.push(face(e.slot));
    else if (e.t === "discard") threw.push(face(e.slot));
    else if (e.t === "pass") passed.push(face(e.slot));
    // Drawing from the stock passes on the card on top of the pile: my last discard.
    else if (e.t === "draw" && log[i - 1]?.t === "discard" && log[i - 1].p === me) passed.push(face(log[i - 1].slot));
  }
  for (const f of [...took, ...threw, ...passed]) seen.add(f);
  seen.delete(null);
  const gone = new Set([...state.hands[me], ...state.discard].map(face));
  const unseen = [];
  for (let f = 0; f < 52; f++) if (!seen.has(f)) unseen.push(f);
  return { seen, gone, unseen, took, passed, threw, last: took.at(-1) ?? null };
}

// How much throwing `f` may help the other player; nothing if every meld it could make is out of play.
export function danger(f, know) {
  const setGone = [...know.gone].filter((g) => g !== f && rankOf(g) === rankOf(f)).length >= 2;
  const runGone = [-2, -1, 1, 2].every((d) => {
    const r = rankOf(f) + d;
    return r < 0 || r > 12 || know.gone.has(suitOf(f) * 13 + r);
  });
  if (setGone && runGone) return 0;
  let risk = 1;
  for (const t of know.took) if (near(f, t)) risk += touches(f, t) ? 3 : 1.5;
  for (const t of [...know.threw, ...know.passed]) if (touches(f, t)) risk -= 0.6;
  return Math.max(0.2, risk);
}

// The other player's likely deadwood: it falls as the hand goes on, faster when they take from the pile.
function theirDeadwood(state, me, know) {
  const turns = state.log.slice(state.since).filter((e) => e.p !== me && e.t === "discard").length;
  return Math.max(4, 50 - turns * 3.2 - know.took.length * 7);
}

// The deadwood card to throw: the highest, less `keep` per unseen card that would meld it, less `risk(f)`.
function pickDiscard(state, me, rng, face, know, { keep = 0, risk = () => 0 }) {
  const best = bestMelds(state.hands[me].map(face));
  const dead = state.hands[me].filter((s) => s !== state.taken && best.deadwood.includes(face(s)));
  if (!dead.length) return bestKnock(state, me, face).discard;
  const score = (s) => {
    const f = face(s);
    let outs = 0;
    if (keep) for (const u of know.unseen) if (best.deadwood.some((g) => near(f, g) && isMeld([f, g, u]))) outs++;
    return cardPoints(f) - keep * Math.min(outs, 4) - risk(f) + rng() * 0.01;
  };
  return dead.reduce((a, b) => (score(b) > score(a) ? b : a));
}

const LEVELS = {
  easy: {
    discard: (state, me, rng, face) => pickDiscard(state, me, rng, face, null, {}),
    knocks: () => true,
  },
  medium: {
    discard: (state, me, rng, face, know) => pickDiscard(state, me, rng, face, know, { keep: 1.5, risk: (f) => (know.last !== null && near(f, know.last) ? 4 : 0) }),
    knocks: () => true,
  },
  hard: {
    discard(state, me, rng, face, know) {
      const late = 1 + Math.max(0, 20 - state.stock.length) / 10;
      return pickDiscard(state, me, rng, face, know, { keep: 1.5, risk: (f) => 2 * late * danger(f, know) });
    },
    // Gin always; low deadwood early plays on for gin or an undercut; else knock unless an undercut looks likely.
    knocks(state, me, k, know) {
      if (k.points === 0) return true;
      if (k.points <= 6 && state.stock.length >= 14) return false;
      return k.points < theirDeadwood(state, me, know) + (state.stock.length <= 6 ? 4 : 0);
    },
  },
};

// The choice for `me` at a level; null when the move isn't a choice.
export function chooseChoice(state, me, rng, face, level = "easy") {
  if (state.winner !== -1 || state.turn !== me) return null;
  const play = LEVELS[level] ?? LEVELS.easy;
  const know = level === "easy" ? null : knowledge(state, me, face);
  // Every level takes the pile's card only when it completes a meld (tests found nothing better).
  const takes = () => {
    const card = face(state.discard.at(-1));
    return bestMelds([...state.hands[me].map(face), card]).melds.some((m) => m.includes(card));
  };
  if (state.phase === "upcard") return takes() ? { take: true } : { pass: true };
  if (state.phase === "draw") return { draw: takes() ? "pile" : "stock" };
  if (state.phase === "discard") {
    if (state.bigGin && !bestMelds(state.hands[me].map(face)).points) return { knock: true };
    const k = bestKnock(state, me, face);
    if (k && k.points <= state.limit && play.knocks(state, me, k, know)) return { discard: k.discard, knock: true };
    return { discard: play.discard(state, me, rng, face, know) };
  }
  if (state.phase === "result") return { next: true };
  return null;
}

// Returns a legal move for `me`: the forced one, else a choice.
export function chooseMove(state, me, rng, face, { level = "easy" } = {}) {
  return forcedMove(state, me, face) ?? chooseChoice(state, me, rng, face, level);
}

// The move the timer makes for you, and a robot's when its own is refused: what Hard would do.
export function timeoutMove(state, me, face) {
  return chooseMove(state, me, () => 0, face, { level: "hard" });
}

// A robot seat that pauses as the view asks: delay() returns ms, or -1 to wait for the screen.
export function startRobot(session, { rules, choose, delay, rng = Math.random }) {
  return startPacedRobot(session, { rules, choose, delay, rng, key: (st) => `${st.moves}`, fallback: timeoutMove });
}
