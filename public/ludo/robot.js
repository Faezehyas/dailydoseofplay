// Ludo robot. It rolls when it must roll, and otherwise scores the position
// each legal move leaves: how far its tokens have come (a token in the home
// column or home is worth much more, since nothing can touch it there), minus
// what each exposed token stands to lose to the opponents within reach behind
// it, plus what the move takes from the opponents. The level sets how much it
// sees and how often it plays a random move instead.
import { randInt } from "../engine/rng.js";
import { matchRouter } from "../engine/session.js";
import { robotPause } from "../engine/robot-pace.js";
import { TurnMatch } from "../engine/turn-match.js";
import { legalMoves, square, YARD, HOME, LAST_LOOP, LOOP, SAFE, STARTS, DIE } from "./rules.js";

export const LEVEL = {
  easy: { random: 0.45, sight: "none" }, // otherwise greedy: capture, come out, run the leader
  medium: { random: 0.1, sight: "direct" }, // counts attackers one roll away
  hard: { random: 0, sight: "full" }, // also two-roll shots, tokens coming out, threats and blocks
};

// A token's worth by progress: one leaving the loop is out of danger for good.
function worth(r) {
  if (r === YARD) return 0;
  if (r === HOME) return 100;
  if (r > LAST_LOOP) return 72 + (r - LAST_LOOP);
  return 12 + r;
}

// Chance one attacker `d` squares behind lands on you next turn.
function shot(d, sight) {
  if (d >= 1 && d <= DIE) return 1 / 6;
  if (sight === "full" && d > DIE && d <= 2 * DIE) return 1 / 36; // a 6, then the rest
  return 0;
}

// Opponent tokens that could reach loop square q next turn, as hit chances.
function attackers(state, tokens, me, q, sight) {
  const chances = [];
  for (let p = 0; p < state.players; p++) {
    if (p === me) continue;
    const color = state.colors[p];
    let inYard = false;
    for (const r of tokens[p]) {
      if (r === YARD) inYard = true;
      const at = square(color, r);
      if (at < 0) continue;
      const d = (q - at + LOOP) % LOOP;
      // It must still be on the loop when it gets there.
      if (d > 0 && r + d <= LAST_LOOP) chances.push(shot(d, sight));
    }
    // A token coming out with a 6 can reach squares just past its start next roll.
    const fromStart = (q - STARTS[color] + LOOP) % LOOP;
    if (sight === "full" && inYard && fromStart >= 1 && fromStart <= DIE) chances.push(1 / 36);
  }
  return 1 - chances.reduce((left, p) => left * (1 - p), 1);
}

// The position's score for `me` (higher is better).
export function evaluate(state, tokens, me, sight) {
  const color = state.colors[me];
  let score = 0;
  let out = 0;
  const count = new Map();
  for (const r of tokens[me]) {
    const q = square(color, r);
    if (q >= 0) count.set(q, (count.get(q) || 0) + 1);
  }
  for (const r of tokens[me]) {
    score += worth(r);
    if (r !== YARD && r !== HOME) out++;
    const q = square(color, r);
    if (q < 0 || SAFE.has(q) || sight === "none") continue;
    // With the block rule, a pair can't be landed on.
    if (state.blocks && count.get(q) > 1) continue;
    score -= attackers(state, tokens, me, q, sight) * (worth(r) + 10);
  }
  // Tokens out on the board keep the choices open.
  score += 4 * Math.min(out, 3);
  const rivals = state.players - 1;
  for (let p = 0; p < state.players; p++) {
    if (p === me) continue;
    let theirs = 0;
    for (const r of tokens[p]) theirs += worth(r);
    score -= (0.85 * theirs) / rivals;
  }
  if (sight !== "full") return score;
  // Hard: a token within a roll behind an exposed rival may take it next turn.
  for (const r of tokens[me]) {
    const at = square(color, r);
    if (at < 0) continue;
    for (let p = 0; p < state.players; p++) {
      if (p === me) continue;
      for (const r2 of tokens[p]) {
        const q = square(state.colors[p], r2);
        const d = (q - at + LOOP) % LOOP;
        if (q >= 0 && !SAFE.has(q) && d >= 1 && d <= DIE && r + d <= LAST_LOOP) score += (worth(r2) + 10) / 24;
      }
    }
  }
  // With the block rule, a pair standing in front of rivals slows them down.
  if (state.blocks) {
    for (const [q, n] of count) {
      if (n < 2) continue;
      score += 3;
      for (let p = 0; p < state.players; p++) {
        if (p === me) continue;
        for (const r2 of tokens[p]) {
          const at = square(state.colors[p], r2);
          const d = (q - at + LOOP) % LOOP;
          if (at >= 0 && d >= 1 && d <= DIE) score += 2;
        }
      }
    }
  }
  return score;
}

// The tokens after a move, without touching the state.
function after(state, me, mv) {
  const tokens = state.tokens.map((side) => side.slice());
  tokens[me][mv.token] = mv.to;
  for (const c of mv.captures) tokens[c.player][c.token] = YARD;
  return tokens;
}

function greedy(moves, rng) {
  const capture = moves.filter((mv) => mv.captures.length);
  if (capture.length) return capture[randInt(rng, capture.length)];
  const enter = moves.find((mv) => mv.enter);
  if (enter) return enter;
  return moves.reduce((a, b) => (b.from > a.from ? b : a));
}

// A move for seat `me`: roll when it's time, else { type: "move", token }.
export function chooseMove(state, me, rng = Math.random, { level = "medium" } = {}) {
  if (!state.rolled) return { type: "roll" };
  const { random, sight } = LEVEL[level] || LEVEL.medium;
  const moves = legalMoves(state, me);
  if (moves.length === 1) return { type: "move", token: moves[0].token };
  if (rng() < random) return { type: "move", token: moves[randInt(rng, moves.length)].token };
  if (sight === "none") return { type: "move", token: greedy(moves, rng).token };
  let best = -Infinity;
  let picks = [];
  for (const mv of moves) {
    let s = evaluate(state, after(state, me, mv), me, sight);
    if (state.captureBonus && mv.captures.length) s += 6; // another roll
    if (s > best + 1e-9) {
      best = s;
      picks = [mv];
    } else if (s > best - 1e-9) picks.push(mv);
  }
  return { type: "move", token: picks[randInt(rng, picks.length)].token };
}

// Drives a robot seat, like the engine's startTurnRobot, except that the
// pause before each move is asked for each time (delay(state, me)), so the
// view can hold robots while it replays and hurry them once you are home.
export function startRobot(session, { rules, choose, delay, rng = Math.random }) {
  const router = matchRouter(session);
  let match = null;
  let timer = null;
  let destroyed = false;
  function schedule() {
    if (destroyed || timer || !match.canMove()) return;
    const ms = delay(match.state, match.me);
    // A negative pause means "not yet" (the screen is still replaying): ask again shortly.
    timer = setTimeout(() => {
      timer = null;
      if (destroyed || !match.canMove()) return;
      if (ms < 0) schedule();
      else match.play(choose(match.state, match.me, rng));
    }, robotPause(ms < 0 ? 50 : ms));
  }
  function newMatch(m) {
    match = new TurnMatch({ send: (msg) => session.send(msg), me: session.index, players: session.players.length, rules, m });
    match.on("update", schedule);
    router.start(match);
  }
  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    // Moves sooner when the view asks (it calls this after changing the pace).
    poke() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      schedule();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
