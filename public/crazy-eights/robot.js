// Crazy Eights robots. A robot is just another seat: it sees the public
// state and face(slot), the faces its own seat knows (its hand and the open
// cards), never another seat's cards.
//   Easy    a random card that plays.
//   Medium  follows suit before rank, and keeps its 8s for when nothing else plays.
//   Hard    counts the cards shown, keeps its 8s, names the suit it holds most
//           of (weighted by what is left out there), sheds high-penalty cards,
//           and goes after whoever is closest to going out.
// startRobot() drives a seat, asking the view how long to pause each time.
import { matchRouter } from "../engine/session.js";
import { robotPause } from "../engine/robot-pace.js";
import { CardMatch } from "../engine/card-match.js";
import { suitOf, rankOf, points, isEight, canDraw, next, playable, TWO, QUEEN, ACE } from "./rules.js";

const randInt = (rng, n) => Math.floor(rng() * n);
const pickOne = (rng, list) => list[randInt(rng, list.length)];

// The move when nothing plays: draw if you may, else pass.
export function fallback(state) {
  return canDraw(state) ? { draw: true } : { pass: true };
}

function suitCounts(faces) {
  const n = [0, 0, 0, 0];
  for (const f of faces) if (!isEight(f)) n[suitOf(f)]++;
  return n;
}

// The suit the rest of the hand holds most of (ties at random).
function favouriteSuit(rng, faces) {
  const n = suitCounts(faces);
  const best = Math.max(...n);
  return pickOne(rng, [0, 1, 2, 3].filter((s) => n[s] === best));
}

// The suit each opponent probably lacks: the one they last drew or passed on (strict rule only).
function shortSuits(state) {
  const short = state.hands.map(() => -1);
  if (!state.strict) return short;
  for (const h of state.history) {
    if (h.t === "draw" || (h.t === "pass" && !h.afterDraw)) short[h.p] = h.suit;
    else if (h.t === "take" || (h.t === "pass" && h.afterDraw)) short[h.p] = -1;
  }
  return short;
}

// Of each suit, the cards that could be anywhere else: not in my hand, on the pile or shown in a hand.
function unknownCounts(state, me, face) {
  const unknown = [13, 13, 13, 13];
  const seen = state.hands[me].map(face);
  for (const slot of state.discard) seen.push(face(slot));
  state.hands.forEach((h, p) => p !== me && h.forEach((slot) => seen.push(face(slot))));
  for (const f of seen) if (f !== null) unknown[suitOf(f)]--;
  return unknown;
}

// A whole round of nothing but 8s: naming another suit the next player lacks could go on for ever.
const eightsOnly = (state) => {
  const last = state.history.filter((h) => h.t === "play").slice(-state.players);
  return last.length === state.players && last.every((h) => isEight(h.face));
};

// The suit to name after an 8 in that case: the one the next player most likely holds.
function breakingSuit(state, me, face) {
  const unknown = unknownCounts(state, me, face);
  const short = shortSuits(state)[next(state, me)];
  const score = unknown.map((n, s) => n - (s === short ? 100 : 0));
  return score.indexOf(Math.max(...score));
}

function hardMove(state, me, rng, face, plays) {
  const hand = state.hands[me];
  const mine = hand.map(face);
  const unknown = unknownCounts(state, me, face);
  const short = shortSuits(state);
  const size = (p) => state.hands[p].length;
  const after = next(state, me);
  // How close a player is to going out: 0 when far, up to 5 on their last card.
  const danger = (p) => Math.max(0, 6 - size(p));
  const leader = state.hands.map((_, p) => p).filter((p) => p !== me).sort((a, b) => size(a) - size(b))[0];

  // How good a suit is to leave on the pile: I can follow it, others can't.
  function suitValue(s, rest) {
    const n = suitCounts(rest)[s];
    let v = n * 3 + (1 - unknown[s] / 13) * 4;
    if (short[after] === s) v += 10 + danger(after) * 1.5;
    if (leader !== after && short[leader] === s) v += danger(leader);
    return v;
  }

  let best = null;
  for (const slot of plays) {
    const f = face(slot);
    const rest = hand.filter((x) => x !== slot).map(face);
    if (!rest.length) return { play: slot, ...(isEight(f) ? { suit: favouriteSuit(rng, mine) } : {}) };
    let score;
    let suit;
    if (isEight(f)) {
      // Kept back unless nothing else plays, or the hand is nearly gone.
      const values = [0, 1, 2, 3].map((s) => suitValue(s, rest));
      suit = values.indexOf(Math.max(...values));
      score = values[suit] - (rest.length > 2 ? 40 : 0);
    } else {
      score = suitValue(suitOf(f), rest) + points(f) * 0.5;
      // A card that matches by rank also lets me follow the new suit with what's left.
      score += rest.filter((r) => !isEight(r) && rankOf(r) === rankOf(f)).length * 1.5;
      if (state.actions) {
        const r = rankOf(f);
        if (r === TWO) score += 4 + danger(after) * 3;
        if (r === QUEEN) score += 2 + danger(after) * 2.5;
        if (r === ACE && state.players > 2) score += (danger(after) - danger((me - state.dir + state.players) % state.players)) * 2.5;
        if (r === ACE && state.players === 2) score += 2 + danger(after) * 2.5;
      }
    }
    score += rng() * 0.5;
    if (!best || score > best.score) best = { score, move: { play: slot, ...(suit !== undefined ? { suit } : {}) } };
  }
  return best.move;
}

