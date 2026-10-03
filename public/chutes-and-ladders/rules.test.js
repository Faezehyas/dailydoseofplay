import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { applyMove, newState, makeRules, normalizeConfig, walk, cellOf, LADDERS, CHUTES, LAST, DEFAULT_CONFIG, DRAWS } from "./rules.js";

// An rng that makes the spinner show `v` (1–6).
const spinOf = (v) => () => (v - 1 + 0.5) / 6;
const spin = (state, player, v) => applyMove(state, player, { type: "spin" }, spinOf(v))[0];

test("the board is the classic one: 9 ladders up, 10 chutes down, no square both", () => {
  assert.equal(Object.keys(LADDERS).length, 9);
  assert.equal(Object.keys(CHUTES).length, 10);
  for (const [a, b] of Object.entries(LADDERS)) assert.ok(Number(a) < b && b <= LAST);
  for (const [a, b] of Object.entries(CHUTES)) assert.ok(Number(a) > b && b >= 1);
  const ends = [...Object.keys(LADDERS), ...Object.keys(CHUTES)].map(Number);
  assert.equal(new Set(ends).size, ends.length);
  // No ladder or chute ends where another one starts.
  for (const to of [...Object.values(LADDERS), ...Object.values(CHUTES)]) assert.ok(!LADDERS[to] && !CHUTES[to], `${to} chains`);
});

test("squares snake up the board: 1 bottom left, 10 bottom right, 11 above 10, 100 top left", () => {
  assert.deepEqual(cellOf(1), { row: 0, col: 0 });
  assert.deepEqual(cellOf(10), { row: 0, col: 9 });
  assert.deepEqual(cellOf(11), { row: 1, col: 9 });
  assert.deepEqual(cellOf(20), { row: 1, col: 0 });
  assert.deepEqual(cellOf(21), { row: 2, col: 0 });
  assert.deepEqual(cellOf(100), { row: 9, col: 0 });
  const seen = new Set();
  for (let n = 1; n <= LAST; n++) seen.add(`${cellOf(n).row},${cellOf(n).col}`);
  assert.equal(seen.size, LAST);
});

test("a spin moves the pawn, passes the turn and is drawn from rng", () => {
  const st = newState(0);
  const ev = spin(st, 0, 3);
  assert.deepEqual(ev.path, [1, 2, 3]);
  assert.equal(st.pos[0], 3);
  assert.equal(st.turn, 1);
  assert.equal(st.spins[0], 1);
  assert.equal(st.last, ev);
  for (let v = 1; v <= 6; v++) {
    const s2 = newState(0);
    s2.pos[0] = 10;
    assert.equal(spin(s2, 0, v).spin, v);
  }
});

test("stopping at a ladder's foot climbs it; stopping at a chute's top slides down", () => {
  const st = newState(0);
  let ev = spin(st, 0, 1);
  assert.deepEqual(ev.jump, { kind: "ladder", from: 1, to: 38 });
  assert.equal(st.pos[0], 38);
  assert.equal(st.climbs[0], 1);
  st.pos[1] = 82;
  ev = spin(st, 1, 5);
  assert.deepEqual(ev.jump, { kind: "chute", from: 87, to: 24 });
  assert.equal(ev.landed, 87);
  assert.equal(st.pos[1], 24);
  assert.equal(st.slides[1], 1);
});

test("only the square you stop on counts, not the ones you hop over", () => {
  const st = newState(0);
  st.pos[0] = 14;
  const ev = spin(st, 0, 3); // over 16 (a chute) to 17
  assert.equal(ev.jump, null);
  assert.equal(st.pos[0], 17);
});

test("the ladder to 100 wins", () => {
  const st = newState(0);
  st.pos[0] = 77;
  const ev = spin(st, 0, 3);
  assert.equal(ev.jump.to, 100);
  assert.ok(ev.win);
  assert.equal(st.winner, 0);
  assert.throws(() => spin(st, 1, 2), /over/);
});

