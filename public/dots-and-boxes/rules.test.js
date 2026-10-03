import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { RuleError } from "../engine/turn-match.js";
import {
  applyMove,
  newState,
  makeRules,
  normalizeConfig,
  geometry,
  lineEnds,
  freeLines,
  boxesClosedBy,
  sidesOf,
  timeLeft,
  DEFAULT_CONFIG,
  SIZES,
  DRAW,
} from "./rules.js";

const untimed = (size = 3, first = 0) => newState(first, { size, moveSeconds: 0, gameSeconds: 0 });
// Line numbers on an n×n board: horizontal row r (of dots), column c; vertical row r, column c (of dots).
const h = (n, r, c) => r * n + c;
const v = (n, r, c) => n * (n + 1) + r * (n + 1) + c;
const draw = (s, player, line, ms) => applyMove(s, player, ms === undefined ? { line } : { line, ms });

test("the board's wiring: every box has four lines, every line one or two boxes", () => {
  for (const n of SIZES) {
    const geo = geometry(n);
    assert.equal(geo.lines, 2 * n * (n + 1));
    assert.equal(geo.boxes, n * n);
    for (const [b, sides] of geo.boxLines.entries()) {
      assert.equal(new Set(sides).size, 4);
      for (const l of sides) assert.ok(geo.lineBoxes[l].includes(b));
    }
    const edges = geo.lineBoxes.filter((bs) => bs.length === 1).length;
    assert.equal(edges, 4 * n, "the outline has 4n lines with a box on one side only");
    for (let l = 0; l < geo.lines; l++) {
      const e = lineEnds(n, l);
      assert.equal(Math.abs(e.r2 - e.r1) + Math.abs(e.c2 - e.c1), 1, "a line joins two neighbouring dots");
      assert.ok(e.r1 >= 0 && e.c1 >= 0 && e.r2 <= n && e.c2 <= n);
    }
  }
  // Box 0 on 3×3 is top h(0,0), bottom h(1,0), left v(0,0), right v(0,1).
  assert.deepEqual(geometry(3).boxLines[0], [h(3, 0, 0), h(3, 1, 0), v(3, 0, 0), v(3, 0, 1)]);
});

test("settings: unknown values fall back to the defaults", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ size: 9, moveSeconds: 7, gameSeconds: "x", first: "me", level: "god" }), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ size: 6, moveSeconds: 20, gameSeconds: 300, first: "guest", level: "hard" }), { size: 6, moveSeconds: 20, gameSeconds: 300, first: "guest", level: "hard" });
  const s = newState(1, { size: 5, moveSeconds: 10, gameSeconds: 60 });
  assert.equal(s.turn, 1);
  assert.equal(s.lines.length, 60);
  assert.equal(s.boxes.length, 25);
  assert.equal(s.moveMs, 10_000);
  assert.deepEqual(s.clocks, [60_000, 60_000]);
});

test("the room picks who draws first; the coin toss only counts for 'random'", () => {
  assert.equal(makeRules({ first: "host" }).newState(1).turn, 0);
  assert.equal(makeRules({ first: "guest" }).newState(0).turn, 1);
  assert.equal(makeRules({ first: "random" }).newState(1).turn, 1);
  assert.equal(makeRules({ size: 6 }).newState(0).size, 6);
});

test("a line that closes nothing passes the turn", () => {
  const s = untimed(3);
  const events = draw(s, 0, h(3, 0, 0));
  assert.deepEqual(events, [{ type: "line", player: 0, line: h(3, 0, 0), boxes: [], again: false }]);
  assert.equal(s.lines[h(3, 0, 0)], 0);
  assert.equal(s.turn, 1);
  assert.equal(s.drawn, 1);
  assert.deepEqual(s.last, { player: 0, line: h(3, 0, 0), boxes: [] });
});

test("the fourth side claims the box and the same player draws again", () => {
  const s = untimed(3);
  draw(s, 0, h(3, 0, 0));
  draw(s, 1, h(3, 1, 0));
  draw(s, 0, v(3, 0, 0));
  assert.equal(sidesOf(s, 0), 3);
  assert.deepEqual(boxesClosedBy(s, v(3, 0, 1)), [0]);
  const events = draw(s, 1, v(3, 0, 1));
  assert.deepEqual(events, [{ type: "line", player: 1, line: v(3, 0, 1), boxes: [0], again: true }]);
  assert.equal(s.boxes[0], 1, "the box is player 1's, though player 0 drew three sides");
  assert.deepEqual(s.score, [0, 1]);
  assert.equal(s.turn, 1, "player 1 goes again");
  draw(s, 1, h(3, 3, 2));
  assert.equal(s.turn, 0, "then a line that closes nothing passes the turn");
});

test("one line can close two boxes at once, and still gives one extra line", () => {
  const s = untimed(3);
  // Boxes 0 and 1 share v(0,1): draw everything else around them.
  for (const [p, l] of [[0, h(3, 0, 0)], [1, h(3, 1, 0)], [0, v(3, 0, 0)], [1, h(3, 0, 1)], [0, h(3, 1, 1)], [1, v(3, 0, 2)]]) draw(s, p, l);
  assert.equal(s.turn, 0);
  const [ev] = draw(s, 0, v(3, 0, 1));
  assert.deepEqual(ev.boxes, [0, 1]);
  assert.equal(ev.again, true);
  assert.deepEqual(s.score, [2, 0]);
  assert.equal(s.turn, 0);
});

