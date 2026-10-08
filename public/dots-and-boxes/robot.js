// Dots and Boxes robot. chooseMove(state, me, rng, { level }) returns a
// legal { line }.
//
// - Easy: usually takes a box it is offered, otherwise draws any line, and
//   only sometimes looks for a line that gives nothing away.
// - Medium: takes every box, never draws a box's third side while it has a
//   safe line, and when it must, hands over the fewest boxes it can.
// - Hard: plays the endgame properly. Once no safe line is left, the board
//   is a set of chains and loops; it works out exactly which to open (two-box
//   chains opened in the middle, so they can't be declined) and, when the
//   opponent opens one, whether to take it all or take all but two (all but
//   four in a loop) and keep control with the double-cross. While safe lines
//   remain and few enough are left, it searches them to the end to win that
//   fight over the long chains.
import { TurnMatch } from "../engine/turn-match.js";
import { matchRouter } from "../engine/session.js";
import { robotPause } from "../engine/robot-pace.js";
import { geometry, freeLines, isTimed, timeLeft } from "./rules.js";

const NODE_BUDGET = 20_000; // positions and captures tried per move; keeps the biggest board well under 100 ms
const SEARCH_SAFE = 16; // search the safe lines once this few are left
const memo = new Map(); // drawn lines (two numbers) -> value for the player to move, shared across moves
let memoSize = 0;

// ---------- a mutable board for search ----------
class Board {
  constructor(state) {
    const geo = geometry(state.size);
    this.geo = geo;
    this.drawn = new Uint8Array(geo.lines);
    this.sides = new Int8Array(geo.boxes);
    this.words = [0, 0, 0, 0];
    this.claimed = 0;
    for (let l = 0; l < geo.lines; l++) if (state.lines[l] !== -1) this.draw(l);
  }
  draw(l) {
    this.drawn[l] = 1;
    this.words[(l / 24) | 0] ^= 1 << l % 24;
    let closed = 0;
    for (const b of this.geo.lineBoxes[l]) if (++this.sides[b] === 4) closed++;
    this.claimed += closed;
    return closed;
  }
  undo(l) {
    this.drawn[l] = 0;
    this.words[(l / 24) | 0] ^= 1 << l % 24;
    for (const b of this.geo.lineBoxes[l]) if (this.sides[b]-- === 4) this.claimed--;
  }
  // The drawn lines as two exact numbers (24 lines per word, at most 96).
  keys() {
    const w = this.words;
    return [w[0] + w[1] * 0x1000000, w[2] + w[3] * 0x1000000 + this.geo.n * 2 ** 48];
  }
  safe(l) {
    if (this.drawn[l]) return false;
    for (const b of this.geo.lineBoxes[l]) if (this.sides[b] >= 2) return false;
    return true;
  }
  safeLines() {
    const out = [];
    for (let l = 0; l < this.geo.lines; l++) if (this.safe(l)) out.push(l);
    return out;
  }
  free() {
    const out = [];
    for (let l = 0; l < this.geo.lines; l++) if (!this.drawn[l]) out.push(l);
    return out;
  }
  capturable() {
    const out = [];
    for (let b = 0; b < this.geo.boxes; b++) if (this.sides[b] === 3) out.push(b);
    return out;
  }
  // The undrawn lines of box b.
  open(b) {
    return this.geo.boxLines[b].filter((l) => !this.drawn[l]);
  }
  // The box across line l from box b, or -1 for the edge of the board.
  across(l, b) {
    const bs = this.geo.lineBoxes[l];
    return bs.length === 2 ? (bs[0] === b ? bs[1] : bs[0]) : -1;
  }
}

class Budget extends Error {}

// ---------- captures ----------
// How many boxes a run of captures starting at box y takes.
function pathLength(B, y) {
  const done = [];
  let count = 0;
  let cur = y;
  while (cur >= 0 && B.sides[cur] === 3) {
    const l = B.open(cur)[0];
    count += B.draw(l);
    done.push(l);
    cur = B.across(l, cur);
  }
  for (let i = done.length - 1; i >= 0; i--) B.undo(done[i]);
  return count;
}

// Can the capturer stop here and hand the rest back with one line? Either the
// last two boxes of a chain (draw the far end) or the last four of a loop
// (draw the middle), so the other player must take them and move again.
function declineHere(B, caps) {
  if (caps.length === 1) {
    const y = caps[0];
    const l = B.open(y)[0];
    const z = B.across(l, y);
    if (z < 0 || B.sides[z] !== 2) return null;
    const m = B.open(z).find((x) => x !== l);
    const w = B.across(m, z);
    if (w >= 0 && B.sides[w] >= 2) return null;
    return { give: 2, line: m };
  }
  if (caps.length === 2) {
    const [a, d] = caps;
    const l1 = B.open(a)[0];
    const l3 = B.open(d)[0];
    const b = B.across(l1, a);
    const c = B.across(l3, d);
    if (b < 0 || c < 0 || b === c || b === d || c === a || B.sides[b] !== 2 || B.sides[c] !== 2) return null;
    const m1 = B.open(b).find((x) => x !== l1);
    const m2 = B.open(c).find((x) => x !== l3);
    return m1 === m2 ? { give: 4, line: m1 } : null;
  }
  return null;
}