test("finish rules: exact (stay), bounce back, or any spin", () => {
  assert.deepEqual(walk(97, 5, "exact"), { path: [], to: 97, bounce: false, stay: true });
  assert.deepEqual(walk(97, 3, "exact"), { path: [98, 99, 100], to: 100, bounce: false, stay: false });
  assert.deepEqual(walk(97, 5, "bounce"), { path: [98, 99, 100, 99, 98], to: 98, bounce: true, stay: false });
  assert.deepEqual(walk(97, 5, "any"), { path: [98, 99, 100], to: 100, bounce: false, stay: false });

  const exact = newState(0);
  exact.pos[0] = 97;
  const ev = spin(exact, 0, 5);
  assert.ok(ev.stay && !ev.win);
  assert.equal(exact.pos[0], 97);
  assert.equal(exact.turn, 1, "staying still uses the turn");

  // Bouncing back can land on a chute: 99 → 100 → 98, down to 78.
  const bounce = newState(0, { finish: "bounce" });
  bounce.pos[0] = 99;
  const bev = spin(bounce, 0, 3);
  assert.ok(bev.bounce);
  assert.equal(bev.landed, 98);
  assert.deepEqual(bev.jump, { kind: "chute", from: 98, to: 78 });
  assert.equal(bounce.pos[0], 78);

  const any = newState(0, { finish: "any" });
  any.pos[0] = 99;
  assert.ok(spin(any, 0, 6).win);
  assert.equal(any.winner, 0);
});

test("with 'spin again on a 6', a 6 keeps the turn; a winning 6 still ends the game", () => {
  const st = newState(0, { sixAgain: true });
  const ev = spin(st, 0, 6);
  assert.ok(ev.again);
  assert.equal(st.turn, 0);
  spin(st, 0, 2);
  assert.equal(st.turn, 1);
  st.pos[1] = 94;
  const win = spin(st, 1, 6);
  assert.ok(win.win && !win.again);
  const classic = newState(0);
  spin(classic, 0, 6);
  assert.equal(classic.turn, 1, "classic: a 6 is just a 6");
});

test("illegal moves throw RuleError: out of turn, unknown move, after the game", () => {
  const st = newState(1);
  assert.throws(() => spin(st, 0, 3), (e) => e.name === "RuleError" && /turn/.test(e.message));
  assert.throws(() => applyMove(st, 1, { type: "jump", to: 100 }, spinOf(1)), (e) => e.name === "RuleError");
  assert.throws(() => applyMove(st, 1, null, spinOf(1)), (e) => e.name === "RuleError");
  st.winner = 1;
  assert.throws(() => spin(st, 1, 3), (e) => e.name === "RuleError");
});

test("config: unknown values fall back to the defaults; the room picks who starts", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ finish: "teleport", sixAgain: "yes", first: 7, spin: "x" }), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ finish: "bounce", sixAgain: true, first: "guest", spin: "auto" }), { finish: "bounce", sixAgain: true, first: "guest", spin: "auto" });
  assert.equal(makeRules({ first: "host" }).newState(1).turn, 0);
  assert.equal(makeRules({ first: "guest" }).newState(0).turn, 1);
  assert.equal(makeRules({ first: "random" }).newState(1).turn, 1);
  const r = makeRules({});
  assert.equal(r.draws, DRAWS);
  assert.ok(r.needsRandom(null, { type: "spin" }));
});

test("seeded full games always finish, and the stats add up", () => {
  for (const finish of ["exact", "bounce", "any"]) {
    for (let g = 0; g < 200; g++) {
      const rng = rngFromSeed(`${finish}-${g}`);
      const st = newState(g % 2, { finish, sixAgain: g % 3 === 0 });
      while (st.winner === -1) {
        const p = st.turn;
        const before = st.pos[p];
        const [ev] = applyMove(st, p, { type: "spin" }, rng);
        assert.equal(ev.from, before);
        assert.ok(st.pos[p] >= 0 && st.pos[p] <= LAST);
        assert.ok(!LADDERS[st.pos[p]] && !CHUTES[st.pos[p]], "never left standing on a ladder foot or chute top");
      }
      assert.equal(st.pos[st.winner], LAST);
      assert.ok(st.ply < DRAWS, `${st.ply} spins fit the draw budget`);
    }
  }
});
