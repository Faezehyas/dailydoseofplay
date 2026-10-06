import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import {
  applyMove,
  newState,
  makeRules,
  normalizeConfig,
  legalMoves,
  distinctMoves,
  colorsFor,
  square,
  DEFAULT_CONFIG,
  DRAWS,
  STARTS,
  STARS,
  SAFE,
  YARD,
  HOME,
  LOOP,
} from "./rules.js";

// An rng that makes the die show `v` (1–6).
const dieOf = (v) => () => (v - 0.5) / 6;
const roll = (st, p, v) => applyMove(st, p, { type: "roll" }, dieOf(v))[0];
const move = (st, p, token) => applyMove(st, p, { type: "move", token }, () => 0)[0];
// The progress a token of `color` needs to stand on loop square q.
const at = (color, q) => (q - STARTS[color] + LOOP) % LOOP;

test("two players sit opposite (red and yellow); three and four go round the board", () => {
  assert.deepEqual(colorsFor(2), [0, 2]);
  assert.deepEqual(colorsFor(3), [0, 1, 2]);
  assert.deepEqual(colorsFor(4), [0, 1, 2, 3]);
  assert.deepEqual(newState(0, DEFAULT_CONFIG, 4).tokens, [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]]);
  // Start squares are 13 apart; every colour's 51 loop squares end just before its own start.
  assert.deepEqual(STARTS, [1, 14, 27, 40]);
  for (let c = 0; c < 4; c++) assert.equal(square(c, 50), (STARTS[c] + LOOP - 2) % LOOP);
  assert.equal(SAFE.size, 8);
  for (const s of STARS) assert.ok(!STARTS.includes(s));
});

test("a token needs a 6 to leave the yard; with no move the turn passes by itself", () => {
  const st = newState(0);
  let ev = roll(st, 0, 3);
  assert.ok(ev.pass);
  assert.deepEqual(ev.moves, []);
  assert.equal(st.turn, 1);
  assert.equal(st.rolled, false);
  ev = roll(st, 1, 6);
  assert.deepEqual(ev.moves, [0, 1, 2, 3]);
  assert.equal(st.rolled, true);
  assert.equal(distinctMoves(st, 1).length, 1, "four tokens in the yard are one choice");
  ev = move(st, 1, 2);
  assert.ok(ev.enter);
  assert.equal(st.tokens[1][2], 0);
  assert.equal(square(st.colors[1], 0), STARTS[2], "yellow comes out on its own start square");
});

test("a 6 earns another roll; any other roll passes the turn", () => {
  const st = newState(0);
  roll(st, 0, 6);
  let ev = move(st, 0, 0);
  assert.equal(ev.again, true);
  assert.equal(ev.why, "six");
  assert.equal(st.turn, 0);
  assert.equal(st.rolled, false);
  roll(st, 0, 4);
  ev = move(st, 0, 0);
  assert.deepEqual(ev.path, [1, 2, 3, 4]);
  assert.equal(ev.again, false);
  assert.equal(st.turn, 1);
  assert.equal(st.rolls[0], 2);
});

test("landing on an opponent sends it back to its yard", () => {
  const st = newState(0, {}, 4);
  st.tokens[0][0] = 18;
  const q = square(0, 20);
  st.tokens[1][3] = at(1, q);
  roll(st, 0, 2);
  const ev = move(st, 0, 0);
  assert.deepEqual(ev.captures, [{ player: 1, token: 3, from: at(1, q) }]);
  assert.equal(st.tokens[1][3], YARD);
  assert.equal(st.captures[0], 1);
  assert.equal(st.lost[1], 1);
  assert.equal(ev.again, false, "no extra roll for a capture by default");
});

test("start and star squares are safe: tokens of different colours share them", () => {
  for (const q of [STARS[0], STARTS[1]]) {
    const st = newState(0, {}, 4);
    st.tokens[0][0] = at(0, q) - 2;
    st.tokens[1][0] = at(1, q);
    roll(st, 0, 2);
    const ev = move(st, 0, 0);
    assert.ok(ev.safe);
    assert.deepEqual(ev.captures, []);
    assert.equal(st.tokens[1][0], at(1, q), `still on square ${q}`);
  }
  // Coming out onto your start square never captures either.
  const st = newState(0, {}, 4);
  st.tokens[1][0] = at(1, STARTS[0]);
  roll(st, 0, 6);
  assert.deepEqual(move(st, 0, 0).captures, []);
});

