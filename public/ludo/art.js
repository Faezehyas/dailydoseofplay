// Ludo board geometry and art, drawn as inline SVG. Everything is laid out
// on the classic 15×15 grid with red's yard top left, then green, yellow and
// blue clockwise; the view turns the board so your yard is bottom left.
import { COLORS, STARTS, STARS, LOOP, LAST_LOOP, HOME, YARD } from "./rules.js";

export const U = 40; // one square, in board units
export const SIZE = 15 * U;
const NS = "http://www.w3.org/2000/svg";

export function s(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) node.setAttribute(k, String(v));
  for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export const r1 = (v) => Math.round(v * 10) / 10;

// ---------- geometry (canonical: red top left) ----------
// The 52 loop squares, from the left arm's top row, clockwise.
export const LOOP_CELLS = [];
for (let c = 0; c <= 5; c++) LOOP_CELLS.push([c, 6]);
for (let r = 5; r >= 0; r--) LOOP_CELLS.push([6, r]);
LOOP_CELLS.push([7, 0]);
for (let r = 0; r <= 5; r++) LOOP_CELLS.push([8, r]);
for (let c = 9; c <= 14; c++) LOOP_CELLS.push([c, 6]);
LOOP_CELLS.push([14, 7]);
for (let c = 14; c >= 9; c--) LOOP_CELLS.push([c, 8]);
for (let r = 9; r <= 14; r++) LOOP_CELLS.push([8, r]);
LOOP_CELLS.push([7, 14]);
for (let r = 14; r >= 9; r--) LOOP_CELLS.push([6, r]);
for (let c = 5; c >= 0; c--) LOOP_CELLS.push([c, 8]);
LOOP_CELLS.push([0, 7]);

// Each colour's five home column squares, from the loop inwards.
export const HOME_CELLS = [
  [1, 2, 3, 4, 5].map((c) => [c, 7]),
  [1, 2, 3, 4, 5].map((r) => [7, r]),
  [13, 12, 11, 10, 9].map((c) => [c, 7]),
  [13, 12, 11, 10, 9].map((r) => [7, r]),
];
const YARD_AT = [[0, 0], [9, 0], [9, 9], [0, 9]]; // each yard's top-left square
// The centre's triangles, as corners in squares, and where home tokens stand.
const TRI = [
  [[6, 6], [6, 9], [7.5, 7.5]],
  [[6, 6], [9, 6], [7.5, 7.5]],
  [[9, 6], [9, 9], [7.5, 7.5]],
  [[6, 9], [9, 9], [7.5, 7.5]],
];
// Home tokens stand in a row along their triangle's outer edge.
const ROW = [6.78, 7.26, 7.74, 8.22];
const HOME_SPOTS = [ROW.map((y) => [6.36, y]), ROW.map((x) => [x, 6.42]), ROW.map((y) => [8.64, y]), ROW.map((x) => [x, 8.72])];

// Turns canonical points k quarter turns clockwise round the centre.
export function rotator(k) {
  return ({ x, y }) => {
    for (let i = 0; i < k; i++) [x, y] = [SIZE - y, x];
    return { x, y };
  };
}

const mid = ([c, r]) => ({ x: (c + 0.5) * U, y: (r + 0.5) * U });

export function yardSpot(color, k) {
  const [c, r] = YARD_AT[color];
  return { x: (c + 3 + (k % 2 ? 1.15 : -1.15)) * U, y: (r + 3 + (k < 2 ? -1.15 : 1.15)) * U };
}

// Canonical centre of where a token of `color` at progress r stands (slot k for yard and home).
export function spotOf(color, r, k) {
  if (r === YARD) return yardSpot(color, k);
  if (r === HOME) {
    const [x, y] = HOME_SPOTS[color][k];
    return { x: x * U, y: y * U };
  }
  if (r > LAST_LOOP) return mid(HOME_CELLS[color][r - LAST_LOOP - 1]);
  return mid(LOOP_CELLS[(STARTS[color] + r) % LOOP]);
}

export const yardCentre = (color) => ({ x: (YARD_AT[color][0] + 3) * U, y: (YARD_AT[color][1] + 3) * U });

// ---------- shapes ----------
// Each colour carries its own mark too, so no one has to tell colours apart.
export const MARKS = ["circle", "triangle", "square", "diamond"];
export function markPath(color, size) {
  const h = size / 2;
  switch (MARKS[color]) {
    case "circle":
      return `M${-h} 0a${h} ${h} 0 1 0 ${size} 0a${h} ${h} 0 1 0 ${-size} 0Z`;
    case "triangle":
      return `M0 ${r1(-h * 1.1)}L${r1(h * 1.05)} ${r1(h * 0.8)}H${r1(-h * 1.05)}Z`;
    case "square":
      return `M${r1(-h * 0.86)} ${r1(-h * 0.86)}h${r1(h * 1.72)}v${r1(h * 1.72)}h${r1(-h * 1.72)}Z`;
    default:
      return `M0 ${r1(-h * 1.15)}L${r1(h * 1.05)} 0L0 ${r1(h * 1.15)}L${r1(-h * 1.05)} 0Z`;
  }
}