test("illegal moves throw RuleError", () => {
  const s = untimed(3);
  assert.throws(() => draw(s, 1, 0), RuleError, "out of turn");
  for (const move of [{}, { line: -1 }, { line: 24 }, { line: 1.5 }, { line: "3" }, null, { timeout: "yes" }]) {
    assert.throws(() => applyMove(s, 0, move), RuleError, JSON.stringify(move));
  }
  draw(s, 0, 5);
  assert.throws(() => draw(s, 1, 5), /already drawn/);
  assert.throws(() => applyMove(s, 1, { timeout: true }), /no clock/);
  assert.equal(s.drawn, 1, "nothing changed");
});

test("after the last box nothing more can be drawn", () => {
  const s = untimed(3);
  const rng = rngFromSeed("over");
  while (s.winner === -1) {
    const free = freeLines(s);
    draw(s, s.turn, free[Math.floor(rng() * free.length)]);
  }
  assert.equal(s.reason, "boxes");
  assert.equal(freeLines(s).length, 0);
  assert.throws(() => draw(s, s.turn, 0), /game is over/);
});

test("clocks: every line spends its own time, a box's extra line restarts the limit", () => {
  const s = newState(0, { size: 3, moveSeconds: 10, gameSeconds: 60 });
  assert.equal(timeLeft(s, 0), 10_000);
  assert.throws(() => draw(s, 0, h(3, 0, 0)), /time missing/);
  assert.throws(() => draw(s, 0, h(3, 0, 0), -1), /time missing/);
  assert.throws(() => draw(s, 0, h(3, 0, 0), 10_001), /Time ran out/);
  draw(s, 0, h(3, 0, 0), 9_000);
  assert.deepEqual(s.clocks, [51_000, 60_000]);
  draw(s, 1, h(3, 1, 0), 2_000);
  draw(s, 0, v(3, 0, 0), 9_000);
  draw(s, 1, v(3, 0, 1), 9_500); // closes box 0
  assert.equal(s.turn, 1);
  assert.equal(timeLeft(s, 1), 10_000, "the extra line gets a full limit");
  draw(s, 1, h(3, 3, 0), 9_999);
  assert.deepEqual(s.clocks, [42_000, 60_000 - 2_000 - 9_500 - 9_999]);
  // The game clock caps the line limit once it runs low.
  s.clocks[0] = 4_000;
  assert.equal(timeLeft(s, 0), 4_000);
  assert.throws(() => draw(s, 0, h(3, 3, 1), 4_001), /Time ran out/);
});

test("running out of time loses, whatever the boxes say", () => {
  const s = newState(0, { size: 3, moveSeconds: 10 });
  draw(s, 0, 0, 100);
  const events = applyMove(s, 1, { timeout: true });
  assert.deepEqual(events, [{ type: "timeout", player: 1 }]);
  assert.equal(s.winner, 0);
  assert.equal(s.reason, "timeout");
  assert.throws(() => draw(s, 0, 1, 100), /game is over/);
});

test("seeded full games: every line drawn once, turns follow the boxes, the score decides", () => {
  let draws = 0;
  for (const n of SIZES) {
    for (let g = 0; g < 60; g++) {
      const rng = rngFromSeed(`${n}/${g}`);
      const s = untimed(n, g % 2);
      let lines = 0;
      while (s.winner === -1) {
        const free = freeLines(s);
        // Mostly take a box when one is there, like people do.
        const takes = free.filter((l) => boxesClosedBy(s, l).length);
        const pool = takes.length && rng() < 0.8 ? takes : free;
        const line = pool[Math.floor(rng() * pool.length)];
        const mover = s.turn;
        const closes = boxesClosedBy(s, line).length;
        const events = draw(s, mover, line);
        lines++;
        assert.equal(events[0].boxes.length, closes);
        if (s.winner === -1) assert.equal(s.turn, closes ? mover : 1 - mover);
      }
      assert.equal(lines, 2 * n * (n + 1));
      assert.equal(s.drawn, lines);
      assert.equal(s.score[0] + s.score[1], n * n);
      assert.deepEqual(s.score, [0, 1].map((p) => s.boxes.filter((o) => o === p).length));
      const [a, b] = s.score;
      assert.equal(s.winner, a === b ? DRAW : a > b ? 0 : 1);
      if (s.winner === DRAW) {
        draws++;
        assert.equal(n % 2, 0, "only an even number of boxes can split evenly");
      }
    }
  }
  assert.ok(draws > 0, "some seeded games end level");
});

test("a scripted 3×3 game: rows one by one, the second player sweeps up", () => {
  const n = 3;
  const s = untimed(n, 0);
  // Every horizontal line first: 12 lines, none closes a box, turns alternate.
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) draw(s, s.turn, h(n, r, c));
  assert.equal(s.turn, 0);
  assert.equal(s.score.join(), "0,0");
  // Player 0 opens row 0 on the left; player 1 takes the whole row.
  draw(s, 0, v(n, 0, 0));
  for (const c of [1, 2, 3]) draw(s, 1, v(n, 0, c));
  assert.deepEqual(s.score, [0, 3]);
  // Player 1 must open row 1 (the last line of row 0 closed a box, so they're still on).
  draw(s, 1, v(n, 1, 0));
  assert.equal(s.turn, 0);
  for (const c of [1, 2, 3]) draw(s, 0, v(n, 1, c));
  draw(s, 0, v(n, 2, 3));
  for (const c of [2, 1, 0]) draw(s, 1, v(n, 2, c));
  assert.equal(s.winner, 1);
  assert.deepEqual(s.score, [3, 6]);
  assert.equal(s.reason, "boxes");
  assert.deepEqual(s.boxes, [1, 1, 1, 0, 0, 0, 1, 1, 1]);
});
