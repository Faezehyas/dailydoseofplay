import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { chooseMove, evaluate, LEVELS } from "./robot.js";
import { newState as newTimedState, applyMove, legalMoves, EMPTY, DRAW } from "./rules.js";

const newState = (first) => newTimedState(first, { moveSeconds: 0, gameSeconds: 0 });
const sq = (r, c) => r * 8 + c;
const key = (path) => path.join("-");

// x/X = player 0 man/king, o/O = player 1 man/king, . = empty.
function stateFrom(rows, turn) {
  const s = newState(0);
  s.board = rows.flatMap((row) => [...row.padEnd(8, ".")].map((ch) => ({ x: 0, o: 1, X: 2, O: 3 })[ch] ?? EMPTY));
  s.turn = turn;
  return s;
}

// Play one game; levels[p] is "random" or a robot level. Returns the final state.
function playGame(levels, seed, first = 0) {
  const rng = rngFromSeed(seed);
  const s = newState(first);
  while (s.winner === -1) {
    const moves = legalMoves(s.board, s.turn);
    const level = levels[s.turn];
    const move = level === "random" ? { path: moves[Math.floor(rng() * moves.length)] } : chooseMove(s, s.turn, rng, { level });
    assert.ok(moves.some((m) => key(m) === key(move.path)), `illegal ${key(move.path)}`);
    applyMove(s, s.turn, move);
  }
  return s;
}

// Wins for `a` over `games` games against `b`, switching seats and who starts.
function match(a, b, games, tag) {
  const tally = { a: 0, b: 0, draws: 0 };
  for (let g = 0; g < games; g++) {
    const seat = g % 2;
    const levels = seat === 0 ? [a, b] : [b, a];
    const { winner } = playGame(levels, `${tag}-${g}`, (g >> 1) % 2);
    if (winner === DRAW) tally.draws++;
    else if (winner === seat) tally.a++;
    else tally.b++;
  }
  return tally;
}

test("it takes a win that leaves the opponent stuck, even when it could play at random", () => {
  // o on (0,1) is boxed in once x steps (2,1)->(1,2).
  const s = stateFrom([".o", "x", ".x.x", "", "", ".....x", "", "..x"], 0);
  assert.ok(legalMoves(s.board, 0).length > 4);
  for (let seed = 0; seed < 50; seed++) {
    assert.deepEqual(chooseMove(s, 0, rngFromSeed(seed), { randomChance: 1 }).path, [sq(2, 1), sq(1, 2)]);
  }
});

test("it avoids a move that loses on the spot, even when it plays at random", () => {
  // o's last man: stepping to (3,2) lets x jump it; (3,4) is safe.
  const s = stateFrom(["", "", "...o", "", ".x", "", "", "......x"], 1);
  assert.equal(legalMoves(s.board, 1).length, 2);
  for (let seed = 0; seed < 50; seed++) {
    assert.deepEqual(chooseMove(s, 1, rngFromSeed(seed), { randomChance: 1 }).path, [sq(2, 3), sq(3, 4)]);
  }
});

test("it takes the bigger capture when it can choose", () => {
  // x can take one man to the left, or two in a row to the right.
  const s = stateFrom(["", "", ".....o", "", ".o.o", "..x", "", "......O"], 0);
  const moves = legalMoves(s.board, 0);
  assert.deepEqual(moves.map(key).sort(), [key([42, 24]), key([42, 28, 14])].sort());
  for (const level of Object.keys(LEVELS)) {
    assert.deepEqual(chooseMove(s, 0, rngFromSeed(level), { level, randomChance: 0 }).path, [42, 28, 14], level);
  }
});

test("the evaluation is symmetric and counts material", () => {
  const s = newState(0);
  assert.equal(evaluate(s.board, 0), evaluate(s.board, 1));
  s.board[sq(2, 1)] = EMPTY;
  assert.ok(evaluate(s.board, 0) > 50, "a man up is good");
  assert.equal(evaluate(s.board, 0), -evaluate(s.board, 1));
});

test("robot vs robot over 20 seeded games always finishes with legal moves, at every level", () => {
  const levels = Object.keys(LEVELS);
  for (let g = 0; g < 20; g++) {
    const s = playGame([levels[g % 3], levels[(g + 1) % 3]], `rvr-${g}`, g % 2);
    assert.ok([0, 1, DRAW].includes(s.winner));
    assert.ok(["captured", "blocked", "draw"].includes(s.reason));
  }
});

test("the levels play visibly differently: each beats the one below it", () => {
  const hardEasy = match("hard", "easy", 10, "he");
  const mediumEasy = match("medium", "easy", 10, "me");
  const hardMedium = match("hard", "medium", 10, "hm");
  assert.ok(hardEasy.a >= 8, `hard vs easy ${JSON.stringify(hardEasy)}`);
  assert.ok(mediumEasy.a >= 8, `medium vs easy ${JSON.stringify(mediumEasy)}`);
  assert.ok(hardMedium.a >= 6 && hardMedium.b <= 1, `hard vs medium ${JSON.stringify(hardMedium)}`);
});

test("even Easy beats a random player almost always", () => {
  const easy = match("easy", "random", 20, "er");
  assert.ok(easy.a >= 17, JSON.stringify(easy));
});

test("it answers well under 100 ms, from the opening and in a crowded middle game", async () => {
  const { chooseMove: fresh } = await import(`./robot.js?cold=${Date.now()}`);
  const opening = newState(0);
  const middle = stateFrom([".o.o.o.o", "o.o...o.", ".o.o.o.o", "x...o...", "...x.x.x", "x.x...x.", ".x.x.x.x", "x.x.x.x."], 0);
  for (const [name, s] of [["opening", opening], ["middle", middle]]) {
    for (const level of Object.keys(LEVELS)) {
      const t0 = performance.now();
      fresh(s, s.turn, rngFromSeed(name), { level, randomChance: 0 });
      assert.ok(performance.now() - t0 < 100, `${name}, ${level}`);
    }
  }
});
