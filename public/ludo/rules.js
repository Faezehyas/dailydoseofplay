// Ludo rules for TurnMatch, for two to four players. A cross-shaped board: a
// shared loop of 52 squares, a yard and a five-square home column per colour,
// and the centre. Each player has four tokens. A turn is a roll, then a choice
// of token. A 6 brings a token out of the yard and earns another roll; landing
// on an opponent sends their tokens back to the yard, except on the safe start
// and star squares; a token must land exactly in the centre. Pure: no DOM,
// timers or randomness (the die comes in through rng).
//
// A token's place is its progress along its own path: -1 in the yard, 0 its
// start square, 1–50 the rest of the loop, 51–55 its home column, 56 home.
import { RuleError } from "../engine/turn-match.js";

export const TOKENS = 4;
export const LOOP = 52;
export const YARD = -1;
export const LAST_LOOP = 50; // the loop square before the home column
export const HOME = 56;
export const DIE = 6;
export const MAX_PLAYERS = 4;
// Colours go clockwise round the board, in turn order.
export const COLORS = ["red", "green", "yellow", "blue"];
// Each colour's start square on the loop; the loop is numbered from the left
// arm's top row (see geometry in main.js). Stars sit eight squares further on.
export const STARTS = [1, 14, 27, 40];
export const STARS = STARTS.map((s) => (s + 8) % LOOP);
export const SAFE = new Set([...STARTS, ...STARS]);

export const FIRST = ["random", "host", "guest"];
export const MOVE_SECONDS = [0, 10, 20, 30];
export const LEVELS = ["easy", "medium", "hard"];
export const ROBOTS = [1, 2, 3];
// level and robots are per device: they only count against robots.
export const DEFAULT_CONFIG = {
  threeSixes: true,
  blocks: false,
  captureBonus: false,
  places: true,
  first: "random",
  moveSeconds: 0,
  level: "easy",
  robots: 3,
};
// Shared random draws per match: the coin toss, then one per roll.
// rules.test.js plays seeded games with every house rule to check the margin.
export const DRAWS = 2048;

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const bool = (k) => pick(c[k], [true, false], DEFAULT_CONFIG[k]);
  return {
    threeSixes: bool("threeSixes"),
    blocks: bool("blocks"),
    captureBonus: bool("captureBonus"),
    places: bool("places"),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
    robots: pick(c.robots, ROBOTS, DEFAULT_CONFIG.robots),
  };
}

// Two players sit opposite each other (red and yellow), as on a real board.
export const colorsFor = (players) => (players === 2 ? [0, 2] : [0, 1, 2, 3].slice(0, players));

// The loop square a token of `color` stands on at progress r (r 0–50), else -1.
export const square = (color, r) => (r >= 0 && r <= LAST_LOOP ? (STARTS[color] + r) % LOOP : -1);

export function newState(first, config = DEFAULT_CONFIG, players = 2) {
  const c = normalizeConfig(config);
  const each = (v) => Array.from({ length: players }, () => (typeof v === "function" ? v() : v));
  return {
    turn: first,
    winner: -1, // the first player home, set when the game ends
    first,
    players,
    colors: colorsFor(players),
    threeSixes: c.threeSixes,
    blocks: c.blocks,
    captureBonus: c.captureBonus,
    places: c.places,
    tokens: each(() => Array(TOKENS).fill(YARD)),
    rolled: false,
    die: 0, // the roll to play, while rolled
    sixes: 0, // 6s rolled in a row this turn
    order: [], // seats in the order they brought all four home
    rolls: each(0),
    captures: each(0), // tokens this player sent home
    lost: each(0), // this player's tokens sent home
    last: null, // the previous event
    ply: 0,
  };
}

// Tokens of every seat but `player` on loop square q, as [{ player, token }].
function others(state, player, q) {
  const out = [];
  for (let p = 0; p < state.players; p++) {
    if (p === player) continue;
    state.tokens[p].forEach((r, k) => square(state.colors[p], r) === q && out.push({ player: p, token: k }));
  }
  return out;
}

// True when two or more tokens of one opponent stand on q (a block).
function blockedBy(state, player, q) {
  const seen = new Set();
  for (const { player: p } of others(state, player, q)) {
    if (seen.has(p)) return true;
    seen.add(p);
  }
  return false;
}

// Where `player`'s token k would go with `die`, or null when it can't move.
// Returns { token, from, to, path, captures, enter, home, safe }.
export function moveFor(state, player, k, die) {
  const color = state.colors[player];
  const from = state.tokens[player][k];
  if (from === HOME) return null;
  if (from === YARD) {
    if (die !== DIE) return null;
    // A start square is safe for everyone: a block there can't keep a token in.
    return { token: k, from, to: 0, path: [0], captures: [], enter: true, home: false, safe: true };
  }
  const to = from + die;
  if (to > HOME) return null;
  const path = [];
  for (let r = from + 1; r <= to; r++) {
    path.push(r);
    if (state.blocks && r <= LAST_LOOP && blockedBy(state, player, square(color, r))) return null;
  }
  const q = square(color, to);
  const safe = q >= 0 && SAFE.has(q);
  const captures = q >= 0 && !safe ? others(state, player, q) : [];
  return { token: k, from, to, path, captures, enter: false, home: to === HOME, safe };
}

