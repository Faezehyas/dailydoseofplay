// Chutes and Ladders page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is the board, the spinner, the
// motion and the sounds. The match state never waits for the screen: every
// spin is queued and played out in order (spinner, hops, ladder or chute).
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { makeRules, normalizeConfig, cellOf, LADDERS, CHUTES, LAST, SIZE, SPINNER, MAX_PLAYERS } from "./rules.js";
import { chooseMove } from "./robot.js";
import { mountSettings } from "./settings.js";
import { play } from "./sounds.js";
import { s, icon, VIGNETTES } from "./art.js";

const ROBOT_DELAY = 700;
const AUTO_SPIN_DELAY = 700; // "Spins by itself": a beat after the board settles
const U = 100; // one square, in board units
const BOARD = SIZE * U;
const GROUND = 96; // the start lawn under the board
const FOOT = 26; // a pawn stands this far below its square's centre
const SHARE = 22; // two pawns on one square stand apart by twice this
const CROWD = 72; // three or four pawns on one square spread across this
const PAWN_SCALE = 1.15;
const START_SPOTS = [150, 225, 300, 375].map((x) => ({ x, y: BOARD + 66 }));
const SPIN_SPEED = 1100; // degrees per second at full spin
const PACE = { hop: 230, rung: 120, between: 380 };
const FINISH_TEXT = { exact: "exact spin to finish", bounce: "bounce back off 100", any: "any spin past 100 wins" };

const settings = mountSettings(document.getElementById("cl-settings"), document.getElementById("lobby"));
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const still = () => reduced.matches;

