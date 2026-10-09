// Dots and Boxes page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is the paper, the pencil, the input,
// the motion and the sounds. The match state never waits for the screen:
// every line is queued and played out in order, the opponent's at a pace
// you can follow.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch } from "../engine/turn-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { makeRules, normalizeConfig, isTimed, timeLeft, geometry, lineEnds, DRAW } from "./rules.js";
import { startRobot } from "./robot.js";
import { mountSettings } from "./settings.js";
import { play } from "./sounds.js";

const U = 100; // one box, in board units
const PAD = 46; // paper around the dots, so the outer lines are easy to hit too
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const REPLAY_LINE_MAX = 1300; // the longest the other browser takes to replay one of your lines
// Milliseconds: your stroke, theirs, the pause before their first line and
// between their lines, a box's pop, and between two boxes closed at once.
const PACE = { mine: 170, theirs: 330, first: 300, gap: 200, after: 240, pop: 420, stagger: 110 };
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const NS = "http://www.w3.org/2000/svg";

const settings = mountSettings(document.getElementById("db-settings"), document.getElementById("lobby"));
// Read live, so a browser test can switch it mid-game.
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

startGameShell({
  slug: "dots-and-boxes",
  title: "Dots and Boxes",
  layout: "wide",
  createRobot: (session) => {
    const config = settings.get();
    return startRobot(session, { rules: makeRules(config), level: config.level });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

const r1 = (v) => Math.round(v * 10) / 10;
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

const clockText = (ms) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

function describeConfig(c, robot) {
  const parts = [`${c.size}×${c.size} boxes`];
  if (c.moveSeconds) parts.push(c.moveSeconds < 60 ? `${c.moveSeconds} s a line` : "1 min a line");
  if (c.gameSeconds) parts.push(`${c.gameSeconds / 60} min each`);
  if (!c.moveSeconds && !c.gameSeconds) parts.push("no clocks");
  if (robot) parts.push(`${LEVEL_NAME[c.level]} robot`);
  return parts.join(" · ");
}

// A steady "random" number in [-1, 1] for line or box `i`, so the hand-drawn
// wobble is the same on both screens and on every redraw.
function wobble(i, k) {
  let h = Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(k + 7, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

// ---------- board art ----------
// Where line l runs, with a little hand wobble: a quadratic curve from one
// dot to the other, sometimes drawn backwards, as a pencil would.
function stroke(n, l) {
  const e = lineEnds(n, l);
  let a = { x: e.c1 * U, y: e.r1 * U };
  let b = { x: e.c2 * U, y: e.r2 * U };
  if (wobble(l, 5) > 0) [a, b] = [b, a];
  const dx = (b.x - a.x) / U;
  const dy = (b.y - a.y) / U;
  const px = -dy;
  const py = dx;
  const j = (k, amount) => wobble(l, k) * amount;
  a = { x: a.x + dx * 3 + px * j(1, 1.6), y: a.y + dy * 3 + py * j(1, 1.6) };
  b = { x: b.x - dx * 3 + px * j(2, 1.6), y: b.y - dy * 3 + py * j(2, 1.6) };
  const c = { x: (a.x + b.x) / 2 + px * j(3, 4.2) + dx * j(4, 6), y: (a.y + b.y) / 2 + py * j(3, 4.2) + dy * j(4, 6) };
  const at = (t) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
  return { d: `M${r1(a.x)} ${r1(a.y)} Q${r1(c.x)} ${r1(c.y)} ${r1(b.x)} ${r1(b.y)}`, at, horizontal: e.horizontal };
}

// The tap target for a line: the diamond between its two dots and the two
// box centres beside it. The diamonds tile the board, so a tap anywhere
// lands on the nearest line.
function hitArea(n, l) {
  const e = lineEnds(n, l);
  const x = e.c1 * U;
  const y = e.r1 * U;
  const h = U / 2;
  const pts = e.horizontal ? [[x, y], [x + h, y - h], [x + U, y], [x + h, y + h]] : [[x, y], [x + h, y + h], [x, y + U], [x - h, y + h]];
  return pts.map((p) => p.join(",")).join(" ");
}

// A pencil hatch over a claimed box: short diagonal strokes, each a little
// off true, like shading done in a hurry.
function hatch(b) {
  const half = 30;
  const step = 12;
  const parts = [];
  for (let c = -2 * half + 9, i = 0; c <= 2 * half - 9; c += step, i++) {
    const p = c <= 0 ? [-half, c + half] : [c - half, half];
    const q = c <= 0 ? [c + half, -half] : [half, c - half];
    const j = (k) => wobble(b * 31 + i, k) * 2.6;
    // Every other stroke goes back the other way, as a hand would.
    const [u, w] = i % 2 ? [q, p] : [p, q];
    parts.push(`M${r1(u[0] + j(1))} ${r1(u[1] + j(2))}L${r1(w[0] + j(3))} ${r1(w[1] + j(4))}`);
  }
  return parts.join("");
}

function buildBoard(n) {
  const W = n * U;
  const geo = geometry(n);
  const pattern = s(
    "pattern",
    { id: "db-grid", width: U / 4, height: U / 4, patternUnits: "userSpaceOnUse", x: 0, y: 0 },
    s("path", { class: "grid-line", d: `M${U / 4} 0 H0 V${U / 4}` }),
  );
  const dots = [];
  for (let r = 0; r <= n; r++) {
    for (let c = 0; c <= n; c++) dots.push(s("circle", { class: "dot", cx: c * U, cy: r * U, r: 7.5, "data-dot": r * (n + 1) + c }));
  }
  const hits = [];
  for (let l = 0; l < geo.lines; l++) hits.push(s("polygon", { class: "hit", points: hitArea(n, l), "data-line": l }));
  const layer = (cls) => s("g", { class: cls });
  const parts = {
    boxes: layer("boxes"),
    lines: layer("lines"),
    preview: s("path", { class: "preview", pathLength: 1, visibility: "hidden" }),
    dots: s("g", { class: "dots" }, dots),
    focus: s("rect", { class: "focus-ring", rx: 18, visibility: "hidden" }),
    fx: layer("fx"),
    hits: s("g", { class: "hits" }, hits),
  };
  const svg = s(
    "svg",
    { class: "db-board", id: "db-board", viewBox: `${-PAD} ${-PAD} ${W + 2 * PAD} ${W + 2 * PAD}`, tabindex: 0, role: "application", "aria-roledescription": "board" },
    s("defs", {}, pattern),
    s("rect", { class: "paper", x: -PAD, y: -PAD, width: W + 2 * PAD, height: W + 2 * PAD, rx: 22 }),
    s("rect", { class: "grid", x: -PAD + 4, y: -PAD + 4, width: W + 2 * PAD - 8, height: W + 2 * PAD - 8, rx: 18, fill: "url(#db-grid)" }),
    parts.boxes,
    parts.lines,
    parts.preview,
    parts.dots,
    parts.focus,
    parts.fx,
    parts.hits,
  );
  return { svg, ...parts };
}

// ---------- keyboard ----------
// Lines on a half-step grid: horizontal ones at (even row, odd column),
// vertical ones at (odd row, even column).
function halfGrid(n, l) {
  const e = lineEnds(n, l);
  return e.horizontal ? [2 * e.r1, 2 * e.c1 + 1] : [2 * e.r1 + 1, 2 * e.c1];
}

// The nearest line in the arrow's direction. A step usually goes half a box,
// to a line across the other way, zigzagging along a row or down a column.
function stepCursor(n, l, dr, dc) {
  const [R, C] = halfGrid(n, l);
  const horizontal = R % 2 === 0;
  let best = null;
  for (let k = 0; k < geometry(n).lines; k++) {
    const [r, c] = halfGrid(n, k);
    const along = (r - R) * dr + (c - C) * dc;
    const side = dr ? c - C : r - R;
    if (along <= 0 || Math.abs(side) > along) continue;
    const lean = horizontal ? side < 0 : side > 0;
    const score = along * 100 + Math.abs(side) * 10 + (lean ? 1 : 0);
    if (!best || score < best.score) best = { k, score };
  }
  return best ? best.k : l;
}

// "B3" style names for dots: columns A, B, C… and rows 1, 2, 3… from the top left.
function lineName(n, l) {
  const e = lineEnds(n, l);
  const dot = (r, c) => `${String.fromCharCode(65 + c)}${r + 1}`;
  return `${e.horizontal ? "Across" : "Down"} from ${dot(e.r1, e.c1)} to ${dot(e.r2, e.c2)}`;
}

// ---------- the game ----------
function mountGame(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const initial = (name) => (String(name).trim()[0] || "?").toUpperCase();
  const initials = { [me]: initial(session.me.name), [opp]: initial(oppName) };
  const score = { wins: [0, 0] }; // draws once there is one
  const cls = (player) => (player === me ? "p0" : "p1"); // yours --mine, theirs --theirs (see data-you)
  let config = null;
  let rules = null;
  let geo = null;
  let board = null;
  let match = null;
  let m = 0;
  let gen = 0; // bumps on every new match, so the old match's animations stop
  let rematch = { me: false, them: false };
  let destroyed = false;
  let shownLines = [];
  let shownBoxes = [];
  let lineNodes = new Map();
  let queue = Promise.resolve();
  let pendingAll = 0; // lines not yet played out on screen
  let pendingOpp = 0; // the opponent's lines among them: input waits for these
  let current = null; // the opponent's line being played out: { player }
  let run = { player: -1, boxes: [] }; // boxes closed in the turn being played out
  let lastShown = -1; // who drew the last line shown
  let turnStart = null; // when the player to move started this line; null while their view replays
  let myRun = 0; // lines in your latest turn, which the other browser must replay
  let lastMover = -1;
  let forfeited = false;
  let claimed = false;
  let announced = false;
  let hover = null;
  let cursor = 0;
  let keyboard = false;
  let freshLine = -1; // the opponent's latest line, marked until you draw

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg)));

  // ---------- layout ----------
  const pills = [me, opp].map((player) => {
    const count = el("span", { class: "count" });
    const swatch = el("span", { class: "swatch", "aria-hidden": "true" }, initials[player]);
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"} mono`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    return { swatch, count, clock, last: 0 };
  });
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: cls });
  bar.update({ badges: { [me]: pills[0].swatch, [opp]: pills[1].swatch }, notes: { [me]: pills[0].count, [opp]: pills[1].count } });
  const status = el("p", { class: "db-status", id: "db-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "db-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left mono", id: "db-move-left", role: "timer", "aria-label": "Time left for this line" });
  const clocks = el("div", { class: "db-clocks", id: "db-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const boardWrap = el("div", { class: "db-board-wrap" });
  const tallyMine = el("span", { class: "fill mine" });
  const tallyTheirs = el("span", { class: "fill theirs" });
  const tallyText = el("p", { class: "db-tally-text", id: "db-tally" });
  const tally = el("div", { class: "db-tally" }, el("div", { class: "db-tally-bar", "aria-hidden": "true" }, tallyMine, tallyTheirs), tallyText);
  const overBox = el("div", { class: "db-over", id: "db-over", hidden: true });
  const configLine = el("p", { class: "db-config", id: "db-config" });
  const note = el("p", { class: "db-note", id: "db-note" });
  const cursorText = el("p", { class: "db-sr", id: "db-cursor", "aria-live": "polite" });

  root.append(
    el(
      "div",
      { class: "dots-boxes" },
      bar.node,
      status,
      clocks,
      el("div", { class: "db-main" }, boardWrap, el("div", { class: "db-side" }, tally, overBox)),
      configLine,
      note,
      cursorText,
    ),
  );

  // ---------- motion helpers ----------
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
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (live(g)) step(1);
        resolve();
      };
      const frame = (now) => {
        if (done) return;
        if (!live(g)) return finish();
        // A frame's timestamp can be a little before t0.
        const t = clamp01((now - t0) / ms);
        step(t);
        if (t < 1) requestAnimationFrame(frame);
        else finish();
      };
      requestAnimationFrame(frame);
      // Frames stop in a hidden tab; the queue must not.
      setTimeout(finish, ms + 150);
    });
  }

  // ---------- drawing ----------
  function lineNode(l, player) {
    const { d } = stroke(config.size, l);
    const g = s(
      "g",
      { class: `line ${cls(player)}`, "data-l": l },
      s("path", { class: "ink", d, pathLength: 1 }),
      s("path", { class: "sheen", d, pathLength: 1, transform: "translate(1.2 -1.4)" }),
    );
    board.lines.append(g);
    lineNodes.set(l, g);
    return g;
  }

  // The pencil draws the line from one dot to the other, a graphite tip leading.
  async function penStroke(l, player, ms, g) {
    const node = lineNode(l, player);
    const paths = node.querySelectorAll("path");
    const { at } = stroke(config.size, l);
    const tip = fast() ? null : s("circle", { class: `tip ${cls(player)}`, r: 6.5 });
    if (tip) board.fx.append(tip);
    const set = (t) => {
      for (const p of paths) p.style.strokeDashoffset = String(1 - t);
      if (tip) {
        const p = at(t);
        tip.setAttribute("cx", r1(p.x));
        tip.setAttribute("cy", r1(p.y));
      }
    };
    set(0);
    await tween(ms, (t) => set(easeOut(t)), g);
    tip?.remove();
    for (const p of paths) p.style.strokeDashoffset = "";
  }

  function boxNode(b, player) {
    const n = config.size;
    const cx = (b % n) * U + U / 2;
    const cy = Math.floor(b / n) * U + U / 2;
    const tilt = r1(wobble(b, 9) * 2.5);
    const inner = s(
      "g",
      { class: "box-in" },
      s("rect", { class: "tint", x: -38, y: -38, width: 76, height: 76, rx: 12, transform: `rotate(${tilt})` }),
      s("path", { class: "hatch", d: hatch(b), pathLength: 1 }),
      s("text", { class: "initial", x: 0, y: 2, transform: `rotate(${r1(wobble(b, 11) * 6)})` }, initials[player]),
    );
    const node = s("g", { class: `box ${cls(player)}`, transform: `translate(${cx} ${cy})`, "data-box": b }, inner);
    board.boxes.append(node);
    return { node, inner, cx, cy };
  }

  // A claimed box pops in: the tint springs out, the hatch scribbles itself
  // in, the initial lands, and a few flecks fly off.
  function popBox(b, player, g) {
    const { inner, cx, cy } = boxNode(b, player);
    if (fast() || !live(g)) return;
    const hatchPath = inner.querySelector(".hatch");
    const letter = inner.querySelector(".initial");
    const ring = s("circle", { class: `ring ${cls(player)}`, cx, cy, r: 20 });
    board.fx.append(ring);
    const flecks = [];
    for (let i = 0; i < 7; i++) {
      const node = s("circle", { class: `fleck ${cls(player)}`, r: 2.5 + (i % 3), style: "opacity: 0" });
      board.fx.append(node);
      flecks.push({ node, angle: (i / 7) * Math.PI * 2 + Math.random() * 0.5, dist: 46 + Math.random() * 22 });
    }
    tween(PACE.pop, (t) => {
      inner.setAttribute("transform", `scale(${(0.25 + 0.75 * easeBack(t)).toFixed(3)})`);
      hatchPath.style.strokeDashoffset = String(1 - clamp01(t * 1.6));
      const lt = clamp01((t - 0.25) / 0.75);
      letter.style.opacity = String(lt > 0 ? 1 : 0);
      letter.setAttribute("transform", `rotate(${r1(wobble(b, 11) * 6)}) scale(${(0.4 + 0.6 * easeBack(lt)).toFixed(3)})`);
      ring.setAttribute("r", r1(20 + 46 * easeOut(t)));
      ring.style.opacity = String(0.6 * (1 - t));
      for (const f of flecks) {
        // From the ring's edge outwards, fading in, then out as they fall.
        const d = 22 + f.dist * easeOut(t);
        f.node.setAttribute("cx", r1(cx + Math.cos(f.angle) * d));
        f.node.setAttribute("cy", r1(cy + Math.sin(f.angle) * d + 18 * t * t));
        f.node.style.opacity = String(t < 0.1 ? t / 0.1 : t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5);
      }
    }, g).then(() => {
      ring.remove();
      for (const f of flecks) f.node.remove();
      inner.removeAttribute("transform");
      hatchPath.style.strokeDashoffset = "";
      letter.style.opacity = "";
      letter.setAttribute("transform", `rotate(${r1(wobble(b, 11) * 6)})`);
    });
  }

  // A wave through boxes taken together: each one swells in turn.
  function ripple(boxes, g, gap = 70) {
    if (fast() || !live(g)) return;
    boxes.forEach((b, i) => {
      const inner = board.boxes.querySelector(`[data-box="${b}"] .box-in`);
      if (!inner) return;
      setTimeout(() => {
        if (!live(g)) return;
        tween(300, (t) => inner.setAttribute("transform", `scale(${(1 + 0.13 * Math.sin(Math.PI * t)).toFixed(3)})`), g).then(() => inner.removeAttribute("transform"));
      }, i * gap);
    });
  }

  // ---------- the queue ----------
  async function animateLine(ev, g) {
    const theirs = ev.player !== me;
    const pace = pendingAll > 3 ? 0.5 : 1; // catching up after a hidden tab or a fast run
    if (run.player !== ev.player) run = { player: ev.player, boxes: [] };
    if (theirs) {
      current = { player: ev.player };
      render();
      await wait((lastShown === ev.player ? PACE.gap : PACE.first) * pace, g);
      if (!live(g)) return;
    }
    shownLines[ev.line] = ev.player;
    if (theirs) freshLine = ev.line;
    if (hover === ev.line) hover = null;
    render();
    const ms = (theirs ? PACE.theirs : PACE.mine) * pace;
    play("line", { dur: ms / 1000, mine: !theirs });
    await penStroke(ev.line, ev.player, ms, g);
    if (!live(g)) return;
    lastShown = ev.player;
    for (const [i, b] of ev.boxes.entries()) {
      if (i) await wait(PACE.stagger * pace, g);
      if (!live(g)) return;
      shownBoxes[b] = ev.player;
      play("box", { k: run.boxes.length, mine: !theirs });
      run.boxes.push(b);
      popBox(b, ev.player, g);
      render();
    }
    if (!ev.again) {
      // The turn is over: a long run gets a wave and a flourish.
      if (run.boxes.length >= 3) {
        await wait(160 * pace, g);
        ripple(run.boxes, g);
        play("chain", { n: run.boxes.length, mine: !theirs });
      }
      run = { player: -1, boxes: [] };
    }
    if (theirs) await wait((ev.boxes.length ? PACE.after : PACE.after / 2) * pace, g);
    current = null;
  }

  function enqueue(ev) {
    const g = gen;
    const theirs = ev.player !== me;
    pendingAll++;
    if (theirs) pendingOpp++;
    queue = queue
      .then(() => (live(g) ? animateLine(ev, g) : null))
      .catch((err) => console.error(err))
      .finally(() => {
        if (!live(g)) return; // a rematch started: its own queue and counts took over
        pendingAll--;
        if (theirs) pendingOpp--;
        if (!pendingAll) settle(g);
        render();
      });
  }

  // Nothing left to play out: make sure the screen matches the rules, start
  // your clock if it's your turn, and celebrate a finished game.
  function settle(g) {
    current = null;
    syncBoard();
    if (match.phase === "playing" && match.state.turn === me && turnStart === null) {
      turnStart = performance.now();
      play("turn");
    }
    if (match.phase === "over" && !announced) {
      announced = true;
      const w = match.state.winner;
      play(w === DRAW ? "draw" : w === me ? "win" : "lose");
      if (w !== DRAW) {
        const mine = [];
        match.state.boxes.forEach((owner, b) => owner === w && mine.push(b));
        ripple(mine, g, 40);
      }
    }
  }

  function syncBoard() {
    const st = match?.state;
    if (!st) return;
    st.lines.forEach((p, l) => {
      if (p !== -1 && shownLines[l] === -1) {
        shownLines[l] = p;
        lineNode(l, p);
      }
    });
    st.boxes.forEach((p, b) => {
      if (p !== -1 && shownBoxes[b] === -1) {
        shownBoxes[b] = p;
        boxNode(b, p);
      }
    });
  }

  // ---------- input ----------
  const canDraw = () => match?.phase === "playing" && match.state.turn === me && !pendingOpp && turnStart !== null && match.canMove();

  function drawLine(l) {
    if (!match || match.phase !== "playing") return;
    const st = match.state;
    if (st.turn !== me) {
      play("nope");
      return toast(`Wait for ${oppName}`);
    }
    if (shownLines[l] !== -1 || st.lines[l] !== -1) {
      play("nope");
      return toast("That line is already drawn");
    }
    if (!canDraw()) return;
    const move = { line: l };
    if (isTimed(st)) {
      const ms = Math.round(performance.now() - turnStart);
      if (ms > timeLeft(st, me)) return forfeit();
      move.ms = ms;
    }
    hover = null;
    match.play(move);
  }

  function forfeit() {
    if (forfeited || !match.canMove()) return;
    forfeited = true;
    match.play({ timeout: true });
  }

  const lineAt = (target) => {
    const hit = target?.closest?.("[data-line]");
    return hit ? Number(hit.dataset.line) : null;
  };
  function setHover(l) {
    if (hover === l) return;
    hover = l;
    renderPreview();
  }

  function onPointer(e) {
    if (e.type === "pointerdown") keyboard = false;
    setHover(lineAt(e.target));
  }

  function onKey(e) {
    if (!geo) return;
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (step) {
      e.preventDefault();
      keyboard = true;
      cursor = stepCursor(config.size, cursor, ...step);
      announceCursor();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      keyboard = true;
      drawLine(cursor);
    } else return;
    renderPreview();
  }

  function announceCursor() {
    const owner = shownLines[cursor];
    cursorText.textContent = `${lineName(config.size, cursor)}: ${owner === -1 ? "free" : owner === me ? "your line" : `${oppName}'s line`}`;
  }

  // ---------- render ----------
  // The line under the pointer (or the keyboard cursor), sketched in faintly.
  function renderPreview() {
    if (!board) return;
    const focused = keyboard && document.activeElement === board.svg;
    const l = focused ? cursor : hover;
    const free = l != null && shownLines[l] === -1;
    const show = free && canDraw();
    board.preview.setAttribute("visibility", show ? "visible" : "hidden");
    if (show) {
      board.preview.setAttribute("d", stroke(config.size, l).d);
      board.preview.setAttribute("class", `preview ${cls(me)}`);
    }
    for (const dot of board.dots.querySelectorAll(".hot")) dot.classList.remove("hot");
    if (show) {
      const e = lineEnds(config.size, l);
      for (const [r, c] of [[e.r1, e.c1], [e.r2, e.c2]]) board.dots.querySelector(`[data-dot="${r * (config.size + 1) + c}"]`)?.classList.add("hot");
    }
    board.focus.setAttribute("visibility", focused ? "visible" : "hidden");
    if (focused) {
      const e = lineEnds(config.size, cursor);
      const [x, y] = [e.c1 * U, e.r1 * U];
      const box = e.horizontal ? { x: x - 4, y: y - 17, width: U + 8, height: 34 } : { x: x - 17, y: y - 4, width: 34, height: U + 8 };
      for (const [k, v] of Object.entries(box)) board.focus.setAttribute(k, v);
    }
    board.svg.classList.toggle("armed", canDraw());
  }

  function shownScore() {
    const out = [0, 0];
    for (const p of shownBoxes) if (p !== -1) out[p]++;
    return out;
  }

  function renderPills(counts) {
    const st = match?.state;
    bar.update({ turn: match?.phase !== "playing" ? -1 : current ? current.player : pendingOpp ? -1 : st.turn });
    for (const [k, player] of [me, opp].entries()) {
      const pill = pills[k];
      const n = counts[player];
      pill.count.textContent = `${n} box${n === 1 ? "" : "es"}`;
      if (n > pill.last && !fast()) {
        pill.count.classList.remove("bump");
        void pill.count.offsetWidth;
        pill.count.classList.add("bump");
      }
      pill.last = n;
    }
  }

  function renderTally(counts) {
    const total = geo ? geo.boxes : 0;
    const left = total - counts[0] - counts[1];
    tallyMine.style.width = total ? `${(counts[me] / total) * 100}%` : "0%";
    tallyTheirs.style.width = total ? `${(counts[opp] / total) * 100}%` : "0%";
    tallyText.replaceChildren(
      el("b", { class: "mine" }, `You ${counts[me]}`),
      el("span", {}, left ? ` · ${left} left · ` : " · all taken · "),
      el("b", { class: "theirs" }, `${counts[opp]} ${oppName}`),
    );
  }

  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who draws first…" : "Getting ready…";
      case "playing": {
        if (current || pendingOpp) return run.player === opp && run.boxes.length ? `${oppName} took ${run.boxes.length} box${run.boxes.length > 1 ? "es" : ""}…` : `${oppName} is drawing…`;
        const again = st.last?.player === st.turn && st.last.boxes.length > 0;
        if (st.turn === me) return again ? "Box! Draw another line." : "Your turn. Draw a line.";
        return again ? `${oppName} closed a box and goes again…` : `${oppName}'s turn…`;
      }
      case "over": {
        if (pendingAll) return current ? `${oppName} is drawing…` : "The last box…";
        const [a, b] = [st.score[me], st.score[opp]];
        if (st.reason === "timeout") return st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
        if (st.winner === DRAW) return `A draw, ${a}–${b}.`;
        return st.winner === me ? `You win ${a}–${b}!` : `${oppName} wins ${b}–${a}.`;
      }
      default:
        return "Match stopped.";
    }
  }

  function renderClocks() {
    const st = match?.state;
    const playing = match?.phase === "playing";
    clocks.hidden = !st || !isTimed(st) || match.phase === "over";
    if (clocks.hidden) return;
    const elapsed = playing ? elapsedNow() : 0;
    for (const [k, player] of [me, opp].entries()) {
      const { clock } = pills[k];
      const running = playing && st.turn === player;
      clock.classList.toggle("active", running);
      clock.hidden = !st.clocks;
      if (!st.clocks) continue;
      const ms = st.clocks[player] - (running ? elapsed : 0);
      clock.textContent = clockText(ms);
      clock.classList.toggle("low", running && ms < 10_000);
    }
    const left = playing ? Math.max(0, timeLeft(st, st.turn) - elapsed) : 0;
    moveBar.hidden = !(playing && st.moveMs);
    moveBarFill.style.width = st.moveMs ? `${Math.min(1, left / st.moveMs) * 100}%` : "0%";
    moveBar.classList.toggle("mine", playing && st.turn === me);
    moveBar.classList.toggle("low", left < 5000);
    moveLeft.textContent = playing && st.moveMs ? `${Math.ceil(left / 1000)} s` : "";
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    root.querySelector(".dots-boxes").dataset.phase = phase;
    // Coral is whoever moves first this match, on every screen.
    root.querySelector(".dots-boxes").dataset.you = st ? (st.first === me ? "a" : "b") : "";
    const counts = shownScore();
    renderPills(counts);
    bar.update({ score });
    renderTally(counts);
    renderClocks();
    status.textContent = statusText();
    const myTurn = phase === "playing" && st.turn === me && !pendingOpp;
    status.classList.toggle("mine", myTurn);
    if (board) {
      board.svg.dataset.turn = phase === "playing" ? (st.turn === me ? "mine" : "theirs") : "";
      for (const node of board.lines.querySelectorAll(".fresh")) node.classList.remove("fresh");
      if (freshLine >= 0) lineNodes.get(freshLine)?.classList.add("fresh");
      board.svg.setAttribute("aria-label", `Dots and Boxes board, ${config.size} by ${config.size} boxes. You have ${counts[me]}, ${oppName} has ${counts[opp]}. ${myTurn ? "Your turn: arrow keys pick a line, Enter draws it." : ""}`);
    }
    renderPreview();
    renderOver();
    setTabAlert(myTurn ? "Your turn" : null);
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the last line and its boxes play out first.
    if ((phase !== "over" && phase !== "aborted") || (phase === "over" && pendingAll)) {
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
    let title;
    let detail;
    if (phase === "aborted") {
      title = "Match stopped";
      detail = match.abortReason || "The match was stopped.";
    } else if (st.reason === "timeout") {
      title = winner === me ? "You win!" : `${oppName} wins`;
      detail = winner === me ? `${oppName}'s clock ran out, with the boxes at ${st.score[me]}–${st.score[opp]}.` : `Your clock ran out, with the boxes at ${st.score[me]}–${st.score[opp]}.`;
    } else {
      const [a, b] = [st.score[me], st.score[opp]];
      title = winner === DRAW ? "It's a draw" : winner === me ? "You win!" : `${oppName} wins`;
      detail = winner === DRAW ? `${a} boxes each: an even split.` : winner === me ? `You took ${a} of ${a + b} boxes; ${oppName} took ${b}.` : `${oppName} took ${b} of ${a + b} boxes; you took ${a}.`;
    }
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${oppName}…`;
    else if (rematch.them) rematchText = `${oppName} wants a rematch!`;
    overBox.replaceChildren(
      el("h2", { class: winner === me ? "win" : winner === DRAW ? "draw" : "", id: "db-result" }, title),
      el("p", { class: `detail ${phase === "aborted" ? "bad" : ""}`, id: "db-detail" }, detail),
      el(
        "div",
        { class: "db-actions" },
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

  // ---------- clocks ----------
  // About how long the other browser takes to replay `lines` of yours (the robot replays nothing).
  const replayTime = (lines) => (lines && session.mode !== "robot" ? PACE.first + (lines - 1) * PACE.gap + lines * (PACE.theirs + PACE.after) : 0);
  const elapsedNow = () => (turnStart === null ? 0 : Math.max(0, performance.now() - turnStart));

  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !isTimed(match.state)) return;
    const st = match.state;
    renderClocks();
    if (turnStart === null) return;
    const left = timeLeft(st, st.turn) - elapsedNow();
    if (st.turn === me && left <= 0) forfeit();
    else if (st.turn === opp && left <= -(CLAIM_GRACE_MS + myRun * REPLAY_LINE_MAX) && !claimed) {
      // Their browser should have forfeited by now (closed laptop, frozen tab).
      claimed = true;
      match.send({ t: "abort", reason: "your clock ran out" });
      match.abort(`${oppName}'s clock ran out and their browser stopped answering.`);
    }
  }
  const ticker = setInterval(tick, 200);

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    gen += 1;
    rematch = { me: false, them: false };
    shownLines = Array(geo.lines).fill(-1);
    shownBoxes = Array(geo.boxes).fill(-1);
    lineNodes = new Map();
    board.lines.replaceChildren();
    board.boxes.replaceChildren();
    board.fx.replaceChildren();
    queue = Promise.resolve();
    pendingAll = 0;
    pendingOpp = 0;
    current = null;
    run = { player: -1, boxes: [] };
    lastShown = -1;
    turnStart = null;
    myRun = 0;
    lastMover = -1;
    forfeited = false;
    claimed = false;
    announced = false;
    hover = null;
    freshLine = -1;
    for (const pill of pills) pill.last = 0;
    note.textContent = m === 1 ? `Playing against ${oppName}. Good luck!` : `Rematch #${m - 1}. Fresh paper, same settings.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => toast(reason));
    match.on("start", () => {
      const first = match.state.first;
      if (first !== me) turnStart = performance.now();
      else settle(gen);
      const who = first === me ? "you draw first" : `${oppName} draws first`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.first === "random" ? `Coin toss (drawn by both browsers): ${who}.` : `Room setting: ${who}.`);
      toast(first === me ? "You draw first" : `${oppName} draws first`);
    });
    match.on("events", ({ player, events }) => {
      for (const ev of events) {
        if (ev.type === "line") enqueue(ev);
        if (ev.type === "timeout") toast(player === me ? "Your time ran out" : `${oppName} ran out of time`);
      }
      const st = match.state;
      if (player === me) {
        myRun = lastMover === me ? myRun + 1 : 1;
        freshLine = -1;
      }
      lastMover = player;
      const now = performance.now();
      if (st.winner !== -1) turnStart = null;
      // Their browser starts their clock once it has replayed your lines.
      else if (st.turn === opp) turnStart = player === me ? now + replayTime(myRun) : now;
      else if (player === me) turnStart = now;
      else turnStart = pendingOpp ? null : now;
    });
    match.on("over", ({ winner }) => {
      if (winner === DRAW) score.draws = (score.draws ?? 0) + 1;
      else score.wins[winner]++;
    });
    router.start(match);
    render();
  }

  // The room's settings come from whoever created it (the robot uses ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    geo = geometry(config.size);
    board = buildBoard(config.size);
    boardWrap.replaceChildren(board.svg);
    board.svg.addEventListener("pointermove", onPointer);
    board.svg.addEventListener("pointerdown", onPointer);
    board.svg.addEventListener("pointerleave", () => setHover(null));
    board.svg.addEventListener("click", (e) => {
      const l = lineAt(e.target);
      if (l !== null) {
        cursor = l;
        drawLine(l);
      }
    });
    board.svg.addEventListener("keydown", onKey);
    board.svg.addEventListener("focus", () => {
      if (keyboard) announceCursor();
      renderPreview();
    });
    board.svg.addEventListener("blur", renderPreview);
    board.svg.addEventListener("keyup", (e) => e.key === "Tab" && ((keyboard = true), announceCursor(), renderPreview()));
    board.svg.closest(".dots-boxes").style.setProperty("--db-n", config.size);
    configLine.textContent = describeConfig(config, session.mode === "robot");
    newMatch();
  }
  function onSetup(msg) {
    if (me === 1) begin(msg.config);
  }

  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const offs = [
    offMsg,
    session.on("rematch", (votes) => {
      rematch = votes;
      if (votes.them && !votes.me) toast(`${oppName} wants a rematch`);
      render();
    }),
    session.on("rematch-start", () => config && newMatch()),
  ];
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
      clearInterval(ticker);
      setTabAlert(null);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
    },
  };
}