// Takes every box on offer, one run at a time (shortest run first, so the
// longest run is the one left to decline). Returns the lines drawn, the
// boxes taken, and the last point where the capturer could decline instead:
// { taken: boxes taken before it, give, line }.
function runCaptures(B) {
  const lines = [];
  let total = 0;
  let decline = null;
  for (;;) {
    const caps = B.capturable();
    if (!caps.length) break;
    const d = declineHere(B, caps);
    if (d) decline = { taken: total, ...d };
    let pick = caps[0];
    if (caps.length > 1) {
      let best = Infinity;
      for (const y of caps) {
        const len = pathLength(B, y);
        if (len < best) [best, pick] = [len, y];
      }
    }
    const l = B.open(pick)[0];
    total += B.draw(l);
    lines.push(l);
  }
  return { lines, total, decline };
}

const undoAll = (B, lines) => {
  for (let i = lines.length - 1; i >= 0; i--) B.undo(lines[i]);
};

// ---------- the endgame: chains and loops ----------
// When every unclaimed box has exactly two sides drawn, the board is chains
// (ending at the edge) and loops. Returns { chains, loops } as lengths, or
// null when some box is a junction (fewer than two sides).
function components(B) {
  const { boxes } = B.geo;
  for (let b = 0; b < boxes; b++) if (B.sides[b] < 2) return null;
  const seen = new Uint8Array(boxes);
  const chains = [];
  const loops = [];
  // Chains first: walk from every box that touches the edge through an undrawn line.
  for (let b = 0; b < boxes; b++) {
    if (seen[b] || B.sides[b] !== 2) continue;
    const ends = B.open(b).filter((l) => B.across(l, b) < 0);
    if (!ends.length) continue;
    let len = 0;
    let cur = b;
    let came = ends[0];
    while (cur >= 0 && !seen[cur]) {
      seen[cur] = 1;
      len++;
      const next = B.open(cur).find((l) => l !== came);
      const to = B.across(next, cur);
      came = next;
      cur = to;
    }
    chains.push(len);
  }
  for (let b = 0; b < boxes; b++) {
    if (seen[b] || B.sides[b] !== 2) continue;
    let len = 0;
    let cur = b;
    let came = -1;
    while (!seen[cur]) {
      seen[cur] = 1;
      len++;
      const next = B.open(cur).find((l) => l !== came);
      came = next;
      cur = B.across(next, cur);
    }
    loops.push(len);
  }
  return { chains, loops };
}

// Net boxes for the player who must open one of these chains and loops,
// with best play on both sides. The opener hands over a component; the
// other player takes it all and opens the next, or keeps control by taking
// all but two (chain of 3+) or all but four (loop) and making the opener
// take those and open the next. A two-chain is opened in the middle, so it
// can't be declined.
const formulaMemo = new Map();
function chainValue(chains, loops) {
  if (!chains.length && !loops.length) return 0;
  const key = `${chains.join(",")}|${loops.join(",")}`;
  const hit = formulaMemo.get(key);
  if (hit !== undefined) return hit;
  let best = -Infinity;
  const tried = new Set();
  chains.forEach((k, i) => {
    if (tried.has(`c${k}`)) return;
    tried.add(`c${k}`);
    const rest = chainValue(chains.filter((_, j) => j !== i), loops);
    const theirs = k >= 3 ? Math.max(k + rest, k - 4 - rest) : k + rest;
    best = Math.max(best, -theirs);
  });
  loops.forEach((k, i) => {
    if (tried.has(`l${k}`)) return;
    tried.add(`l${k}`);
    const rest = chainValue(chains, loops.filter((_, j) => j !== i));
    best = Math.max(best, -Math.max(k + rest, k - 8 - rest));
  });
  formulaMemo.set(key, best);
  return best;
}

const sortDesc = (a) => a.slice().sort((x, y) => y - x);

// The value for the player to move after the other player was handed the
// capturable boxes now on the board: they take them all and move, or decline
// the last two or four. Leaves B as it was.
function answerValue(B, ctx) {
  const run = runCaptures(B);
  ctx.nodes += run.lines.length;
  const rest = position(B, ctx);
  undoAll(B, run.lines);
  let theirs = run.total + rest;
  if (run.decline) theirs = Math.max(theirs, run.decline.taken - run.decline.give - rest);
  return -theirs;
}

// Net boxes from here for the player to move, with nothing on offer.
// Safe lines are searched; once none is left, every line opens something.
function position(B, ctx) {
  if (B.claimed === B.geo.boxes) return 0;
  const [k1, k2] = B.keys();
  let inner = memo.get(k1);
  const hit = inner?.get(k2);
  if (hit !== undefined) return hit;
  if (++ctx.nodes > ctx.budget) throw new Budget();
  let best = -Infinity;
  const safes = B.safeLines();
  if (safes.length) {
    // A safe line, or a sacrifice now to come out on the right side of the chains.
    for (const l of B.free()) {
      B.draw(l);
      best = Math.max(best, B.capturable().length ? answerValue(B, ctx) : -position(B, ctx));
      B.undo(l);
    }
  } else {
    const comp = components(B);
    if (comp) best = chainValue(sortDesc(comp.chains), sortDesc(comp.loops));
    else best = Math.max(...openings(B, ctx).map((o) => o.value));
  }
  if (++memoSize > 300_000) {
    memo.clear();
    memoSize = 0;
    inner = undefined;
  }
  if (!inner) memo.set(k1, (inner = new Map()));
  inner.set(k2, best);
  return best;
}