startGameShell({
  slug: "chutes-and-ladders",
  title: "Chutes and Ladders",
  tagline: "Spin, hop, climb the ladders and dodge the chutes. First to square 100 wins.",
  layout: "wide",
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,
  robots: () => settings.get().robots,
  createRobot: (session) => startTurnRobot(session, { rules: makeRules(settings.get()), choose: chooseMove, delay: ROBOT_DELAY }),
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

// ---------- board geometry ----------
function center(n) {
  const { row, col } = cellOf(n);
  return { x: col * U + U / 2, y: (SIZE - 1 - row) * U + U / 2 };
}

// Where `player`'s pawn stands on square n, given the seats of every pawn
// there (`crowd`, in seat order). Three or four stand staggered.
function spot(n, player, crowd = [player]) {
  if (n === 0) return { ...START_SPOTS[player] };
  const c = center(n);
  const k = crowd.length;
  if (k < 2) return { x: c.x, y: c.y + FOOT };
  const i = crowd.indexOf(player);
  const step = k === 2 ? 2 * SHARE : CROWD / (k - 1);
  return { x: c.x + (i - (k - 1) / 2) * step, y: c.y + FOOT + (k > 2 ? (i % 2 ? -8 : 4) : 0) };
}

// Each chute bends one way or the other so neighbours don't overlap.
const BEND = { 16: 0.5, 47: -0.9, 49: 0.7, 56: 1.0, 62: -0.6, 64: 0.8, 87: 0.55, 93: -0.9, 95: 0.85, 98: -0.75 };
const CHUTE_COLORS = { 16: 0, 47: 1, 49: 2, 56: 3, 62: 4, 64: 5, 87: 1, 93: 2, 95: 0, 98: 4 };

function chuteCurve(from, to) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const px = -dy / len;
  const py = dx / len;
  const w = Math.min(130, Math.max(40, len * 0.24)) * BEND[from];
  const p1 = { x: a.x + dx * 0.28 + px * w, y: a.y + dy * 0.28 + py * w };
  const p2 = { x: a.x + dx * 0.72 - px * w, y: a.y + dy * 0.72 - py * w };
  return { a, b, p1, p2, d: `M${a.x} ${a.y} C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${b.x} ${b.y}` };
}

// A point on a cubic Bézier, and its direction.
function bezier({ a, p1, p2, b }, t) {
  const u = 1 - t;
  const x = u * u * u * a.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * b.x;
  const y = u * u * u * a.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * b.y;
  const tx = 3 * u * u * (p1.x - a.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (b.x - p2.x);
  const ty = 3 * u * u * (p1.y - a.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (b.y - p2.y);
  return { x, y, angle: Math.atan2(ty, tx) };
}

// Samples a curve evenly by length, so a pawn slides at a steady pace.
function sampleCurve(curve, n = 120) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(bezier(curve, i / n));
  const lens = [0];
  for (let i = 1; i <= n; i++) lens.push(lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = lens[n];
  return {
    total,
    at(f) {
      const target = f * total;
      let i = 1;
      while (i < n && lens[i] < target) i++;
      const k = (target - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
      const p = pts[i - 1];
      const q = pts[i];
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, angle: q.angle };
    },
  };
}

// ---------- board art ----------
const r1 = (v) => Math.round(v * 10) / 10;

function ladderArt(from, to) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * 15;
  const py = ux * 15;
  const ext = 16;
  const A = { x: a.x - ux * ext, y: a.y - uy * ext };
  // The ladder to 100 stops short, under the trophy.
  const top = to === LAST ? -28 : ext;
  const B = { x: b.x + ux * top, y: b.y + uy * top };
  const rail = (sgn) => `M${r1(A.x + px * sgn)} ${r1(A.y + py * sgn)} L${r1(B.x + px * sgn)} ${r1(B.y + py * sgn)}`;
  const count = Math.max(2, Math.round(len / 36));
  const rungs = [];
  const reach = to === LAST ? (len - 34) / len : 1;
  for (let i = 0; i <= count; i++) {
    const t = (i / count) * reach;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    rungs.push(`M${r1(x - px)} ${r1(y - py)} L${r1(x + px)} ${r1(y + py)}`);
  }
  const rungPath = rungs.join("");
  const rails = rail(-1) + rail(1);
  return s(
    "g",
    { class: "ladder", "data-from": from },
    s("path", { class: "ladder-shadow", d: rails + rungPath, transform: "translate(5 7)" }),
    s("path", { class: "ladder-rung", d: rungPath }),
    s("path", { class: "ladder-rail", d: rails }),
    s("path", { class: "ladder-rail-hi", d: rails }),
  );
}

function chuteArt(from, to) {
  const curve = chuteCurve(from, to);
  const { a, b, d } = curve;
  const c = CHUTE_COLORS[from];
  const deg = (t) => (bezier(curve, t).angle * 180) / Math.PI;
  return s(
    "g",
    { class: `chute c${c}`, "data-from": from },
    s("path", { class: "chute-shadow", d, transform: "translate(5 8)" }),
    s("path", { class: "chute-rim", d }),
    s("path", { class: "chute-wall", d }),
    s("path", { class: "chute-bed", d }),
    s("path", { class: "chute-shine", d }),
    // The run-out at the bottom, flared along the slide.
    s(
      "g",
      { transform: `translate(${r1(b.x)} ${r1(b.y)}) rotate(${r1(deg(1))})` },
      s("ellipse", { class: "chute-lip", cx: 2, cy: 0, rx: 16, ry: 25 }),
      s("ellipse", { class: "chute-lip-in", cx: 2, cy: 0, rx: 10, ry: 17 }),
    ),
    // The deck at the top, with a handrail on each side.
    s(
      "g",
      { transform: `translate(${r1(a.x)} ${r1(a.y)}) rotate(${r1(deg(0))})` },
      s("rect", { class: "chute-deck", x: -20, y: -26, width: 18, height: 52, rx: 6 }),
      s("path", { class: "chute-rail", d: "M-14 -27 C-2 -36 14 -30 22 -22 M-14 27 C-2 36 14 30 22 22" }),
    ),
  );
}

// A little kid on a stand, like the board game's cardboard pawns.
function pawnArt(whose) {
  const fig = s(
    "g",
    { class: "pawn-fig" },
    s("ellipse", { class: "pawn-base", cx: 0, cy: -3, rx: 17, ry: 6.5 }),
    s("path", { class: "pawn-body", d: "M-13.5 -6 C-15 -22 -10 -32 0 -32 C10 -32 15 -22 13.5 -6 Z" }),
    s("path", { class: "pawn-arm", d: "M-12 -24 L-18 -14 M12 -24 L18 -14" }),
    s("circle", { class: "pawn-head", cx: 0, cy: -42, r: 11.5 }),
    s("path", { class: "pawn-hair", d: "M-11.6 -42.5 A11.6 11.6 0 0 1 11.6 -42.5 C7 -46.5 -2 -48 -11.6 -42.5 Z" }),
    s("circle", { class: "pawn-eye", cx: -4, cy: -41, r: 1.7 }),
    s("circle", { class: "pawn-eye", cx: 4, cy: -41, r: 1.7 }),
    s("path", { class: "pawn-smile", d: "M-4 -36.6 Q0 -33.4 4 -36.6" }),
  );
  const g = s("g", { class: `pawn ${whose}` }, s("ellipse", { class: "pawn-shadow", cx: 0, cy: 0, rx: 18, ry: 6 }), s("g", { class: "pawn-bob" }, fig));
  return { g, fig };
}

function trophyArt() {
  return s(
    "g",
    { class: "trophy", transform: `translate(${center(LAST).x + 4} ${center(LAST).y - 6}) scale(0.9)` },
    s("path", { class: "trophy-cup", d: "M-20 -30 H20 C20 -8 12 2 0 4 C-12 2 -20 -8 -20 -30 Z" }),
    s("path", { class: "trophy-handles", d: "M-20 -24 C-34 -24 -32 -6 -14 -6 M20 -24 C34 -24 32 -6 14 -6" }),
    s("path", { class: "trophy-cup", d: "M-4 3 H4 V13 H12 V20 H-12 V13 H-4 Z" }),
    s("path", { class: "trophy-star", d: "M0 -25 l3.5 7.2 7.9 1.1 -5.7 5.6 1.3 7.9 -7 -3.7 -7 3.7 1.3 -7.9 -5.7 -5.6 7.9 -1.1 Z" }),
  );
}

function lawnArt() {
  const y = BOARD;
  const blades = [];
  for (let x = 8; x < BOARD; x += 17) blades.push(`M${x} ${y + 14} q3 -9 1 -14 M${x + 6} ${y + 14} q-2 -7 2 -11`);
  const flowers = [[330, 40, 0], [470, 64, 1], [610, 34, 2], [760, 60, 0], [905, 38, 1]].map(([x, dy, c]) =>
    s(
      "g",
      { class: `flower f${c}`, transform: `translate(${x} ${y + dy})` },
      s("path", { class: "flower-stem", d: "M0 4 V22" }),
      [0, 72, 144, 216, 288].map((deg) => s("ellipse", { class: "flower-petal", cx: 0, cy: -7, rx: 5, ry: 7.5, transform: `rotate(${deg})` })),
      s("circle", { class: "flower-heart", r: 4.5 }),
    ),
  );
  return s(
    "g",
    { class: "lawn" },
    s("rect", { class: "lawn-ground", x: 0, y, width: BOARD, height: GROUND }),
    s("path", { class: "lawn-blades", d: blades.join("") }),
    flowers,
    s(
      "g",
      { class: "start-sign", transform: `translate(52 ${y + 12})` },
      s("path", { class: "sign-post", d: "M0 18 V78" }),
      s("rect", { class: "sign-board", x: -40, y: 0, width: 80, height: 34, rx: 8 }),
      s("text", { class: "sign-text", x: 0, y: 24 }, "START"),
    ),
  );
}

// The pictures at both ends of every ladder and chute, each in the corner of
// its square that points away from where the ladder or chute leaves it.
const CORNERS = [{ x: 26, y: -20 }, { x: 26, y: 24 }, { x: -26, y: 24 }];
function vignettes() {
  const out = [];
  const place = (n, name, dir) => {
    if (!name) return;
    const c = center(n);
    const best = CORNERS.reduce((a, b) => (a.x * dir.x + a.y * dir.y <= b.x * dir.x + b.y * dir.y ? a : b));
    out.push(icon(name, c.x + best.x, c.y + best.y, 1.05));
  };
  const unit = (dx, dy) => ({ x: dx / Math.hypot(dx, dy), y: dy / Math.hypot(dx, dy) });
  for (const [from, [start, end]] of Object.entries(VIGNETTES.ladders)) {
    const a = center(Number(from));
    const b = center(LADDERS[from]);
    place(Number(from), start, unit(b.x - a.x, b.y - a.y));
    place(LADDERS[from], end, unit(a.x - b.x, a.y - b.y));
  }
  for (const [from, [start, end]] of Object.entries(VIGNETTES.chutes)) {
    const curve = chuteCurve(Number(from), CHUTES[from]);
    const t0 = bezier(curve, 0).angle;
    const t1 = bezier(curve, 1).angle;
    place(Number(from), start, { x: Math.cos(t0), y: Math.sin(t0) });
    place(CHUTES[from], end, { x: -Math.cos(t1), y: -Math.sin(t1) });
  }
  return s("g", { class: "vignettes" }, out);
}

function buildBoard(players) {
  const squares = [];
  const numbers = [];
  for (let n = 1; n <= LAST; n++) {
    const { row, col } = cellOf(n);
    const x = col * U;
    const y = (SIZE - 1 - row) * U;
    const tone = (row * 3 + col * 2 + (row % 2)) % 5;
    const kind = LADDERS[n] ? "up" : CHUTES[n] ? "down" : n === LAST ? "goal" : "";
    squares.push(s("rect", { class: `sq t${tone} ${kind}`, x, y, width: U, height: U, "data-n": n }));
    numbers.push(s("text", { class: `num ${kind}`, x: x + 9, y: y + 25 }, String(n)));
  }
  const ladders = Object.entries(LADDERS).map(([a, b]) => ladderArt(Number(a), b));
  const chutes = Object.entries(CHUTES).map(([a, b]) => chuteArt(Number(a), b));
  const marks = s("g", { class: "marks" });
  const pawns = Array.from({ length: players }, (_, k) => pawnArt(`p${k}`));
  const fx = s("g", { class: "fx" });
  const svgEl = s(
    "svg",
    { class: "cl-board", id: "cl-board", viewBox: `-6 -6 ${BOARD + 12} ${BOARD + GROUND + 12}`, role: "img" },
    s("rect", { class: "frame", x: -6, y: -6, width: BOARD + 12, height: BOARD + GROUND + 12, rx: 22 }),
    s("g", { class: "squares" }, squares),
    s("g", { class: "grid-lines" }, s("path", { d: Array.from({ length: SIZE - 1 }, (_, i) => `M${(i + 1) * U} 0V${BOARD}M0 ${(i + 1) * U}H${BOARD}`).join("") })),
    marks,
    vignettes(),
    trophyArt(),
    lawnArt(),
    s("g", { class: "chutes" }, chutes),
    s("g", { class: "ladders" }, ladders),
    s("g", { class: "numbers" }, numbers),
    s("g", { class: "pawns" }, pawns.map((p) => p.g).reverse()),
    fx,
  );
  return { svg: svgEl, pawns, marks, fx, layer: svgEl.querySelector(".pawns") };
}

// ---------- spinner ----------
const WEDGE = 360 / SPINNER;
function spinnerArt() {
  const wedges = [];
  for (let v = 1; v <= SPINNER; v++) {
    const a0 = ((v - 1) * WEDGE - WEDGE / 2 - 90) * (Math.PI / 180);
    const a1 = a0 + WEDGE * (Math.PI / 180);
    const R = 92;
    const d = `M0 0 L${r1(R * Math.cos(a0))} ${r1(R * Math.sin(a0))} A${R} ${R} 0 0 1 ${r1(R * Math.cos(a1))} ${r1(R * Math.sin(a1))} Z`;
    const mid = (a0 + a1) / 2;
    wedges.push(
      s("path", { class: `wedge w${v}`, d }),
      s("text", { class: "wedge-num", x: r1(64 * Math.cos(mid)), y: r1(64 * Math.sin(mid) + 9) }, String(v)),
    );
  }
  const pegs = [];
  for (let v = 0; v < SPINNER; v++) {
    const a = (v * WEDGE + WEDGE / 2 - 90) * (Math.PI / 180);
    pegs.push(s("circle", { class: "peg", cx: r1(92 * Math.cos(a)), cy: r1(92 * Math.sin(a)), r: 3.5 }));
  }
  const arrow = s(
    "g",
    { class: "arrow" },
    s("path", { class: "arrow-shadow", d: "M0 -76 L11 -8 L5 26 H-5 L-11 -8 Z", transform: "translate(3 4)" }),
    s("path", { class: "arrow-body", d: "M0 -76 L11 -8 L5 26 H-5 L-11 -8 Z" }),
    s("path", { class: "arrow-shine", d: "M0 -66 L5 -10 L0 -10 Z" }),
  );
  const svgEl = s(
    "svg",
    { class: "cl-spinner", viewBox: "-104 -104 208 208", "aria-hidden": "true" },
    s("circle", { class: "dial-rim", r: 101 }),
    wedges,
    s("circle", { class: "dial-ring", r: 92 }),
    pegs,
    arrow,
    s("circle", { class: "hub", r: 15 }),
    s("circle", { class: "hub-dot", r: 5 }),
  );
  return { svg: svgEl, arrow };
}

// Spins the arrow. start() flicks it into a free spin while the result is
// drawn; land(v) eases it to rest on v from whatever speed it has.
function makeSpinner(arrow, isLive) {
  let angle = 0;
  let speed = 0;
  let raf = 0;
  let free = false;
  const set = (a) => {
    const crossed = Math.floor((a + WEDGE / 2) / WEDGE) - Math.floor((angle + WEDGE / 2) / WEDGE);
    angle = a;
    arrow.setAttribute("transform", `rotate(${r1(angle % 360)})`);
    if (crossed > 0) play("tick", { pitch: 0.9 + Math.random() * 0.2 });
  };
  const valueAt = (a) => (Math.floor((((a % 360) + 360 + WEDGE / 2) % 360) / WEDGE) % SPINNER) + 1;
  function start() {
    if (free) return;
    free = true;
    speed = SPIN_SPEED;
    play("flick");
    if (still()) return;
    let last = performance.now();
    cancelAnimationFrame(raf);
    const step = (now) => {
      if (!free || !isLive()) return;
      set(angle + (speed * Math.max(0, now - last)) / 1000);
      last = Math.max(last, now);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    free = false;
    cancelAnimationFrame(raf);
  }
  function land(v) {
    if (!free) start();
    free = false;
    cancelAnimationFrame(raf);
    const jitter = (Math.random() - 0.5) * WEDGE * 0.6;
    const base = (v - 1) * WEDGE + jitter;
    let target = angle - (angle % 360) + base;
    while (target < angle + 300) target += 360;
    if (still() || document.hidden) {
      set(target);
      return Promise.resolve(valueAt(target));
    }
    // Cubic ease-out: starting speed 3·dist/duration matches the free spin.
    const from = angle;
    const dist = target - from;
    const ms = Math.min(2600, Math.max(900, (3 * dist * 1000) / speed));
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        if (!isLive()) return resolve(v);
        const t = Math.min(1, Math.max(0, (now - t0) / ms));
        set(from + dist * (1 - (1 - t) ** 3));
        if (t < 1) raf = requestAnimationFrame(step);
        else {
          play("settle");
          resolve(valueAt(target));
        }
      };
      raf = requestAnimationFrame(step);
    });
  }
  return { start, stop, land, get spinning() { return free; } };
}