test("tokens in a home column are out of reach, and must land exactly on home", () => {
  const st = newState(0);
  st.tokens[0] = [54, HOME, HOME, HOME];
  roll(st, 0, 3);
  assert.equal(st.turn, 1, "a 3 overshoots home: no move, the turn passes");
  st.turn = 0;
  roll(st, 0, 2);
  const ev = move(st, 0, 0);
  assert.ok(ev.home && ev.done);
  assert.equal(st.winner, 0, "all four home wins");
  assert.equal(ev.again, false);
  assert.throws(() => roll(st, 1, 2), /over/);
  // A home column square isn't on the loop, so nothing lands on it.
  assert.equal(square(0, 51), -1);
});

test("three 6s in a row forfeit the turn; the house rule can be turned off", () => {
  const st = newState(0);
  roll(st, 0, 6);
  move(st, 0, 0);
  roll(st, 0, 6);
  move(st, 0, 0);
  const ev = roll(st, 0, 6);
  assert.ok(ev.forfeit);
  assert.equal(st.turn, 1);
  assert.equal(st.tokens[0][0], 6, "the token keeps what the first two 6s gave it");
  const free = newState(0, { threeSixes: false });
  for (let i = 0; i < 3; i++) {
    roll(free, 0, 6);
    move(free, 0, 0);
  }
  assert.equal(free.turn, 0, "three 6s just keep rolling");
  assert.equal(free.tokens[0][0], 12);
});

test("blocks: two tokens of one colour can't be passed or landed on, except on a start square", () => {
  const q = 20;
  const blocked = (blocks) => {
    const st = newState(0, { blocks }, 4);
    st.tokens[1][0] = st.tokens[1][1] = at(1, q);
    st.tokens[0][0] = at(0, q) - 2;
    return st;
  };
  let st = blocked(true);
  roll(st, 0, 2);
  assert.equal(st.turn, 1, "landing on the block: no move");
  st = blocked(true);
  roll(st, 0, 4);
  assert.equal(st.turn, 1, "passing the block: no move");
  st = blocked(true);
  roll(st, 0, 1);
  assert.deepEqual(legalMoves(st, 0).map((m) => m.to), [at(0, q) - 1], "stopping short is fine");
  // Your own pair doesn't stop you.
  st = newState(0, { blocks: true });
  st.tokens[0] = [10, 12, 12, YARD];
  roll(st, 0, 5);
  assert.deepEqual(legalMoves(st, 0).map((m) => m.token), [0, 1, 2]);
  // A pair on your start square can't keep you in the yard.
  st = newState(0, { blocks: true }, 4);
  st.tokens[1][0] = st.tokens[1][1] = at(1, STARTS[0]);
  roll(st, 0, 6);
  assert.deepEqual(legalMoves(st, 0).map((m) => m.to), [0, 0, 0, 0]);
  // Without the rule, landing on a pair sends both home.
  st = blocked(false);
  roll(st, 0, 2);
  assert.equal(move(st, 0, 0).captures.length, 2);
  assert.deepEqual(st.tokens[1], [YARD, YARD, YARD, YARD]);
});

test("capture bonus: a capture earns another roll when the room turns it on", () => {
  const st = newState(0, { captureBonus: true }, 4);
  st.tokens[0][0] = 18;
  st.tokens[1][0] = at(1, square(0, 20));
  roll(st, 0, 2);
  const ev = move(st, 0, 0);
  assert.equal(ev.again, true);
  assert.equal(ev.why, "capture");
  assert.equal(st.turn, 0);
});

test("playing for places: the game goes on after the first finish and ranks everyone", () => {
  const st = newState(0, { places: true }, 3);
  st.tokens[0] = [55, HOME, HOME, HOME];
  st.tokens[2] = [55, HOME, HOME, HOME];
  st.tokens[1] = [3, 2, YARD, YARD];
  roll(st, 0, 1);
  let ev = move(st, 0, 0);
  assert.equal(ev.place, 1);
  assert.equal(st.winner, -1, "two players are still out");
  assert.equal(st.turn, 1);
  roll(st, 1, 2);
  move(st, 1, 0);
  roll(st, 2, 1);
  ev = move(st, 2, 0);
  assert.equal(ev.place, 2);
  assert.equal(st.winner, 0);
  assert.deepEqual(st.order, [0, 2, 1]);
  // A finished player is skipped.
  const st2 = newState(0, { places: true }, 4);
  st2.tokens[1] = [HOME, HOME, HOME, HOME];
  st2.order = [1];
  roll(st2, 0, 2);
  assert.equal(st2.turn, 2);
});

