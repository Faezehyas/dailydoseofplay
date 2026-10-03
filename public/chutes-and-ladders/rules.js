// Chutes and Ladders rules for TurnMatch, on the classic 1943 board: 100
// squares, nine ladders and ten chutes. Each turn is one spin of a 1–6
// spinner; there are no choices, so a move is just { type: "spin" }. A room
// picks a config: how the last stretch to 100 works, whether a 6 spins again,
// and who goes first. Pure: no DOM, timers or randomness (spins come in
// through rng).
import { RuleError } from "../engine/turn-match.js";

export const SIZE = 10;
export const LAST = SIZE * SIZE;
export const START = 0; // off the board, next to square 1
export const SPINNER = 6;

// Bottom of the ladder -> top.
export const LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
// Top of the chute -> bottom.
export const CHUTES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };

export const FINISH = ["exact", "bounce", "any"];
export const FIRST = ["random", "host", "guest"];
export const SPIN_MODES = ["tap", "auto"];
export const DEFAULT_CONFIG = { finish: "exact", sixAgain: false, first: "random", spin: "tap" };
// Shared random draws per match: the coin toss, then one per spin. Two
// players need about 60 spins on average and rarely more than 250.
export const DRAWS = 1024;

// Any unknown or missing value falls back to the default.
export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    finish: pick(c.finish, FINISH, DEFAULT_CONFIG.finish),
    sixAgain: pick(c.sixAgain, [true, false], DEFAULT_CONFIG.sixAgain),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    spin: pick(c.spin, SPIN_MODES, DEFAULT_CONFIG.spin),
  };
}

// Square n (1–100) on the grid: row 0 is the bottom, and rows snake, so
// odd rows run right to left. Square 100 is top left.
export function cellOf(n) {
  const row = Math.floor((n - 1) / SIZE);
  const k = (n - 1) % SIZE;
  return { row, col: row % 2 ? SIZE - 1 - k : k };
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { finish, sixAgain } = normalizeConfig(config);
  return {
    turn: first,
    winner: -1, // no draws: someone always reaches 100
    first,
    finish,
    sixAgain,
    pos: [START, START],
    spins: [0, 0],
    climbs: [0, 0], // ladders taken
    slides: [0, 0], // chutes taken
    last: null, // the previous spin's event
    ply: 0,
  };
}

// Where a spin of `spin` from square `from` ends, with every square the pawn
// passes on the way. Overshooting 100 depends on the finish rule.
export function walk(from, spin, finish) {
  const path = [];
  let to = from + spin;
  let bounce = false;
  let stay = false;
  if (to > LAST) {
    if (finish === "exact") {
      stay = true;
      to = from;
    } else if (finish === "bounce") {
      bounce = true;
      for (let n = from + 1; n <= LAST; n++) path.push(n);
      to = 2 * LAST - to;
      for (let n = LAST - 1; n >= to; n--) path.push(n);
      return { path, to, bounce, stay };
    } else to = LAST;
  }
  for (let n = from + 1; n <= to; n++) path.push(n);
  return { path, to, bounce, stay };
}

// One spin, start to finish. The result is also the event the view animates.
export function spinResult(state, player, spin) {
  const from = state.pos[player];
  const { path, to, bounce, stay } = walk(from, spin, state.finish);
  let end = to;
  let jump = null;
  if (LADDERS[to]) jump = { kind: "ladder", from: to, to: (end = LADDERS[to]) };
  else if (CHUTES[to]) jump = { kind: "chute", from: to, to: (end = CHUTES[to]) };
  const win = end === LAST;
  const again = !win && state.sixAgain && spin === SPINNER;
  return { type: "spin", player, spin, from, path, landed: to, to: end, bounce, stay, jump, again, win };
}

export function applyMove(state, player, move, rng) {
  if (state.winner !== -1) throw new RuleError("The game is over");
  if (state.turn !== player) throw new RuleError("Not your turn");
  if (move?.type !== "spin") throw new RuleError("Unknown move");
  const spin = 1 + Math.floor(rng() * SPINNER);
  const ev = spinResult(state, player, spin);
  state.pos[player] = ev.to;
  state.spins[player]++;
  if (ev.jump?.kind === "ladder") state.climbs[player]++;
  if (ev.jump?.kind === "chute") state.slides[player]++;
  state.ply++;
  state.last = ev;
  if (ev.win) state.winner = player;
  else if (!ev.again) state.turn = 1 - player;
  return [ev];
}

// The rules object TurnMatch uses for a room's config. The coin toss only
// counts when the room leaves the first move to chance.
export function makeRules(config) {
  const c = normalizeConfig(config);
  return {
    config: c,
    newState: (coin) => newState(c.first === "random" ? coin : c.first === "host" ? 0 : 1, c),
    applyMove,
    needsRandom: (state, move) => move?.type === "spin",
    draws: DRAWS,
  };
}

export const rules = makeRules(DEFAULT_CONFIG);