// ---------- the game ----------
function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const duel = count === 2;
  const seats = session.players.map((p) => p.seat);
  // You come first in the player list, the others in seat order.
  const order = [me, ...session.others.map((p) => p.seat)];
  // Colours go by seat, so a player has the same colour on every screen: p0 coral, p1 teal, p2 violet, p3 amber.
  const colorOf = (p) => p;
  const oppName = session.opponent.name;
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
  const score = Array(count).fill(0);
  const spinMode = settings.get().spin; // each player's own choice
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let gen = 0; // bumps on every new match, so old animations stop
  let rematch = { me: false, them: false, seats: [] };
  let destroyed = false;
  let shown = Array(count).fill(0); // where each pawn is drawn, by seat
  let queue = Promise.resolve();
  let pending = 0;
  let current = null; // the spin being animated: { player, phase }
  let log = [];
  let cuedPly = -1;
  let autoTimer = null;

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const pills = order.map((player) => {
    const where = el("small", { class: "where" });
    const node = el(
      "span",
      { class: `who p${colorOf(player)}` },
      el("span", { class: "swatch", "aria-hidden": "true" }),
      el("span", { class: "label" }, el("span", { class: "name" }, player === me ? myName : session.players[player].name), where),
    );
    return { node, where };
  });
  const players = duel
    ? el("div", { class: "cl-players" }, pills[0].node, el("span", { class: "vs" }, "vs"), pills[1].node)
    : el("div", { class: "cl-players many" }, pills.map((p) => p.node));
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
  const scoreBox = el("dl", { class: "cl-score", id: "cl-score", "aria-label": "Score" });
  const status = el("p", { class: "cl-status", id: "cl-status", role: "status", "aria-live": "polite", dataset: { who: `p${colorOf(me)}` } });
  const board = buildBoard(count);
  const spinnerParts = spinnerArt();
  const spinner = makeSpinner(spinnerParts.arrow, () => !destroyed);
  const spinValue = el("div", { class: "cl-spin-value", id: "cl-spin-value", "aria-live": "polite" });
  const dial = el("div", { class: "cl-dial", id: "cl-dial", onclick: () => spinNow() }, spinnerParts.svg, spinValue);
  const spinBtn = el("button", { class: "btn primary big cl-spin-btn", type: "button", id: "cl-spin", onclick: () => spinNow() }, "Spin");
  const logList = el("ol", { class: "cl-log", id: "cl-log", "aria-label": "Recent spins" });
  const configLine = el("p", { class: "cl-config", id: "cl-config" });
  const note = el("p", { class: "cl-note", id: "cl-note" });
  const overBox = el("div", { class: "cl-over", id: "cl-over", hidden: true });

  root.append(
    el(
      "div",
      { class: "chutes-ladders" },
      el("div", { class: "cl-top" }, players, leaveBtn),
      scoreBox,
      status,
      el(
        "div",
        { class: "cl-main" },
        el("div", { class: "cl-board-wrap" }, board.svg),
        el("div", { class: "cl-side" }, overBox, el("div", { class: "cl-spin-panel" }, dial, spinBtn), logList),
      ),
      configLine,
      note,
    ),
  );
  // Pawns are coloured by seat: p0 coral, p1 teal, p2 violet, p3 amber.
  const pawnOf = (player) => board.pawns[colorOf(player)];
  // The seats whose pawns stand on square n once `player` is there too.
  const crowd = (n, player) => seats.filter((p) => p === player || shown[p] === n);

  // ---------- input ----------
  function spinNow() {
    if (!match || match.phase !== "playing") return;
    if (match.state.turn !== me) return toast(`Wait for ${nameOf(match.state.turn)}`);
    if (pending || spinner.spinning || !match.canMove()) return;
    clearTimeout(autoTimer);
    spinner.start();
    match.play({ type: "spin" });
    render();
  }

  // ---------- motion ----------
  const live = (g) => g === gen && !destroyed;
  const fast = () => still() || document.hidden;
  const wait = (ms, g) => new Promise((r) => (fast() || !live(g) ? r() : setTimeout(r, ms)));

  function tween(ms, step, g) {
    return new Promise((resolve) => {
      if (fast() || !live(g)) {
        step(1);
        return resolve();
      }
      const t0 = performance.now();
      const frame = (now) => {
        if (!live(g)) return resolve();
        // A frame's timestamp can be a little before t0.
        const t = Math.min(1, Math.max(0, (now - t0) / ms));
        step(t);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // Draws a pawn at (x, y), lifted `lift` units, squashed and tilted.
  function setPawn(player, { x, y, lift = 0, sx = 1, sy = 1, rot = 0 }) {
    const { g, fig } = pawnOf(player);
    g.setAttribute("transform", `translate(${r1(x)} ${r1(y)})`);
    fig.setAttribute("transform", `translate(0 ${r1(-lift)}) rotate(${r1(rot)}) scale(${(sx * PAWN_SCALE).toFixed(3)} ${(sy * PAWN_SCALE).toFixed(3)})`);
    g.dataset.x = x;
    g.dataset.y = y;
  }
  const pawnAt = (player) => ({ x: Number(pawnOf(player).g.dataset.x), y: Number(pawnOf(player).g.dataset.y) });

  // Puts every pawn where `shown` says; the one that moves last is drawn on top.
  function placePawns() {
    for (const p of seats) setPawn(p, spot(shown[p], p, crowd(shown[p], p)));
  }

  function raise(player) {
    board.layer.append(pawnOf(player).g);
  }

  // Slides the pawns into their spots when a square becomes shared, or stops being.
  function settle(g) {
    const moves = seats.map((p) => ({ p, from: pawnAt(p), to: spot(shown[p], p, crowd(shown[p], p)) }));
    return tween(170, (t) => {
      const k = t * (2 - t);
      for (const { p, from, to } of moves) setPawn(p, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
    }, g);
  }

  // One hop to square n: an arc, a squash on landing and a note.
  async function hop(player, n, k, g, pace) {
    const from = pawnAt(player);
    const to = spot(n, player, crowd(n, player));
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const height = 22 + Math.min(18, dist * 0.08);
    await tween(PACE.hop * pace, (t) => {
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const lift = 4 * height * t * (1 - t);
      const stretch = 1 + 0.12 * Math.sin(Math.PI * t);
      setPawn(player, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, lift, sx: 1 / Math.sqrt(stretch), sy: stretch });
    }, g);
    shown[player] = n;
    play("hop", { k, mine: player === me });
    if (n === LAST) play("boing");
    await tween(110 * pace, (t) => {
      const squash = 1 - 0.18 * Math.sin(Math.PI * t);
      setPawn(player, { ...to, sx: 1 / squash, sy: squash });
    }, g);
  }

  // Up a ladder rung by rung, a note per rung, and a sparkle at the top.
  async function climb(player, from, to, g, pace) {
    const a = center(from);
    const b = center(to);
    const rungs = Math.max(3, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 36));
    const start = pawnAt(player);
    const end = spot(to, player, crowd(to, player));
    // Long ladders climb faster, so no climb takes much over a second and a half.
    const rungMs = Math.max(70, Math.min(PACE.rung, 1500 / rungs)) * pace;
    for (let k = 1; k <= rungs; k++) {
      const p0 = { x: start.x + (end.x - start.x) * ((k - 1) / rungs), y: start.y + (end.y - start.y) * ((k - 1) / rungs) };
      const p1 = { x: start.x + (end.x - start.x) * (k / rungs), y: start.y + (end.y - start.y) * (k / rungs) };
      await tween(rungMs, (t) => {
        const e = t * (2 - t);
        setPawn(player, { x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e, lift: 7 * Math.sin(Math.PI * t), rot: (k % 2 ? 6 : -6) * Math.sin(Math.PI * t) });
      }, g);
      play("rung", { k: k - 1, n: rungs });
    }
    shown[player] = to;
    play("sparkle");
    burst(end, "stars", g);
    await tween(260 * pace, (t) => setPawn(player, { ...end, lift: 16 * Math.sin(Math.PI * t), sy: 1 + 0.1 * Math.sin(Math.PI * t) }), g);
  }

  // Down a chute: speeding up along the curve, tilting with it, then a bump.
  async function slide(player, from, to, g, pace) {
    const curve = sampleCurve(chuteCurve(from, to));
    const end = spot(to, player, crowd(to, player));
    const ms = Math.min(2000, 700 + curve.total * 0.85) * pace;
    play("slide", { dur: ms / 1000 });
    await tween(ms, (t) => {
      const e = t < 0.8 ? (t / 0.8) ** 1.7 * 0.86 : 0.86 + 0.14 * (1 - (1 - (t - 0.8) / 0.2) ** 2);
      const p = curve.at(e);
      const tilt = Math.max(-35, Math.min(35, ((p.angle * 180) / Math.PI - 90) * -0.35));
      const blend = Math.max(0, (t - 0.85) / 0.15);
      setPawn(player, {
        x: p.x + (end.x - curve.at(1).x) * blend,
        y: p.y + FOOT * 0.6 + (end.y - curve.at(1).y - FOOT * 0.6) * blend,
        rot: tilt * (1 - blend),
      });
    }, g);
    shown[player] = to;
    play("bump");
    burst(end, "dust", g);
    await tween(240 * pace, (t) => {
      const squash = 1 - 0.25 * Math.sin(Math.PI * t);
      setPawn(player, { ...end, sx: 1 / squash, sy: squash, rot: 8 * Math.sin(Math.PI * t * 2) * (1 - t) });
    }, g);
  }

  // Overshooting with the exact-spin rule: a shake on the spot.
  async function refuse(player, g, pace) {
    const at = pawnAt(player);
    play("stay");
    await tween(420 * pace, (t) => setPawn(player, { ...at, rot: 12 * Math.sin(t * Math.PI * 4) * (1 - t) }), g);
  }

  // Little particles: stars at a ladder's top, dust at a chute's foot, confetti at 100.
  function burst(at, kind, g) {
    if (fast() || !live(g)) return;
    const count = kind === "confetti" ? 28 : kind === "stars" ? 9 : 8;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const angle = kind === "dust" ? Math.PI + (i / (count - 1)) * Math.PI : (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = kind === "confetti" ? 70 + Math.random() * 90 : kind === "stars" ? 40 + Math.random() * 25 : 26 + Math.random() * 18;
      const node =
        kind === "stars"
          ? s("path", { class: `fx-star s${i % 3}`, d: "M0 -7 l2 5 5 .5 -4 3.5 1.2 5 -4.2 -2.6 -4.2 2.6 1.2 -5 -4 -3.5 5 -.5 Z" })
          : kind === "dust"
            ? s("circle", { class: "fx-dust", r: 5 + Math.random() * 4 })
            : s("rect", { class: `fx-confetti c${i % 5}`, x: -4, y: -7, width: 8, height: 14, rx: 2 });
      board.fx.append(node);
      parts.push({ node, angle, dist, spin: (Math.random() - 0.5) * 720 });
    }
    const y0 = kind === "dust" ? at.y - 4 : at.y - 30;
    const ms = kind === "confetti" ? 1400 : 650;
    tween(ms, (t) => {
      const e = 1 - (1 - t) ** 2;
      for (const p of parts) {
        const fall = kind === "confetti" ? 160 * t * t : kind === "dust" ? -10 * t : 0;
        const x = at.x + Math.cos(p.angle) * p.dist * e;
        const y = y0 + Math.sin(p.angle) * p.dist * e * (kind === "dust" ? 0.4 : 1) + fall;
        p.node.setAttribute("transform", `translate(${r1(x)} ${r1(y)}) rotate(${r1(p.spin * t)}) scale(${(kind === "stars" ? 1.4 - t : 1).toFixed(2)})`);
        p.node.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      }
    }, g).then(() => parts.forEach((p) => p.node.remove()));
  }

  // A soft glow on a square: where a pawn landed, or a ladder or chute it took.
  function mark(n, cls) {
    for (const old of board.marks.querySelectorAll(`.${cls}`)) old.remove();
    if (!n) return;
    const c = center(n);
    board.marks.append(s("rect", { class: `mark ${cls}`, x: c.x - U / 2 + 4, y: c.y - U / 2 + 4, width: U - 8, height: U - 8, rx: 12 }));
  }

  // Plays one spin out on screen.
  async function animate(ev, g) {
    const p = ev.player;
    const pace = pending > 2 ? 0.55 : 1; // catching up after a hidden tab or a burst of spins
    current = { player: p, phase: "spin" };
    render();
    await spinner.land(ev.spin);
    if (!live(g)) return;
    current.phase = "move";
    spinValue.textContent = String(ev.spin);
    spinValue.dataset.who = `p${colorOf(p)}`;
    spinValue.classList.remove("pop");
    void spinValue.offsetWidth;
    spinValue.classList.add("pop");
    render();
    await wait(260 * pace, g);
    raise(p);
    if (ev.stay) await refuse(p, g, pace);
    else {
      // Notes climb with each hop, and walk back down after bouncing off 100.
      const top = ev.path.indexOf(LAST);
      for (const [i, n] of ev.path.entries()) await hop(p, n, ev.bounce && i > top ? 2 * top - i : i, g, pace);
    }
    if (ev.jump && live(g)) {
      current.phase = ev.jump.kind;
      render();
      await wait(160 * pace, g);
      if (ev.jump.kind === "ladder") await climb(p, ev.jump.from, ev.jump.to, g, pace);
      else await slide(p, ev.jump.from, ev.jump.to, g, pace);
    }
    if (!live(g)) return;
    shown[p] = ev.to;
    await settle(g);
    mark(ev.to, `last-p${colorOf(p)}`);
    addLog(ev);
    if (ev.win) {
      burst({ ...center(LAST), y: center(LAST).y + FOOT }, "confetti", g);
      play(p === me ? "win" : "lose");
    } else if (ev.again) toast(p === me ? "A 6! Spin again." : `${nameOf(p)} spun a 6 and goes again`);
    current = null;
    await wait(PACE.between * pace, g);
  }

  function enqueue(ev) {
    const g = gen;
    pending++;
    queue = queue
      .then(() => (live(g) ? animate(ev, g) : null))
      .catch((err) => console.error(err))
      .finally(() => {
        if (!live(g)) return; // a rematch started: its own queue and count took over
        pending--;
        if (!pending) {
          current = null;
          shown = match.state.pos.slice();
          placePawns();
        }
        render();
      });
  }

  // ---------- log ----------
  function describe(ev) {
    const who = nameOf(ev.player);
    let text = `${who} spun ${ev.spin}`;
    if (ev.stay) return `${text} and stays on ${ev.from}: ${LAST - ev.from} to go exactly`;
    if (ev.bounce) text += `, bounced off 100 to ${ev.landed}`;
    else text += ` to ${ev.landed}`;
    if (ev.jump?.kind === "ladder") text += ` and climbed to ${ev.jump.to}!`;
    else if (ev.jump?.kind === "chute") text += ` and slid down to ${ev.jump.to}`;
    if (ev.win) text += ev.jump ? " Home!" : ". Home!";
    return text;
  }

  function addLog(ev) {
    log = [{ ev, text: describe(ev) }, ...log].slice(0, 5);
    logList.replaceChildren(
      ...log.map(({ ev: e, text }, i) =>
        el("li", { class: `p${colorOf(e.player)} ${e.jump?.kind || ""} ${i ? "" : "fresh"}` }, el("span", { class: "dot", "aria-hidden": "true" }, String(e.spin)), el("span", {}, text)),
      ),
    );
  }

  // ---------- render ----------
  function renderScore() {
    const item = (label, n, cls) => el("div", { class: cls }, el("dt", {}, label), el("dd", {}, String(n)));
    scoreBox.replaceChildren(...order.map((p) => item(p === me ? "You" : nameOf(p), score[p], `${p === me ? "mine" : "theirs"} p${colorOf(p)}`)));
  }

  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who spins first…" : "Getting ready…";
      case "playing":
      case "over":
        if (current) {
          const mine = current.player === me;
          const who = nameOf(current.player);
          if (current.phase === "spin") return mine ? "Spinning…" : `${who} is spinning…`;
          if (current.phase === "ladder") return mine ? "A ladder! Up you go." : `${who} found a ladder!`;
          if (current.phase === "chute") return mine ? "Whee! Down the chute." : `${who} slides down a chute!`;
          return mine ? "Hop, hop…" : `${who} is moving…`;
        }
        if (match.phase === "over") return st.winner === me ? "You reached 100. You win!" : `${nameOf(st.winner)} reached 100 first.`;
        if (st.turn === me) return spinMode === "auto" ? "Your turn. The spinner goes by itself…" : "Your turn. Spin!";
        return `${nameOf(st.turn)}'s turn…`;
      default:
        return "Match stopped.";
    }
  }

  function boardLabel() {
    const where = (n) => (n === 0 ? "at the start" : `on square ${n}`);
    const others = order.slice(1).map((p) => `${nameOf(p)} is ${where(shown[p])}`);
    return `Chutes and Ladders board. You are ${where(shown[me])}; ${listOf(others)}.`;
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    root.querySelector(".chutes-ladders").dataset.phase = phase;
    for (const [k, player] of order.entries()) {
      const { node, where } = pills[k];
      node.classList.toggle("active", phase === "playing" && (current ? current.player === player : st.turn === player));
      where.textContent = shown[player] === 0 ? "start" : `square ${shown[player]}`;
    }
    renderScore();
    status.textContent = statusText();
    const myTurn = phase === "playing" && st.turn === me && !pending;
    status.classList.toggle("mine", myTurn || current?.player === me);
    const canSpin = myTurn && match.canMove() && !spinner.spinning;
    spinBtn.disabled = !canSpin;
    spinBtn.textContent = spinner.spinning ? "Spinning…" : "Spin";
    spinBtn.classList.toggle("attention", canSpin);
    dial.classList.toggle("armed", canSpin);
    dial.dataset.who = current ? `p${colorOf(current.player)}` : st && phase === "playing" ? `p${colorOf(st.turn)}` : "";
    board.svg.setAttribute("aria-label", boardLabel());
    // Whoever is up next bobs on the spot until they spin.
    for (const p of seats) pawnOf(p).g.classList.toggle("waiting", phase === "playing" && !pending && st.turn === p);
    renderOver();
    setTabAlert(myTurn ? "Your turn" : null);
    if (myTurn && cuedPly !== st.ply) {
      cuedPly = st.ply;
      if (st.ply > 0 && st.last?.player !== me) play("turn");
      if (spinMode === "auto") {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(spinNow, AUTO_SPIN_DELAY);
      }
    }
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the winning pawn finish its trip first.
    if ((phase !== "over" && phase !== "aborted") || (phase === "over" && pending)) {
      overBox.hidden = true;
      if (overBox.firstChild) overBox.replaceChildren();
      return;
    }
    if (overBox.hidden) {
      overBox.hidden = false;
      requestAnimationFrame(() => overBox.scrollIntoView?.({ block: "nearest", behavior: still() ? "auto" : "smooth" }));
    }
    const st = match.state;
    const winner = phase === "over" ? st.winner : -1;
    const title = phase === "aborted" ? "Match stopped" : winner === me ? "You win!" : `${nameOf(winner)} wins`;
    let detail;
    if (phase === "aborted") detail = match.abortReason || "The match was stopped.";
    else {
      const w = winner;
      const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
      detail = `${nameOf(w)} reached 100 in ${plural(st.spins[w], "spin")}, with ${plural(st.climbs[w], "ladder")} and ${plural(st.slides[w], "chute")} on the way.`;
      const rest = seats.filter((p) => p !== w);
      if (duel) detail += ` ${nameOf(rest[0])} ${rest[0] === me ? "were" : "was"} on square ${st.pos[rest[0]] || "0"}.`;
      else detail += ` Behind: ${listOf(rest.map((p) => `${p === me ? "you" : nameOf(p)} on square ${st.pos[p] || "0"}`))}.`;
    }
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${listOf(seats.filter((p) => !rematch.seats?.includes(p)).map(nameOf))}…`;
    else if (rematch.them) rematchText = wantsRematch();
    overBox.replaceChildren(
      el("h2", { class: winner === me ? "win" : "", id: "cl-result" }, title),
      el("p", { class: `detail ${phase === "aborted" ? "bad" : ""}`, id: "cl-detail" }, detail),
      el(
        "div",
        { class: "cl-actions" },
        el(
          "button",
          { class: "btn primary", type: "button", id: "rematch", disabled: rematch.me, onclick: () => session.requestRematch() },
          rematch.them && !rematch.me ? "Accept rematch" : "Rematch",
        ),
        el("button", { class: "btn", type: "button", onclick: () => shell.leave() }, "Leave"),
      ),
      rematchText && el("p", { class: "rematch-status", id: "rematch-status" }, rematchText),
    );
  }

  function wantsRematch() {
    const voters = (rematch.seats || []).filter((p) => p !== me);
    return `${listOf(voters.map(nameOf))} ${voters.length === 1 ? "wants" : "want"} a rematch!`;
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    gen += 1;
    rematch = { me: false, them: false, seats: [] };
    clearTimeout(autoTimer);
    spinner.stop();
    shown = Array(count).fill(0);
    pending = 0;
    queue = Promise.resolve();
    current = null;
    log = [];
    cuedPly = -1;
    logList.replaceChildren();
    spinValue.textContent = "";
    board.fx.replaceChildren();
    for (const k of order.keys()) mark(0, `last-p${k}`);
    placePawns();
    const rivals = duel ? oppName : listOf(order.slice(1).map(nameOf));
    note.textContent = m === 1 ? `Playing against ${rivals}. Good luck!` : `Rematch #${m - 1}. Back to the start.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => {
      spinner.stop();
      toast(reason);
    });
    match.on("start", () => {
      const first = match.state.first;
      const who = first === me ? "you spin first" : `${nameOf(first)} spins first`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.first === "random" ? `Coin toss (drawn by ${duel ? "both" : "all"} browsers): ${who}.` : `Room setting: ${who}.`);
      toast(first === me ? "You spin first" : `${nameOf(first)} spins first`);
    });
    match.on("events", ({ events }) => {
      for (const ev of events) if (ev.type === "spin") enqueue(ev);
    });
    match.on("over", ({ winner }) => score[winner]++);
    router.start(match);
    render();
  }

  // The room's settings come from whoever created it (the robot uses ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = `${FINISH_TEXT[config.finish]} · ${config.sixAgain ? "a 6 spins again" : "one spin a turn"}`;
    newMatch();
  }
  function onSetup(msg) {
    if (me !== 0) begin(msg.config);
  }

  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const offs = [
    offMsg,
    session.on("rematch", (votes) => {
      rematch = votes;
      if (votes.them && !votes.me) toast(wantsRematch().replace("!", ""));
      render();
    }),
    session.on("rematch-start", () => config && newMatch()),
  ];
  placePawns();
  if (session.mode === "robot") begin(settings.get());
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      gen++;
      clearTimeout(autoTimer);
      spinner.stop();
      setTabAlert(null);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
    },
  };
}