export function markSvg(color, size = 12, cls = "mark") {
  return s("svg", { class: `${cls} c-${COLORS[color]}`, viewBox: `${-size / 2 - 1} ${-size / 2 - 1} ${size + 2} ${size + 2}`, "aria-hidden": "true" }, s("path", { d: markPath(color, size) }));
}

export const starPath = (R, r = R * 0.45) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const d = i % 2 ? r : R;
    pts.push(`${r1(Math.cos(a) * d)} ${r1(Math.sin(a) * d)}`);
  }
  return `M${pts.join("L")}Z`;
};

// A turned pawn, standing on (0, 0): a base, a bell-shaped body, a collar
// and a round head, shaded by a gradient in its own colour.
export function pawnArt(color, id) {
  const name = COLORS[color];
  const fig = s(
    "g",
    { class: "pawn-fig" },
    s("path", { class: "pawn-base", d: "M-13 -5.5a13 5 0 0 0 26 0v-3.2a13 5 0 0 0-26 0Z", fill: `url(#ld-base-${name})` }),
    s("ellipse", { class: "pawn-base-top", cx: 0, cy: -8.7, rx: 13, ry: 5, fill: `url(#ld-body-${name})` }),
    s("path", { class: "pawn-body", d: "M-10.5 -9C-10 -16 -5 -20 -4.6 -26H4.6C5 -20 10 -16 10.5 -9C6 -6.4 -6 -6.4 -10.5 -9Z", fill: `url(#ld-body-${name})` }),
    s("ellipse", { class: "pawn-collar", cx: 0, cy: -26, rx: 7.2, ry: 2.6, fill: `url(#ld-base-${name})` }),
    s("circle", { class: "pawn-head", cx: 0, cy: -34, r: 8.6, fill: `url(#ld-head-${name})` }),
    s("ellipse", { class: "pawn-shine", cx: -3, cy: -37.5, rx: 2.8, ry: 2 }),
    s("path", { class: "pawn-mark", d: markPath(color, 8.4), transform: "translate(0 -15)" }),
  );
  // The ring that shows a token can move: dark outside, white inside, so it shows on any colour.
  const ring = s("g", { class: "pawn-ring" }, s("ellipse", { class: "ring-out", cx: 0, cy: -2, rx: 17, ry: 7 }), s("ellipse", { class: "ring-in", cx: 0, cy: -2, rx: 17, ry: 7 }));
  const g = s(
    "g",
    { class: `pawn c-${name}`, "data-id": id },
    s("ellipse", { class: "pawn-shadow", cx: 0, cy: -1, rx: 13, ry: 4.6 }),
    ring,
    s("g", { class: "pawn-lift" }, fig),
  );
  return { g, fig, lift: g.lastChild };
}

// Gradients shared by every pawn of a colour; stops read the theme's colour tokens.
export function pawnDefs() {
  return s(
    "defs",
    {},
    COLORS.map((name) => [
      s(
        "linearGradient",
        { id: `ld-body-${name}`, x1: 0, y1: 0, x2: 1, y2: 0 },
        s("stop", { offset: 0, style: `stop-color: color-mix(in srgb, var(--ld-${name}) 55%, #fff)` }),
        s("stop", { offset: 0.42, style: `stop-color: var(--ld-${name})` }),
        s("stop", { offset: 1, style: `stop-color: color-mix(in srgb, var(--ld-${name}) 62%, #000)` }),
      ),
      s(
        "linearGradient",
        { id: `ld-base-${name}`, x1: 0, y1: 0, x2: 1, y2: 0 },
        s("stop", { offset: 0, style: `stop-color: color-mix(in srgb, var(--ld-${name}) 80%, #fff)` }),
        s("stop", { offset: 0.5, style: `stop-color: color-mix(in srgb, var(--ld-${name}) 82%, #000)` }),
        s("stop", { offset: 1, style: `stop-color: color-mix(in srgb, var(--ld-${name}) 50%, #000)` }),
      ),
      s(
        "radialGradient",
        { id: `ld-head-${name}`, cx: 0.36, cy: 0.32, r: 0.75 },
        s("stop", { offset: 0, style: `stop-color: color-mix(in srgb, var(--ld-${name}) 45%, #fff)` }),
        s("stop", { offset: 0.5, style: `stop-color: var(--ld-${name})` }),
        s("stop", { offset: 1, style: `stop-color: color-mix(in srgb, var(--ld-${name}) 60%, #000)` }),
      ),
    ]),
  );
}