export function legalMoves(state, player, die = state.die) {
  const out = [];
  for (let k = 0; k < TOKENS; k++) {
    const mv = moveFor(state, player, k, die);
    if (mv) out.push(mv);
  }
  return out;
}

// Moves that end in different positions: tokens on the same spot are the same move.
export function distinctMoves(state, player, die = state.die) {
  const seen = new Set();
  return legalMoves(state, player, die).filter((mv) => !seen.has(mv.from) && seen.add(mv.from));
}

export const finished = (state, p) => state.tokens[p].every((r) => r === HOME);

// How far along a player is, for ranking when the game ends early.
export const progress = (state, p) => state.tokens[p].reduce((sum, r) => sum + r + 1, 0);

function nextSeat(state, player) {
  for (let i = 1; i <= state.players; i++) {
    const p = (player + i) % state.players;
    if (!finished(state, p)) return p;
  }
  return player;
}

function passTurn(state, player) {
  state.turn = nextSeat(state, player);
  state.rolled = false;
  state.die = 0;
  state.sixes = 0;
}

// Ends the game once the first player is home (or, playing for places, once
// one player is left). Players still out are ranked by how far they got.
function maybeEnd(state) {
  const out = [];
  for (let p = 0; p < state.players; p++) if (!finished(state, p)) out.push(p);
  if (state.places && out.length > 1) return;
  out.sort((a, b) => progress(state, b) - progress(state, a) || a - b);
  state.order.push(...out);
  state.winner = state.order[0];
}

function roll(state, player, rng) {
  if (state.rolled) throw new RuleError("Pick a token to move first");
  const value = 1 + Math.floor(rng() * DIE);
  state.rolls[player]++;
  state.sixes = value === DIE ? state.sixes + 1 : 0;
  const ev = { type: "roll", player, value, sixes: state.sixes, forfeit: false, pass: false, moves: [] };
  if (state.threeSixes && state.sixes === 3) {
    ev.forfeit = true;
    passTurn(state, player);
  } else {
    const moves = legalMoves(state, player, value);
    ev.moves = moves.map((mv) => mv.token);
    if (!moves.length) {
      ev.pass = true;
      passTurn(state, player);
    } else {
      state.rolled = true;
      state.die = value;
    }
  }
  return ev;
}

function move(state, player, token) {
  if (!state.rolled) throw new RuleError("Roll the die first");
  if (!Number.isInteger(token) || token < 0 || token >= TOKENS) throw new RuleError("Unknown token");
  const mv = moveFor(state, player, token, state.die);
  if (!mv) throw new RuleError(`That token can't move ${state.die}`);
  const die = state.die;
  state.tokens[player][token] = mv.to;
  for (const c of mv.captures) {
    c.from = state.tokens[c.player][c.token];
    state.tokens[c.player][c.token] = YARD;
    state.lost[c.player]++;
  }
  state.captures[player] += mv.captures.length;
  const done = finished(state, player);
  const ev = { type: "move", player, die, ...mv, done, place: 0, again: false, why: null };
  if (done) {
    state.order.push(player);
    ev.place = state.order.length;
    maybeEnd(state);
  }
  if (state.winner === -1) {
    if (!done && die === DIE) ev.why = "six";
    else if (!done && state.captureBonus && mv.captures.length) ev.why = "capture";
    ev.again = !!ev.why;
    if (ev.again) {
      state.rolled = false;
      state.die = 0;
    } else passTurn(state, player);
  } else state.rolled = false;
  return ev;
}

export function applyMove(state, player, mv, rng) {
  if (state.winner !== -1) throw new RuleError("The game is over");
  if (state.turn !== player) throw new RuleError("Not your turn");
  let ev;
  if (mv?.type === "roll") ev = roll(state, player, rng);
  else if (mv?.type === "move") ev = move(state, player, mv.token);
  else throw new RuleError("Unknown move");
  state.ply++;
  state.last = ev;
  return [ev];
}

// The rules object TurnMatch uses for a room's config. The coin toss only
// counts when the room leaves the first roll to chance; "guest" is seat 1.
export function makeRules(config) {
  const c = normalizeConfig(config);
  return {
    config: c,
    newState: (coin, players = 2) => newState(c.first === "random" ? coin : c.first === "host" ? 0 : 1, c, players),
    applyMove,
    needsRandom: (state, mv) => mv?.type === "roll",
    draws: DRAWS,
  };
}

export const rules = makeRules(DEFAULT_CONFIG);