test("first home wins: the game ends at once and the rest are ranked by how far they got", () => {
  const st = newState(0, { places: false }, 4);
  st.tokens[0] = [55, HOME, HOME, HOME];
  st.tokens[1] = [3, YARD, YARD, YARD];
  st.tokens[2] = [40, 20, YARD, YARD];
  st.tokens[3] = [YARD, YARD, YARD, YARD];
  roll(st, 0, 1);
  move(st, 0, 0);
  assert.equal(st.winner, 0);
  assert.deepEqual(st.order, [0, 2, 1, 3]);
});

test("illegal moves throw RuleError", () => {
  const st = newState(0);
  assert.throws(() => roll(st, 1, 6), { name: "RuleError", message: /Not your turn/ });
  assert.throws(() => move(st, 0, 0), { name: "RuleError", message: /Roll/ });
  assert.throws(() => applyMove(st, 0, { type: "jump" }, dieOf(1)), { name: "RuleError" });
  assert.throws(() => applyMove(st, 0, null, dieOf(1)), { name: "RuleError" });
  roll(st, 0, 6);
  assert.throws(() => roll(st, 0, 6), { name: "RuleError", message: /Pick a token/ });
  assert.throws(() => move(st, 0, 4), { name: "RuleError", message: /Unknown token/ });
  assert.throws(() => move(st, 0, "1"), { name: "RuleError" });
  st.tokens[0] = [HOME, 2, YARD, YARD];
  assert.throws(() => move(st, 0, 0), { name: "RuleError", message: /can't move 6/ });
});

test("config: unknown values fall back to the classic defaults, and the room picks who rolls first", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(DEFAULT_CONFIG, { threeSixes: true, blocks: false, captureBonus: false, places: true, first: "random", moveSeconds: 0, level: "easy", robots: 3 });
  const c = normalizeConfig({ blocks: "yes", moveSeconds: 17, level: "insane", robots: 9, first: "host", captureBonus: true });
  assert.equal(c.blocks, false);
  assert.equal(c.moveSeconds, 0);
  assert.equal(c.level, "easy");
  assert.equal(c.robots, 3);
  assert.equal(c.captureBonus, true);
  assert.equal(makeRules({ first: "host" }).newState(1, 4).turn, 0);
  assert.equal(makeRules({ first: "guest" }).newState(0, 4).turn, 1);
  assert.equal(makeRules({}).newState(3, 4).turn, 3, "the coin toss counts");
  const r = makeRules({});
  assert.equal(r.needsRandom({}, { type: "roll" }), true);
  assert.equal(r.needsRandom({}, { type: "move", token: 0 }), false);
});

// Random legal moves until the game ends.
function playOut(players, config, seed) {
  const rules = makeRules(config);
  const dice = rngFromSeed(`dice ${seed}`);
  const pick = rngFromSeed(`pick ${seed}`);
  const st = rules.newState(Math.floor(dice() * players), players);
  let draws = 1;
  while (st.winner === -1) {
    let mv = { type: "roll" };
    if (st.rolled) {
      const moves = legalMoves(st, st.turn);
      assert.ok(moves.length, "a rolled player always has a move");
      mv = { type: "move", token: moves[Math.floor(pick() * moves.length)].token };
    } else draws++;
    rules.applyMove(st, st.turn, mv, dice);
    assert.ok(draws <= DRAWS, `game ${seed} ran out of draws`);
  }
  return { st, draws };
}

test("seeded games for 2, 3 and 4 players always finish well within the draw budget", () => {
  let most = 0;
  for (const players of [2, 3, 4]) {
    for (const config of [{}, { blocks: true, captureBonus: true, threeSixes: false }, { places: false }]) {
      for (let seed = 0; seed < 60; seed++) {
        const { st, draws } = playOut(players, config, `${players}-${JSON.stringify(config)}-${seed}`);
        most = Math.max(most, draws);
        assert.equal(st.order.length, players, "everyone is ranked");
        assert.deepEqual([...st.order].sort(), [...Array(players).keys()]);
        assert.equal(st.winner, st.order[0]);
        assert.ok(st.tokens[st.winner].every((r) => r === HOME));
        if (config.places !== false) for (const p of st.order.slice(0, -1)) assert.ok(st.tokens[p].every((r) => r === HOME), "all but the last finished");
      }
    }
  }
  assert.ok(most < DRAWS / 1.5, `longest game used ${most} draws`);
});
