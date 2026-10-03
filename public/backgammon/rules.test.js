import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import {
  makeRules,
  newState as newTimedState,
  applyMove,
  normalizeConfig,
  legalPlays,
  legalSteps,
  stepTarget,
  pipCount,
  timeLeft,
  DEFAULT_CONFIG,
  MOVE_SECONDS,
  GAME_SECONDS,
  CHECKERS,
  BAR,
  OFF,
} from "./rules.js";

const UNTIMED = { moveSeconds: 0, gameSeconds: 0 };
const newState = (first = 0, config = UNTIMED) => newTimedState(first, config);

// An rng that rolls the given dice, in order.
function dice(...values) {
  let i = 0;
  return () => (values[i++ % values.length] - 0.5) / 6;
}

// One side from { point: count, bar: count }; whatever is missing is borne off.
function side(spec) {
  const s = Array(26).fill(0);
  for (const [k, v] of Object.entries(spec)) s[k === "bar" ? BAR : Number(k)] = v;
  s[OFF] = CHECKERS - s.reduce((a, b) => a + b, 0);
  return s;
}

function stateWith(mine, theirs, turn = 0) {
  const s = newState(turn);
  s.pos = turn === 0 ? [side(mine), side(theirs)] : [side(theirs), side(mine)];
  return s;
}

const roll = (s, a, b) => applyMove(s, s.turn, { type: "roll" }, dice(a, b));
const play = (s, steps) => applyMove(s, s.turn, { type: "play", steps });
const total = (sd) => sd.reduce((a, b) => a + b, 0);

test("a new game: fifteen checkers each on the usual points, 167 pips, the starter to roll", () => {
  for (const first of [0, 1]) {
    const s = newState(first);
    assert.equal(s.turn, first);
    assert.equal(s.winner, -1);
    assert.equal(s.rolled, false);
    for (const sd of s.pos) {
      assert.equal(total(sd), CHECKERS);
      assert.deepEqual([sd[24], sd[13], sd[8], sd[6]], [2, 5, 3, 5]);
      assert.equal(pipCount(sd), 167);
    }
  }
});

test("settings match papergames' options, and anything unknown falls back to the defaults", () => {
  assert.deepEqual(MOVE_SECONDS, [30, 60, 90, 120, 0]);
  assert.deepEqual(GAME_SECONDS, [180, 300, 480, 900, 1200, 3600, 0]);
  assert.deepEqual(DEFAULT_CONFIG, { moveSeconds: 0, gameSeconds: 0, first: "random", level: "easy" });
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ moveSeconds: 7, gameSeconds: "300", first: "me", level: "expert" }), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ moveSeconds: 60, gameSeconds: 480, first: "guest", level: "hard" }), { moveSeconds: 60, gameSeconds: 480, first: "guest", level: "hard" });
});

test("the room's first-move setting overrides the coin toss", () => {
  assert.equal(makeRules({ first: "host" }).newState(1).turn, 0);
  assert.equal(makeRules({ first: "guest" }).newState(0).turn, 1);
  assert.equal(makeRules({ first: "random" }).newState(1).turn, 1);
  const r = makeRules({});
  assert.equal(r.needsRandom(newState(), { type: "roll" }), true);
  assert.equal(r.needsRandom(newState(), { type: "play", steps: [] }), false);
  assert.equal(r.needsRandom(newState(), { timeout: true }), false);
  assert.equal(r.draws, 1024, "one shared draw per roll, with room for long games");
});

test("a roll draws two dice; a double gives four moves", () => {
  const s = newState(0);
  assert.deepEqual(roll(s, 3, 5), [{ type: "roll", player: 0, roll: [3, 5] }]);
  assert.deepEqual(s.roll, [3, 5]);
  assert.deepEqual(s.dice, [3, 5]);
  assert.equal(s.rolled, true);
  assert.throws(() => roll(s, 1, 1), new RuleError("You already rolled"));
  const d = newState(1);
  roll(d, 4, 4);
  assert.deepEqual(d.dice, [4, 4, 4, 4]);
});

test("dice come from the shared rng: 1 to 6, all faces", () => {
  const seen = new Set();
  const rng = rngFromSeed("dice");
  for (let k = 0; k < 200; k++) {
    const s = newState(0);
    applyMove(s, 0, { type: "roll" }, rng);
    for (const d of s.roll) {
      assert.ok(Number.isInteger(d) && d >= 1 && d <= 6);
      seen.add(d);
    }
  }
  assert.equal(seen.size, 6);
});

