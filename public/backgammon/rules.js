// Backgammon rules for TurnMatch. A room picks a config: optional clocks, who
// moves first and the robot's level. No doubling cube and no gammons: the
// first player to bear off all fifteen checkers wins. Pure: no DOM, timers or
// randomness (dice come in through rng).
//
// Each player counts points from their own side: point 1 is the innermost
// point of their home board, 24 the farthest. pos[p][n] is how many of
// player p's checkers stand on p's point n; pos[p][25] is the bar and
// pos[p][0] the checkers borne off. Your point n is the opponent's 25 − n.
import { RuleError } from "../engine/turn-match.js";

export const BAR = 25;
export const OFF = 0;
export const CHECKERS = 15;
export const MOVE_SECONDS = [30, 60, 90, 120, 0]; // 0 = no limit
export const GAME_SECONDS = [180, 300, 480, 900, 1200, 3600, 0];
export const FIRST = ["random", "host", "guest"];
export const LEVELS = ["easy", "medium", "hard"];
export const DEFAULT_CONFIG = { moveSeconds: 0, gameSeconds: 0, first: "random", level: "easy" };
// Shared random draws per match: the coin toss, then one per roll. Games
// rarely need 150; the engine's default of 256 runs out in rare long ones.
export const DRAWS = 1024;
const START = { 24: 2, 13: 5, 8: 3, 6: 5 };

// Any unknown or missing value falls back to the default.
export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    gameSeconds: pick(c.gameSeconds, GAME_SECONDS, DEFAULT_CONFIG.gameSeconds),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
  };
}

export function startPosition() {
  const side = Array(26).fill(0);
  for (const [n, k] of Object.entries(START)) side[n] = k;
  return [side, side.slice()];
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { moveSeconds, gameSeconds } = normalizeConfig(config);
  return {
    turn: first,
    winner: -1, // no draws in backgammon
    first,
    reason: null, // "off" | "timeout" once over
    pos: startPosition(),
    rolled: false,
    roll: [], // this turn's two dice
    dice: [], // dice still to play this turn (four for a double)
    last: null, // the previous turn: { player, roll, steps, passed }
    ply: 0, // moves applied, rolls included
    moveMs: moveSeconds * 1000,
    clocks: gameSeconds ? [gameSeconds * 1000, gameSeconds * 1000] : null,
    spent: 0, // ms used in the current turn
  };
}

export const isTimed = (state) => state.moveMs > 0 || state.clocks !== null;

// Milliseconds `player` may still spend in this turn (Infinity without clocks).
export function timeLeft(state, player) {
  const turn = state.moveMs ? state.moveMs - (state.turn === player ? state.spent : 0) : Infinity;
  return Math.min(turn, state.clocks ? state.clocks[player] : Infinity);
}

export function pipCount(side) {
  let pips = 0;
  for (let n = 1; n <= BAR; n++) pips += side[n] * n;
  return pips;
}

export const clonePos = (pos) => [pos[0].slice(), pos[1].slice()];

// A checker on the opponent's side at their point m stands on your point 25 − m.
const theirs = (pos, p, n) => pos[1 - p][25 - n];

export function allHome(side) {
  for (let n = 7; n <= BAR; n++) if (side[n]) return false;
  return true;
}

// The landing point for a step, or null when the step is illegal. OFF means borne off.
export function stepTarget(pos, p, from, die) {
  const side = pos[p];
  if (!side[from]) return null;
  if (side[BAR] && from !== BAR) return null;
  const to = from - die;
  if (to >= 1) return theirs(pos, p, to) >= 2 ? null : to;
  if (!allHome(side)) return null;
  if (to === 0) return OFF;
  // A higher die bears off only from the highest occupied point.
  for (let n = from + 1; n <= 6; n++) if (side[n]) return null;
  return OFF;
}

// Moves one checker in place; returns { from, to, die, hit }.
export function applyStep(pos, p, from, die) {
  const to = stepTarget(pos, p, from, die);
  if (to === null) throw new RuleError("That checker can't move there");
  const side = pos[p];
  let hit = false;
  side[from]--;
  if (to === OFF) side[OFF]++;
  else {
    const opp = pos[1 - p];
    if (opp[25 - to] === 1) {
      opp[25 - to] = 0;
      opp[BAR]++;
      hit = true;
    }
    side[to]++;
  }
  return { from, to, die, hit };
}

const withoutDie = (dice, die) => {
  const rest = dice.slice();
  rest.splice(rest.indexOf(die), 1);
  return rest;
};

// Every single step `p` could make with one of `dice`, ignoring the use-both-dice rule.
export function singleSteps(pos, p, dice) {
  const out = [];
  const side = pos[p];
  const froms = side[BAR] ? [BAR] : [];
  if (!side[BAR]) for (let n = 24; n >= 1; n--) if (side[n]) froms.push(n);
  for (const die of new Set(dice)) {
    for (const from of froms) {
      const to = stepTarget(pos, p, from, die);
      if (to !== null) out.push({ from, to, die });
    }
  }
  return out;
}

const sum = (dice) => dice.reduce((a, b) => a + b, 0);
const isDouble = (dice) => dice.length > 2 || (dice.length === 2 && dice[0] === dice[1]);

// Walks every play from here. With a double, steps go from non-increasing
// points, which reaches every final position without repeating orders.
// visit(pos, steps, count, pips) sees each finished play; bearing off the
// last checker counts as playing the dice left. Return true to stop early.
function walk(pos, p, dice, visit) {
  const double = isDouble(dice);
  (function search(cur, left, steps, pips, maxFrom) {
    if (cur[p][OFF] === CHECKERS) return visit(cur, steps, steps.length + left.length, pips + sum(left));
    let moved = false;
    for (const s of singleSteps(cur, p, left)) {
      if (double && s.from > maxFrom) continue;
      moved = true;
      const next = clonePos(cur);
      applyStep(next, p, s.from, s.die);
      if (search(next, withoutDie(left, s.die), [...steps, [s.from, s.die]], pips + s.die, s.from)) return true;
    }
    return !moved && visit(cur, steps, steps.length, pips);
  })(pos, dice, [], 0, BAR);
}

