import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { chooseMove, evaluate, thinkTime } from "./robot.js";
import { newState, applyMove, freeLines, geometry, boxesClosedBy, sidesOf, DRAW } from "./rules.js";

const LEVELS = ["easy", "medium", "hard"];
const untimed = (size, first = 0) => newState(first, { size, moveSeconds: 0, gameSeconds: 0 });
const h = (n, r, c) => r * n + c;
const v = (n, r, c) => n * (n + 1) + r * (n + 1) + c;
const givesThirdSide = (s, l) => geometry(s.size).lineBoxes[l].some((b) => sidesOf(s, b) === 2);
const safeLines = (s) => freeLines(s).filter((l) => !givesThirdSide(s, l) && !boxesClosedBy(s, l).length);

// Plays random lines (a box when offered, safe lines while they last).
function randomPosition(size, seed, freeLeft) {
  const rng = rngFromSeed(seed);
  const s = untimed(size, 0);
  while (s.winner === -1 && freeLines(s).length > freeLeft) {
    const free = freeLines(s);
    const takes = free.filter((l) => boxesClosedBy(s, l).length);
    const safe = safeLines(s);
    const pool = takes.length ? takes : safe.length && rng() < 0.9 ? safe : free;
    applyMove(s, s.turn, { line: pool[Math.floor(rng() * pool.length)] });
  }
  return s;
}

// Every horizontal line drawn: each row of boxes is a chain from edge to edge.
function rows(n) {
  const s = untimed(n, 0);
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) {
    s.lines[h(n, r, c)] = (r + c) % 2;
    s.drawn++;
  }
  return s;
}

function playGame(size, levels, seed) {
  const rng = rngFromSeed(seed);
  const s = untimed(size, 0);
  while (s.winner === -1) {
    const move = chooseMove(s, s.turn, rng, { level: levels[s.turn] });
    assert.ok(Number.isInteger(move.line) && s.lines[move.line] === -1, `a free line: ${JSON.stringify(move)}`);
    applyMove(s, s.turn, move);
  }
  return s;
}

test("every level always picks a free line", () => {
  for (const size of [3, 4, 5, 6]) {
    for (let g = 0; g < 6; g++) {
      const s = randomPosition(size, `legal ${size} ${g}`, Math.floor((g / 6) * 2 * size * (size + 1)));
      if (s.winner !== -1) continue;
      for (const level of LEVELS) {
        const { line } = chooseMove(s, s.turn, rngFromSeed(g), { level });
        assert.equal(s.lines[line], -1, `${level} on ${size}×${size}`);
      }
    }
  }
});

test("Medium and Hard take a box they are offered; Easy usually does", () => {
  const n = 4;
  const s = untimed(n, 0);
  for (const l of [h(n, 0, 0), h(n, 1, 0), v(n, 0, 0)]) applyMove(s, s.turn, { line: l });
  assert.equal(s.turn, 1);
  for (const level of ["medium", "hard"]) {
    for (let seed = 0; seed < 20; seed++) assert.equal(chooseMove(s, 1, rngFromSeed(seed), { level }).line, v(n, 0, 1), level);
  }
  let took = 0;
  for (let seed = 0; seed < 100; seed++) took += chooseMove(s, 1, rngFromSeed(seed), { level: "easy" }).line === v(n, 0, 1);
  assert.ok(took >= 70, `Easy took the box ${took} times in 100`);
});

test("Medium never draws a box's third side while a safe line is left, nor Hard early on", () => {
  for (let g = 0; g < 40; g++) {
    const s = randomPosition(5, `safe ${g}`, 30 + (g % 12));
    if (s.winner !== -1 || !safeLines(s).length || freeLines(s).some((l) => boxesClosedBy(s, l).length)) continue;
    const { line } = chooseMove(s, s.turn, rngFromSeed(g), { level: "medium" });
    assert.ok(!givesThirdSide(s, line), `medium gave a third side in game ${g}`);
  }
  // Hard may sacrifice on purpose late on, to win the fight over the long
  // chains; early, with many safe lines left, it plays one of them.
  for (let g = 0; g < 20; g++) {
    const s = randomPosition(6, `early ${g}`, 70);
    const { line } = chooseMove(s, s.turn, rngFromSeed(g), { level: "hard" });
    assert.ok(!givesThirdSide(s, line), `hard gave a third side in game ${g}`);
  }
});

