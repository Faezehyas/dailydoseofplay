// Dots and Boxes rules for TurnMatch. A room picks a config: the board (3×3
// up to 6×6 boxes), optional clocks, who draws first and the robot's level
// (the rules ignore the level). Players take turns drawing one line between
// two neighbouring dots; a line that closes one or two boxes claims them and
// its player draws again. When every box is claimed, the most boxes wins and
// an even split is a draw. Pure: no DOM, timers or randomness.
//
// Lines are numbered horizontal first, row by row: on an n×n board the
// horizontal line r, c (row 0..n of dots, column 0..n-1) is r·n + c, and the
// vertical line r, c (row 0..n-1, column 0..n of dots) is n(n+1) + r(n+1) + c.
// Box r, c is r·n + c.
import { RuleError } from "../engine/turn-match.js";

export const DRAW = 2;
export const SIZES = [3, 4, 5, 6];
export const MOVE_SECONDS = [10, 20, 30, 60, 0]; // per line; 0 = no limit
export const GAME_SECONDS = [60, 180, 300, 600, 0];
export const FIRST = ["random", "host", "guest"];
export const LEVELS = ["easy", "medium", "hard"];
export const DEFAULT_CONFIG = { size: 4, moveSeconds: 0, gameSeconds: 0, first: "random", level: "easy" };

// Any unknown or missing value falls back to the default.
export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    size: pick(c.size, SIZES, DEFAULT_CONFIG.size),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    gameSeconds: pick(c.gameSeconds, GAME_SECONDS, DEFAULT_CONFIG.gameSeconds),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
  };
}

const geoCache = new Map();

// The board's wiring, built once per size: the four lines of every box
// (top, bottom, left, right) and the one or two boxes beside every line.
export function geometry(n) {
  if (!geoCache.has(n)) {
    const H = n * (n + 1);
    const lines = 2 * H;
    const boxLines = [];
    const lineBoxes = Array.from({ length: lines }, () => []);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const b = r * n + c;
        const sides = [r * n + c, (r + 1) * n + c, H + r * (n + 1) + c, H + r * (n + 1) + c + 1];
        boxLines.push(sides);
        for (const l of sides) lineBoxes[l].push(b);
      }
    }
    geoCache.set(n, { n, H, lines, boxes: n * n, boxLines, lineBoxes });
  }
  return geoCache.get(n);
}

// Where line l runs: from dot (r1, c1) to dot (r2, c2), and whether it is horizontal.
export function lineEnds(n, l) {
  const H = n * (n + 1);
  if (l < H) {
    const r = Math.floor(l / n);
    const c = l % n;
    return { horizontal: true, r1: r, c1: c, r2: r, c2: c + 1 };
  }
  const k = l - H;
  const r = Math.floor(k / (n + 1));
  const c = k % (n + 1);
  return { horizontal: false, r1: r, c1: c, r2: r + 1, c2: c };
}

// How many of box b's sides are drawn.
export function sidesOf(state, b) {
  let k = 0;
  for (const l of geometry(state.size).boxLines[b]) if (state.lines[l] !== -1) k++;
  return k;
}

export function newState(first, config = DEFAULT_CONFIG) {
  const { size, moveSeconds, gameSeconds } = normalizeConfig(config);
  const geo = geometry(size);
  return {
    turn: first,
    winner: -1, // -1 playing, 0 or 1 won, 2 drawn
    first,
    size,
    lines: Array(geo.lines).fill(-1), // who drew each line
    boxes: Array(geo.boxes).fill(-1), // who claimed each box
    score: [0, 0],
    drawn: 0, // lines drawn so far
    last: null, // the previous line: { player, line, boxes }
    reason: null, // "boxes" | "timeout" once over
    moveMs: moveSeconds * 1000,
    clocks: gameSeconds ? [gameSeconds * 1000, gameSeconds * 1000] : null,
  };
}

export const isTimed = (state) => state.moveMs > 0 || state.clocks !== null;

// Milliseconds `player` may spend on this line (Infinity without clocks).
// Every line is its own move, so a line that closes a box restarts the limit.
export function timeLeft(state, player) {
  return Math.min(state.moveMs || Infinity, state.clocks ? state.clocks[player] : Infinity);
}

export function freeLines(state) {
  const out = [];
  for (let l = 0; l < state.lines.length; l++) if (state.lines[l] === -1) out.push(l);
  return out;
}

// The boxes line l would close if drawn now.
export function boxesClosedBy(state, l) {
  return geometry(state.size).lineBoxes[l].filter((b) => sidesOf(state, b) === 3);
}

// A move is { line, ms } (ms = time the mover spent, required when timed),
// or { timeout: true } when the mover's own clock runs out.
export function applyMove(state, player, move) {
  if (state.winner !== -1) throw new RuleError("The game is over");
  if (state.turn !== player) throw new RuleError("Not your turn");
  if (move?.timeout === true) {
    if (!isTimed(state)) throw new RuleError("This game has no clock");
    state.winner = 1 - player;
    state.reason = "timeout";
    return [{ type: "timeout", player }];
  }
  const line = move?.line;
  if (!Number.isInteger(line) || line < 0 || line >= state.lines.length) throw new RuleError("Pick a line between two dots");
  if (state.lines[line] !== -1) throw new RuleError("That line is already drawn");
  if (isTimed(state)) {
    const ms = move.ms;
    if (!Number.isInteger(ms) || ms < 0) throw new RuleError("Move time missing");
    if (ms > timeLeft(state, player)) throw new RuleError("Time ran out");
    if (state.clocks) state.clocks[player] -= ms;
  }
  const boxes = boxesClosedBy(state, line);
  state.lines[line] = player;
  state.drawn++;
  for (const b of boxes) state.boxes[b] = player;
  state.score[player] += boxes.length;
  state.last = { player, line, boxes };
  const over = state.score[0] + state.score[1] === state.boxes.length;
  const events = [{ type: "line", player, line, boxes, again: boxes.length > 0 && !over }];
  if (over) {
    const [a, b] = state.score;
    state.winner = a === b ? DRAW : a > b ? 0 : 1;
    state.reason = "boxes";
    events.push({ type: "over", winner: state.winner, score: state.score.slice() });
  } else if (!boxes.length) {
    state.turn = 1 - player;
  }
  return events;
}

// The rules object TurnMatch uses for a room's config. The coin toss only
// counts when the room leaves the first line to chance.
export function makeRules(config) {
  const c = normalizeConfig(config);
  return {
    config: c,
    newState: (coin) => newState(c.first === "random" ? coin : c.first === "host" ? 0 : 1, c),
    applyMove,
  };
}

export const rules = makeRules(DEFAULT_CONFIG);