// ---------- the board ----------
// seated: colour -> player name (or null for an empty seat). k: quarter turns.
export function boardArt(seated, k) {
  const rot = rotator(k);
  const cells = [];
  const sq = ([c, r], cls) => s("rect", { class: `cell ${cls}`, x: c * U, y: r * U, width: U, height: U });
  LOOP_CELLS.forEach((cell, i) => {
    const start = STARTS.indexOf(i);
    cells.push(sq(cell, start >= 0 ? `start c-${COLORS[start]}` : "track"));
  });
  HOME_CELLS.forEach((list, color) => list.forEach((cell) => cells.push(sq(cell, `lane c-${COLORS[color]}`))));
  const yards = YARD_AT.map(([c, r], color) => {
    const name = COLORS[color];
    const sockets = [0, 1, 2, 3].map((n) => {
      const p = yardSpot(color, n);
      return s("g", {}, s("circle", { class: "socket", cx: p.x, cy: p.y, r: 0.62 * U }), s("circle", { class: "socket-in", cx: p.x, cy: p.y + 2, r: 0.46 * U }));
    });
    return s(
      "g",
      { class: `yard c-${name} ${seated[color] === null ? "empty" : ""}` },
      s("rect", { class: "yard-bg", x: c * U, y: r * U, width: 6 * U, height: 6 * U }),
      s("rect", { class: "yard-pad", x: (c + 0.8) * U, y: (r + 0.8) * U, width: 4.4 * U, height: 4.4 * U, rx: U * 0.7 }),
      sockets,
    );
  });
  // Arrows: out of each start square along the loop, and into each home column.
  const arrows = STARTS.map((start, color) => {
    const [c, r] = LOOP_CELLS[start];
    const [c2, r2] = LOOP_CELLS[start + 1];
    const deg = (Math.atan2(r2 - r, c2 - c) * 180) / Math.PI;
    return s("path", { class: `arrow c-${COLORS[color]}`, d: "M-9 -6L3 0L-9 6", transform: `translate(${(c + 0.5) * U} ${(r + 0.5) * U}) rotate(${deg})` });
  });
  const entries = STARTS.map((start, color) => {
    const [c, r] = LOOP_CELLS[(start + LAST_LOOP) % LOOP];
    const [c2, r2] = HOME_CELLS[color][0];
    const deg = (Math.atan2(r2 - r, c2 - c) * 180) / Math.PI;
    return s("path", { class: `entry c-${COLORS[color]}`, d: "M-8 -9L4 0L-8 9", transform: `translate(${(c + 0.5) * U} ${(r + 0.5) * U}) rotate(${deg})` });
  });
  const tris = TRI.map((pts, color) => s("path", { class: `tri c-${COLORS[color]}`, d: `M${pts.map(([c, r]) => `${c * U} ${r * U}`).join("L")}Z` }));
  const grid = s("path", {
    class: "grid",
    d: [...LOOP_CELLS, ...HOME_CELLS.flat()].map(([c, r]) => `M${c * U} ${r * U}h${U}v${U}h${-U}Z`).join(""),
  });
  const turned = s(
    "g",
    { transform: k ? `rotate(${90 * k} ${SIZE / 2} ${SIZE / 2})` : null },
    yards,
    cells,
    grid,
    s("g", { class: "tris" }, tris, s("path", { class: "tri-edge", d: `M${6 * U} ${6 * U}L${9 * U} ${9 * U}M${9 * U} ${6 * U}L${6 * U} ${9 * U}` })),
    s("rect", { class: "centre-edge", x: 6 * U, y: 6 * U, width: 3 * U, height: 3 * U }),
    arrows,
    entries,
  );
  // Upright layer: stars, marks and names don't turn with the board.
  const stars = STARS.map((i) => {
    const p = rot(mid(LOOP_CELLS[i]));
    return s("path", { class: "star", d: starPath(U * 0.36), transform: `translate(${r1(p.x)} ${r1(p.y)})` });
  });
  const centre = rot({ x: 7.5 * U, y: 7.5 * U });
  const labels = YARD_AT.map((_, color) => {
    const p = rot(yardCentre(color));
    const name = seated[color];
    const top = p.y < SIZE / 2;
    const y = top ? p.y - 2.62 * U : p.y + 2.62 * U;
    return s(
      "g",
      { class: `yard-label c-${COLORS[color]} ${name === null ? "empty" : ""}` },
      s("path", { class: "yard-mark", d: markPath(color, U * 1.3), transform: `translate(${r1(p.x)} ${r1(p.y)})` }),
      s("text", { class: "yard-name", x: r1(p.x), y: r1(y + 6) }, name === null ? "" : name.length > 14 ? `${name.slice(0, 13)}…` : name),
    );
  });
  return s(
    "g",
    { class: "board-art" },
    s("rect", { class: "frame", x: -10, y: -10, width: SIZE + 20, height: SIZE + 20, rx: 22 }),
    s("rect", { class: "felt", x: 0, y: 0, width: SIZE, height: SIZE, rx: 6 }),
    turned,
    stars,
    s("g", { class: "home-badge", transform: `translate(${centre.x} ${centre.y})` }, s("circle", { r: U * 0.42 }), s("path", { d: starPath(U * 0.26, U * 0.11) })),
    labels,
  );
}

// ---------- die ----------
const PIPS = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
export function dieFace(face, value) {
  face.replaceChildren(...(PIPS[value] || []).map((n) => Object.assign(document.createElement("i"), { style: `grid-area: s${n}` })));
  face.dataset.value = value || "";
}