test("Hard keeps control with the double-cross: it takes all but two of a long chain", () => {
  // Four chains of four (the rows); the opponent opens row 0 at the left edge.
  const n = 4;
  for (const level of ["hard", "medium"]) {
    const s = rows(n);
    s.turn = 0;
    applyMove(s, 0, { line: v(n, 0, 0) });
    assert.equal(s.turn, 1);
    const rng = rngFromSeed(level);
    while (s.turn === 1 && s.winner === -1) applyMove(s, 1, chooseMove(s, 1, rng, { level }));
    if (level === "hard") {
      assert.deepEqual(s.boxes.slice(0, 4), [1, 1, -1, -1], "took two, left two");
      assert.equal(s.last.line, v(n, 0, 4), "and drew the far end, so the last two can only be taken");
      // The opponent takes both with one line, then must open the next row for Hard.
      const [ev] = applyMove(s, 0, { line: v(n, 0, 3) });
      assert.deepEqual(ev.boxes, [2, 3]);
      assert.deepEqual(s.score, [2, 2]);
      assert.equal(s.turn, 0);
    } else {
      assert.deepEqual(s.boxes.slice(0, 4), [1, 1, 1, 1], "Medium greedily takes all four, then has to open a row");
    }
  }
});

test("Hard's endgame value matches an exhaustive search", () => {
  // Exhaustive: net boxes for the player to move.
  const geo = geometry(3);
  const memo = new Map();
  function exact(lines) {
    const key = lines.join("");
    if (memo.has(key)) return memo.get(key);
    let best = -Infinity;
    for (let l = 0; l < lines.length; l++) {
      if (lines[l]) continue;
      lines[l] = 1;
      const closed = geo.lineBoxes[l].filter((b) => geo.boxLines[b].every((x) => lines[x])).length;
      best = Math.max(best, closed ? closed + exact(lines) : -exact(lines));
      lines[l] = 0;
    }
    const value = best === -Infinity ? 0 : best;
    memo.set(key, value);
    return value;
  }
  const valueOf = (s, l) => {
    const lines = s.lines.map((x) => (x === -1 ? 0 : 1));
    lines[l] = 1;
    const closed = geo.lineBoxes[l].filter((b) => geo.boxLines[b].every((x) => lines[x])).length;
    return closed ? closed + exact(lines) : -exact(lines);
  };
  let checked = 0;
  for (let g = 0; g < 200; g++) {
    const s = randomPosition(3, `exact ${g}`, 8 + (g % 6));
    if (s.winner !== -1) continue;
    const lines = s.lines.map((x) => (x === -1 ? 0 : 1));
    const best = exact(lines);
    if (!freeLines(s).some((l) => boxesClosedBy(s, l).length)) assert.equal(evaluate(s), best, `value of position ${g}`);
    const { line } = chooseMove(s, s.turn, rngFromSeed(g), { level: "hard" });
    assert.equal(valueOf(s, line), best, `Hard's line in position ${g} is one of the best`);
    checked++;
  }
  assert.ok(checked > 150);
});

test("Hard beats Easy and Medium most of the time; Medium beats Easy", () => {
  const pairs = [["hard", "easy", 0.9], ["hard", "medium", 0.75], ["medium", "easy", 0.75]];
  for (const [a, b, rate] of pairs) {
    let wins = 0;
    const games = 40;
    for (let g = 0; g < games; g++) {
      const seat = g % 2; // take turns going first
      const levels = seat ? [b, a] : [a, b];
      const s = playGame(4, levels, `${a}-${b}-${g}`);
      if (s.winner === seat) wins++;
    }
    assert.ok(wins >= games * rate, `${a} beat ${b} ${wins} times in ${games}`);
  }
});

test("robot vs robot always finishes with legal lines, on every board and level", () => {
  for (const size of [3, 4, 5, 6]) {
    for (let g = 0; g < 6; g++) {
      const s = playGame(size, [LEVELS[g % 3], LEVELS[(g + 1) % 3]], `rr ${size} ${g}`);
      assert.notEqual(s.winner, -1);
      assert.equal(s.score[0] + s.score[1], size * size);
      if (s.winner === DRAW) assert.equal(s.score[0], s.score[1]);
    }
  }
});

test("Hard answers well under 100 ms on the biggest board", () => {
  playGame(6, ["hard", "hard"], "warm-up");
  let worst = 0;
  for (let g = 0; g < 6; g++) {
    const rng = rngFromSeed(`time ${g}`);
    const s = untimed(6, 0);
    while (s.winner === -1) {
      const level = s.turn === 0 ? "hard" : "medium";
      const t0 = performance.now();
      const move = chooseMove(s, s.turn, rng, { level });
      if (level === "hard") worst = Math.max(worst, performance.now() - t0);
      applyMove(s, s.turn, move);
    }
  }
  assert.ok(worst < 100, `slowest Hard move ${worst.toFixed(1)} ms`);
});

test("the robot pauses longer to start a turn than to take another box", () => {
  const s = untimed(3, 0);
  const rng = rngFromSeed("think");
  assert.ok(thinkTime(s, 0, rng) >= 650);
  s.last = { player: 0, line: 0, boxes: [0] };
  assert.ok(thinkTime(s, 0, rng) < 650);
});