// Returns a legal move for `me`. level: "easy", "medium" or "hard".
export function chooseMove(state, me, rng, face, { level = "easy" } = {}) {
  const move = pickMove(state, me, rng, face, level);
  if (Number.isInteger(move.suit) && eightsOnly(state)) move.suit = breakingSuit(state, me, face);
  return move;
}

function pickMove(state, me, rng, face, level) {
  const plays = playable(state, me, face);
  if (!plays.length) return fallback(state);
  const hand = state.hands[me];
  const restOf = (slot) => hand.filter((x) => x !== slot).map(face);
  if (level === "hard") return hardMove(state, me, rng, face, plays);
  let choice;
  if (level === "medium") {
    const others = plays.filter((slot) => !isEight(face(slot)));
    const sameSuit = others.filter((slot) => suitOf(face(slot)) === state.suit);
    choice = pickOne(rng, sameSuit.length ? sameSuit : others.length ? others : plays);
    if (isEight(face(choice))) return { play: choice, suit: favouriteSuit(rng, restOf(choice)) };
    return { play: choice };
  }
  choice = pickOne(rng, plays);
  if (!isEight(face(choice))) return { play: choice };
  const held = [...new Set(restOf(choice).filter((f) => !isEight(f)).map(suitOf))];
  return { play: choice, suit: held.length ? pickOne(rng, held) : randInt(rng, 4) };
}

// The move the timer makes for you: the first card that plays, else draw or pass.
export function timeoutMove(state, me, face) {
  const [first] = playable(state, me, face);
  if (first === undefined) return fallback(state);
  if (!isEight(face(first))) return { play: first };
  const n = suitCounts(state.hands[me].filter((x) => x !== first).map(face));
  return { play: first, suit: n.indexOf(Math.max(...n)) };
}

// startCardRobot() with a pause asked for each move: delay() returns ms, or -1 to wait for the screen.
export function startRobot(session, { rules, choose, delay, rng = Math.random }) {
  const router = matchRouter(session);
  let match = null;
  let timer = null;
  let destroyed = false;
  let waiting = false; // for the screen, rather than thinking
  let planned = null; // the move chosen for this turn, kept while waiting
  let refused = ""; // a turn whose chosen move was refused: play the timer's move instead
  function schedule() {
    if (destroyed || timer || !match.canMove()) return;
    const face = (slot) => match.face(slot);
    const key = `${match.m}:${match.state.moves}:${match.state.drew}`;
    if (planned?.key !== key) planned = { key, move: refused === key ? timeoutMove(match.state, match.me, face) : choose(match.state, match.me, rng, face) };
    const ms = delay(match.state, match.me, planned.move, face);
    waiting = ms < 0;
    timer = setTimeout(() => {
      timer = null;
      if (destroyed || !match.canMove()) return;
      if (waiting) return schedule();
      const { move } = planned;
      planned = null;
      match.play(move);
    }, robotPause(waiting ? 40 : ms));
  }
  function newMatch(m) {
    match = new CardMatch({ send: (msg) => session.send(msg), me: session.index, players: session.players.length, rules, m });
    match.on("update", schedule);
    match.on("invalid", () => {
      refused = `${match.m}:${match.state.moves}:${match.state.drew}`;
      planned = null;
    });
    router.start(match);
  }
  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    // The screen has caught up: stop waiting for it now rather than at the next check.
    poke() {
      if (!timer || !waiting) return;
      clearTimeout(timer);
      timer = null;
      schedule();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