test("the opening 3-1 has the sixteen known plays, and every one is accepted", () => {
  const s = newState(0);
  roll(s, 3, 1);
  const plays = legalPlays(s.pos, 0, s.dice);
  assert.equal(plays.length, 16);
  for (const pl of plays) {
    const t = structuredClone(s);
    play(t, pl.steps);
    assert.deepEqual(t.pos, pl.pos);
    assert.equal(t.turn, 1);
    assert.equal(pipCount(t.pos[0]), 163);
  }
  // Making the five point: 8/5 6/5.
  const t = structuredClone(s);
  const events = play(t, [[8, 3], [6, 1]]);
  assert.deepEqual(events, [{ type: "play", player: 0, steps: [{ from: 8, to: 5, die: 3, hit: false }, { from: 6, to: 5, die: 1, hit: false }] }]);
  assert.equal(t.pos[0][5], 2);
  assert.deepEqual(t.last, { player: 0, roll: [3, 1], steps: events[0].steps, passed: false });
  assert.equal(t.rolled, false);
});

test("a point held by two or more opposing checkers is blocked", () => {
  // Their 6 point (five checkers) is your 19: 24/19 with a five is refused.
  const s = newState(0);
  roll(s, 5, 2);
  assert.equal(stepTarget(s.pos, 0, 24, 5), null);
  assert.throws(() => play(s, [[24, 5], [13, 2]]), new RuleError("That checker can't move there"));
});

test("landing on a lone checker sends it to the bar, and it must come back in first", () => {
  // Their blot on their 20 point is your 5; you hit it from 8 with a three.
  const s = stateWith({ 8: 2, 6: 13 }, { 20: 1, 6: 14 });
  roll(s, 3, 1);
  const [ev] = play(s, [[8, 3], [6, 1]]);
  assert.deepEqual(ev.steps[0], { from: 8, to: 5, die: 3, hit: true });
  assert.equal(s.pos[1][BAR], 1);
  assert.equal(s.pos[1][20], 0);
  // Now they have a checker on the bar: only entering moves are legal.
  roll(s, 4, 2);
  assert.ok(legalSteps(s.pos, 1, s.dice).every((st) => st.from === BAR));
  assert.throws(() => play(s, [[6, 4], [6, 2]]), new RuleError("That checker can't move there"));
  // Entering with the four lands on their 21 (your 4): open, so it's fine.
  play(s, [[BAR, 4], [6, 2]]);
  assert.equal(s.pos[1][BAR], 0);
  assert.equal(s.pos[1][21], 1);
});

test("a roll with no legal play passes the turn by itself", () => {
  // You're on the bar against a closed board.
  const s = stateWith({ bar: 1, 6: 14 }, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 5 });
  const events = roll(s, 6, 6);
  assert.deepEqual(events.map((e) => e.type), ["roll", "pass"]);
  assert.equal(s.turn, 1);
  assert.equal(s.rolled, false);
  assert.deepEqual(s.last, { player: 0, roll: [6, 6], steps: [], passed: true });
  assert.throws(() => applyMove(s, 0, { type: "roll" }, dice(1, 2)), new RuleError("Not your turn"));
});

test("you must play both dice when you can", () => {
  // 13/7 is blocked, but 13/12/6 plays both: the one alone is refused.
  const s = stateWith({ 13: 1, 1: 14 }, { 18: 2, 6: 13 });
  roll(s, 6, 1);
  assert.deepEqual(legalSteps(s.pos, 0, s.dice).map((st) => [st.from, st.die]), [[13, 1]]);
  assert.throws(() => play(s, [[13, 1]]), new RuleError("You must play as many dice as you can"));
  play(s, [[13, 1], [12, 6]]);
  assert.equal(s.pos[0][6], 1);
});

test("when only one die can be played, it must be the larger", () => {
  // 13/7 or 13/9, but never both: their point on your 3 blocks the follow-up.
  const s = stateWith({ 13: 1, 1: 14 }, { 22: 2, 6: 13 });
  roll(s, 6, 4);
  assert.deepEqual(legalSteps(s.pos, 0, s.dice).map((st) => [st.from, st.die]), [[13, 6]]);
  assert.throws(() => play(s, [[13, 4]]), new RuleError("That checker can't move there"));
  play(s, [[13, 6]]);
  assert.equal(s.pos[0][7], 1);
  assert.equal(s.turn, 1);
});

test("bearing off starts only with every checker home; a high die bears off from the highest point", () => {
  const away = stateWith({ 8: 1, 3: 14 }, { 6: 15 });
  assert.equal(stepTarget(away.pos, 0, 3, 3), null, "a checker is still outside");
  const home = stateWith({ 6: 1, 2: 1 }, { 6: 15 });
  assert.equal(stepTarget(home.pos, 0, 6, 6), OFF);
  assert.equal(stepTarget(home.pos, 0, 2, 5), null, "the six point is still occupied");
  assert.equal(stepTarget(home.pos, 0, 6, 5), 1);
  roll(home, 6, 5);
  play(home, [[6, 6], [2, 5]]);
  assert.equal(home.winner, 0);
  assert.equal(home.reason, "off");
});