// Every line the player to move could open with when no safe line is left,
// valued by answerValue (the other side's best answer).
function openings(B, ctx) {
  return B.free().map((l) => {
    B.draw(l);
    const value = answerValue(B, ctx);
    B.undo(l);
    return { line: l, value };
  });
}

// ---------- choosing a move ----------
const pickRandom = (list, rng) => list[Math.floor(rng() * list.length)];

function bestOf(options, rng) {
  const top = Math.max(...options.map((o) => o.value));
  return pickRandom(options.filter((o) => o.value === top), rng).line;
}

// With no safe line left, the line that hands over the fewest boxes, if the
// other player takes everything it gives them.
function openingLine(B, rng) {
  const options = B.free().map((l) => {
    B.draw(l);
    const run = runCaptures(B);
    undoAll(B, run.lines);
    B.undo(l);
    return { line: l, value: -run.total };
  });
  return bestOf(options, rng);
}

// A search that runs out of budget stops mid-way with lines still drawn on
// B, so every fallback starts again from a fresh board.
function hardMove(state, rng) {
  const ctx = { nodes: 0, budget: NODE_BUDGET };
  let B = new Board(state);
  if (B.capturable().length) {
    // Take everything on offer, or all but the last two (four in a loop) to keep control.
    const run = runCaptures(B);
    let take = true;
    if (run.decline) {
      try {
        const rest = position(B, ctx);
        take = run.total + rest >= run.decline.taken - run.decline.give - rest;
      } catch (err) {
        if (!(err instanceof Budget)) throw err;
      }
    }
    if (!take && run.decline.taken === 0) return run.decline.line;
    return run.lines[0];
  }
  const safes = B.safeLines();
  try {
    if (safes.length > SEARCH_SAFE) throw new Budget();
    if (safes.length) {
      return bestOf(
        B.free().map((l) => {
          B.draw(l);
          const value = B.capturable().length ? answerValue(B, ctx) : -position(B, ctx);
          B.undo(l);
          return { line: l, value };
        }),
        rng,
      );
    }
    return bestOf(openings(B, ctx), rng);
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
    // Too many safe lines left to search: any of them will do for now.
    B = new Board(state);
    return safes.length ? pickRandom(safes, rng) : openingLine(B, rng);
  }
}

function mediumMove(state, rng) {
  const B = new Board(state);
  const caps = B.capturable();
  if (caps.length) return B.open(caps[0])[0];
  const safes = B.safeLines();
  if (safes.length) return pickRandom(safes, rng);
  return openingLine(B, rng);
}

function easyMove(state, rng) {
  const B = new Board(state);
  const caps = B.capturable();
  if (caps.length && rng() < 0.85) return B.open(pickRandom(caps, rng))[0];
  const safes = B.safeLines();
  if (safes.length && rng() < 0.6) return pickRandom(safes, rng);
  return pickRandom(B.free(), rng);
}

const MOVERS = { easy: easyMove, medium: mediumMove, hard: hardMove };

export function chooseMove(state, _me, rng = Math.random, { level = "easy" } = {}) {
  if (!freeLines(state).length) throw new Error("no line left");
  return { line: (MOVERS[level] || easyMove)(state, rng) };
}

// The robot pauses like a person: longer to start a turn, quicker to take
// a box it was given.
export function thinkTime(state, me, rng = Math.random) {
  const again = state.last?.player === me && state.last.boxes.length > 0;
  return again ? 380 + rng() * 220 : 650 + rng() * 650;
}

// Drives the robot's side of a session (startTurnRobot with a pause per move).
export function startRobot(session, { rules, level = "easy", rng = Math.random, think = thinkTime }) {
  const router = matchRouter(session);
  let match = null;
  let timer = null;
  let destroyed = false;
  function schedule() {
    if (destroyed || timer || !match.canMove()) return;
    const started = performance.now();
    timer = setTimeout(() => {
      timer = null;
      if (destroyed || !match.canMove()) return;
      const st = match.state;
      const move = chooseMove(st, match.me, rng, { level });
      const ms = Math.round(performance.now() - started);
      match.play(isTimed(st) && ms > timeLeft(st, match.me) ? { timeout: true } : { ...move, ms });
    }, robotPause(think(match.state, match.me, rng)));
  }
  function newMatch(m) {
    clearTimeout(timer);
    timer = null;
    match = new TurnMatch({ send: (msg) => session.send(msg), me: session.index, rules, m });
    match.on("update", schedule);
    router.start(match);
  }
  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}

// Net boxes for the player to move when nothing is on offer (for tests).
export function evaluate(state) {
  return position(new Board(state), { nodes: 0, budget: Infinity });
}