// The most dice `p` can play from here, and the most pips that uses (which
// enforces "play the larger die when only one can be played").
export function bestPlay(pos, p, dice) {
  let best = { count: 0, pips: 0 };
  const full = sum(dice);
  walk(pos, p, dice, (_, __, count, pips) => {
    if (count > best.count || (count === best.count && pips > best.pips)) best = { count, pips };
    return count === dice.length && pips === full;
  });
  return best;
}

// The steps that keep a play maximal: after each one, the rest of the dice
// can still be played as fully as before. Bearing off the last checker wins.
export function legalSteps(pos, p, dice) {
  if (!dice.length || pos[p][OFF] === CHECKERS) return [];
  const best = bestPlay(pos, p, dice);
  if (!best.count) return [];
  return singleSteps(pos, p, dice).filter((s) => {
    const next = clonePos(pos);
    applyStep(next, p, s.from, s.die);
    if (next[p][OFF] === CHECKERS) return true;
    const rest = bestPlay(next, p, withoutDie(dice, s.die));
    return rest.count + 1 === best.count && rest.pips + s.die === best.pips;
  });
}

// Every distinct maximal play: [{ steps: [[from, die], ...], pos }], one per final position.
export function legalPlays(pos, p, dice) {
  let best = { count: 0, pips: 0 };
  const plays = new Map();
  walk(pos, p, dice, (cur, steps, count, pips) => {
    if (count < best.count || (count === best.count && pips < best.pips)) return false;
    if (count > best.count || pips > best.pips) {
      best = { count, pips };
      plays.clear();
    }
    const key = cur[0].join(",") + "|" + cur[1].join(",");
    if (!plays.has(key)) plays.set(key, { steps, pos: cur });
    return false;
  });
  return best.count ? [...plays.values()] : [];
}

const rollDie = (rng) => 1 + Math.floor(rng() * 6);

function spend(state, player, ms) {
  if (!isTimed(state)) return;
  if (!Number.isInteger(ms) || ms < 0) throw new RuleError("Move time missing");
  if (ms > timeLeft(state, player)) throw new RuleError("Time ran out");
  if (state.clocks) state.clocks[player] -= ms;
  state.spent += ms;
}

function endTurn(state, player, steps, passed) {
  state.last = { player, roll: state.roll, steps, passed };
  state.turn = 1 - player;
  state.rolled = false;
  state.roll = [];
  state.dice = [];
  state.spent = 0;
}

// A move is { type: "roll", ms }, then { type: "play", steps: [[from, die], ...], ms }
// (ms = time the mover spent, required when timed), or { timeout: true } when
// the mover's own clock runs out. A roll with no legal play passes the turn.
export function applyMove(state, player, move, rng) {
  if (state.winner !== -1) throw new RuleError("The game is over");
  if (state.turn !== player) throw new RuleError("Not your turn");
  if (move?.timeout === true) {
    if (!isTimed(state)) throw new RuleError("This game has no clock");
    state.winner = 1 - player;
    state.reason = "timeout";
    state.ply++;
    return [{ type: "timeout", player }];
  }
  if (move?.type === "roll") {
    if (state.rolled) throw new RuleError("You already rolled");
    spend(state, player, move.ms);
    const roll = [rollDie(rng), rollDie(rng)];
    state.rolled = true;
    state.roll = roll;
    state.dice = roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : roll.slice();
    state.ply++;
    const events = [{ type: "roll", player, roll }];
    if (!legalSteps(state.pos, player, state.dice).length) {
      endTurn(state, player, [], true);
      events.push({ type: "pass", player, roll });
    }
    return events;
  }
  if (move?.type !== "play") throw new RuleError("Unknown move");
  if (!state.rolled) throw new RuleError("Roll the dice first");
  const steps = move.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 4) throw new RuleError("Play your dice");
  const pos = clonePos(state.pos);
  let dice = state.dice.slice();
  const done = [];
  for (const step of steps) {
    const [from, die] = Array.isArray(step) ? step : [];
    if (!Number.isInteger(from) || !Number.isInteger(die)) throw new RuleError("Malformed step");
    if (!legalSteps(pos, player, dice).some((s) => s.from === from && s.die === die)) {
      throw new RuleError(dice.includes(die) ? "That checker can't move there" : "That die isn't yours to play");
    }
    done.push(applyStep(pos, player, from, die));
    dice = withoutDie(dice, die);
  }
  if (legalSteps(pos, player, dice).length) throw new RuleError("You must play as many dice as you can");
  spend(state, player, move.ms);
  state.pos = pos;
  state.ply++;
  const events = [{ type: "play", player, steps: done }];
  if (pos[player][OFF] === CHECKERS) {
    state.winner = player;
    state.reason = "off";
    state.last = { player, roll: state.roll, steps: done, passed: false };
    state.dice = [];
    events.push({ type: "win", player });
  } else {
    endTurn(state, player, done, false);
  }
  return events;
}

// The rules object TurnMatch uses for a room's config. The coin toss only
// counts when the room leaves the first move to chance.
export function makeRules(config) {
  const c = normalizeConfig(config);
  return {
    config: c,
    newState: (coin) => newState(c.first === "random" ? coin : c.first === "host" ? 0 : 1, c),
    applyMove,
    needsRandom: (state, move) => move?.type === "roll",
    draws: DRAWS,
  };
}