test("bearing off the last checker wins at once, even with a die left", () => {
  const s = stateWith({ 1: 1 }, { 6: 15 }, 1);
  roll(s, 2, 1);
  const events = play(s, [[1, 2]]);
  assert.deepEqual(events.at(-1), { type: "win", player: 1 });
  assert.equal(s.winner, 1);
  assert.equal(s.pos[1][OFF], CHECKERS);
  assert.equal(s.turn, 1, "the turn stays put once the game is over");
  assert.throws(() => roll(s, 1, 1), new RuleError("The game is over"));
});

test("malformed or out-of-turn moves throw RuleError", () => {
  const s = newState(0);
  assert.throws(() => applyMove(s, 1, { type: "roll" }, dice(1, 2)), new RuleError("Not your turn"));
  assert.throws(() => play(s, [[13, 3]]), new RuleError("Roll the dice first"));
  assert.throws(() => applyMove(s, 0, { cell: 3 }), new RuleError("Unknown move"));
  assert.throws(() => applyMove(s, 0, null), new RuleError("Unknown move"));
  roll(s, 3, 1);
  for (const steps of [undefined, "13/10", [], [[8, 3], [6, 1], [6, 1], [6, 1], [6, 1]]]) assert.throws(() => play(s, steps), RuleError);
  assert.throws(() => play(s, [["8", 3], [6, 1]]), new RuleError("Malformed step"));
  assert.throws(() => play(s, [[8, 5], [6, 1]]), new RuleError("That die isn't yours to play"));
  assert.throws(() => play(s, [[8, 3], [6, 3]]), new RuleError("That die isn't yours to play"));
  assert.throws(() => play(s, [[7, 3], [6, 1]]), new RuleError("That checker can't move there"));
  assert.throws(() => applyMove(s, 0, { timeout: true }), new RuleError("This game has no clock"));
  assert.equal(s.ply, 1, "nothing changed");
});

test("clocks: the roll and the play share the turn's limit, and both spend the player's clock", () => {
  const s = newTimedState(0, { moveSeconds: 30, gameSeconds: 180 });
  assert.equal(timeLeft(s, 0), 30_000);
  assert.throws(() => applyMove(s, 0, { type: "roll" }, dice(3, 1)), new RuleError("Move time missing"));
  applyMove(s, 0, { type: "roll", ms: 10_000 }, dice(3, 1));
  assert.equal(timeLeft(s, 0), 20_000);
  assert.equal(timeLeft(s, 1), 30_000);
  assert.throws(() => applyMove(s, 0, { type: "play", steps: [[8, 3], [6, 1]], ms: 20_001 }), new RuleError("Time ran out"));
  assert.throws(() => applyMove(s, 0, { type: "play", steps: [[8, 3]], ms: 1000 }), new RuleError("You must play as many dice as you can"));
  assert.deepEqual(s.clocks, [170_000, 180_000], "a refused play spends no time");
  applyMove(s, 0, { type: "play", steps: [[8, 3], [6, 1]], ms: 20_000 });
  assert.deepEqual(s.clocks, [150_000, 180_000]);
  assert.equal(timeLeft(s, 1), 30_000, "a fresh turn has the full limit");
  applyMove(s, 1, { type: "roll", ms: 500 }, dice(6, 5));
  assert.deepEqual(applyMove(s, 1, { timeout: true }), [{ type: "timeout", player: 1 }]);
  assert.equal(s.winner, 0);
  assert.equal(s.reason, "timeout");
});

test("the game clock alone limits a turn when there is no move limit", () => {
  const s = newTimedState(1, { moveSeconds: 0, gameSeconds: 180 });
  assert.equal(timeLeft(s, 1), 180_000);
  assert.throws(() => applyMove(s, 1, { type: "roll", ms: 180_001 }, dice(1, 2)), new RuleError("Time ran out"));
  applyMove(s, 1, { type: "roll", ms: 179_000 }, dice(1, 2));
  assert.equal(timeLeft(s, 1), 1000);
});

test("a scripted full game: random legal plays keep fifteen checkers a side and end with one side home", () => {
  for (let g = 0; g < 20; g++) {
    const rng = rngFromSeed(`full-${g}`);
    const s = newState(g % 2);
    let turns = 0;
    while (s.winner === -1) {
      const p = s.turn;
      applyMove(s, p, { type: "roll" }, rng);
      if (s.turn === p && s.winner === -1) {
        const plays = legalPlays(s.pos, p, s.dice);
        assert.ok(plays.length > 0, "a roll that wasn't passed has a play");
        play(s, plays[Math.floor(rng() * plays.length)].steps);
      }
      for (const sd of s.pos) assert.equal(total(sd), CHECKERS);
      assert.ok(++turns < 2000);
    }
    assert.equal(s.reason, "off");
    assert.equal(s.pos[s.winner][OFF], CHECKERS);
    assert.ok(s.pos[1 - s.winner][OFF] < CHECKERS);
  }
});
