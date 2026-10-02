import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { chooseMove, scoreMoves, evaluateState, LEVELS } from "./robot.js";
import { newState as newTimedState, stateFromFen, applyMove, listMoves, legalMoves, isAttacked, parseSquare, BLACK, DRAW } from "./rules.js";

const newState = (first) => newTimedState(first, { moveSeconds: 0, gameSeconds: 0 });
const fen = (f) => stateFromFen(f, { white: 0 });
const sq = parseSquare;
const name = (move) => `${"abcdefgh"[move.from & 7]}${(move.from >> 3) + 1}${"abcdefgh"[move.to & 7]}${(move.to >> 3) + 1}${move.promo || ""}`;
const LEVEL_NAMES = Object.keys(LEVELS);

// Play a game between two move pickers; player 0 has White when first = 0.
function game(pick0, pick1, first, rng) {
  const s = newState(first);
  while (s.winner === -1) {
    const move = (s.turn === 0 ? pick0 : pick1)(s, s.turn, rng);
    applyMove(s, s.turn, move);
  }
  return s;
}
const randomPlayer = (s, me, rng) => {
  const moves = listMoves(s);
  return moves[Math.floor(rng() * moves.length)];
};
const robot = (level) => (s, me, rng) => chooseMove(s, me, rng, { level });

test("it takes a mate in one at every level, even when it would play at random", () => {
  const backRank = fen("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1");
  const scholar = fen("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 0 1");
  for (const level of LEVEL_NAMES) {
    for (let seed = 0; seed < 20; seed++) {
      assert.equal(name(chooseMove(backRank, 0, rngFromSeed(seed), { level, randomChance: 1 })), "a1a8", level);
      assert.equal(name(chooseMove(scholar, 0, rngFromSeed(seed), { level, randomChance: 1 })), "h5f7", level);
    }
  }
});

test("it stops a mate in one at every level, even when it would play at random", () => {
  // Black threatens Re1#. Na3, Nc3 and Kh1 lose at once; luft, Nd2 or Kf1 hold.
  const s = fen("4r1k1/5ppp/8/8/8/8/5PPP/1N4K1 w - - 0 1");
  const losing = new Set(["b1a3", "b1c3", "g1h1"]);
  for (const level of LEVEL_NAMES) {
    for (let seed = 0; seed < 30; seed++) {
      const move = name(chooseMove(s, 0, rngFromSeed(seed), { level, randomChance: 1 }));
      assert.ok(!losing.has(move), `${level} played ${move}`);
    }
  }
});

test("it wins material it is offered and saves its queen", () => {
  const free = fen("4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1");
  for (const level of LEVEL_NAMES) {
    for (let seed = 0; seed < 10; seed++) assert.equal(name(chooseMove(free, 0, rngFromSeed(seed), { level, randomChance: 0 })), "d1d5", level);
  }
  // The pawn on c5 attacks the queen on d4: the queen goes somewhere safe.
  const hit = fen("4k3/8/8/2p5/3Q4/8/8/4K3 w - - 0 1");
  for (const level of LEVEL_NAMES) {
    for (let seed = 0; seed < 10; seed++) {
      const move = chooseMove(hit, 0, rngFromSeed(seed), { level, randomChance: 0 });
      assert.equal(move.from, sq("d4"), level);
      const after = structuredClone(hit);
      applyMove(after, 0, move);
      assert.ok(!isAttacked(after.board, move.to, BLACK), `${level} left the queen en prise on ${move.to}`);
    }
  }
});

test("with a won game it does not stalemate the opponent", () => {
  // Qf7 would stalemate; Qf2-f7 is the only stalemating move here.
  const s = fen("7k/8/6K1/8/8/8/5Q2/8 w - - 0 1");
  for (const level of LEVEL_NAMES) {
    for (let seed = 0; seed < 10; seed++) assert.notEqual(name(chooseMove(s, 0, rngFromSeed(seed), { level, randomChance: 0 })), "f2f7", level);
  }
  const { scored } = scoreMoves(s, legalMoves(s), { depth: 2 });
  const stalemate = scored.find(({ m }) => (m & 63) === sq("f2") && ((m >> 6) & 63) === sq("f7"));
  assert.equal(stalemate.score, 0);
});

test("the evaluation is symmetric and counts material", () => {
  assert.equal(evaluateState(newState(0)), 0);
  const up = fen("4k3/8/8/8/8/8/PPPP4/RNBQK3 w - - 0 1");
  const mirrored = fen("rnbqk3/pppp4/8/8/8/8/8/4K3 b - - 0 1");
  assert.ok(evaluateState(up) > 1500);
  assert.equal(evaluateState(up), evaluateState(mirrored));
});

test("robot vs robot over 20 seeded games always finishes with legal moves", () => {
  for (let g = 0; g < 20; g++) {
    const rng = rngFromSeed(`rvr-${g}`);
    const s = newState(g % 2);
    const levels = g % 4 < 2 ? ["hard", "easy"] : ["easy", "medium"];
    // applyMove throws on an illegal move.
    while (s.winner === -1) applyMove(s, s.turn, chooseMove(s, s.turn, rng, { level: levels[s.turn], maxNodes: 1500 }));
    assert.ok([0, 1, DRAW].includes(s.winner));
    assert.ok(s.reason);
  }
});

test("Easy beats a random player; Medium beats Easy; Hard beats Medium", () => {
  const matchup = (a, b, games) => {
    let wins = 0;
    for (let g = 0; g < games; g++) {
      const s = game(a, b, g % 2, rngFromSeed(`ladder-${g}`));
      if (s.winner === 0) wins++;
    }
    return wins;
  };
  assert.equal(matchup(robot("easy"), randomPlayer, 4), 4, "easy vs random");
  assert.ok(matchup(robot("medium"), robot("easy"), 4) >= 3, "medium vs easy");
  assert.ok(matchup(robot("hard"), robot("medium"), 2) >= 2, "hard vs medium");
});

test("the levels play visibly differently", () => {
  // From the same positions, how often each level strays from Hard's choice.
  const positions = [
    fen("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"),
    fen("r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8"),
    fen("r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10"),
  ];
  const distinct = (level) => positions.reduce((n, s) => n + new Set(Array.from({ length: 8 }, (_, k) => name(chooseMove(s, 0, rngFromSeed(`v-${k}`), { level })))).size, 0);
  const counts = Object.fromEntries(LEVEL_NAMES.map((level) => [level, distinct(level)]));
  assert.ok(counts.easy > counts.medium && counts.medium >= counts.hard, JSON.stringify(counts));
});

test("each level answers fast, even in a busy middlegame", () => {
  const busy = [
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 8",
    "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
  ].map(fen);
  for (const level of LEVEL_NAMES) {
    for (const s of busy) {
      const { nodes } = scoreMoves(s, legalMoves(s), LEVELS[level]);
      assert.ok(nodes <= LEVELS[level].maxNodes + 1, `${level}: ${nodes} nodes`);
      const t0 = performance.now();
      chooseMove(s, 0, () => 0.5, { level });
      assert.ok(performance.now() - t0 < 300, level);
    }
  }
  // A time budget stops the search early but still answers.
  const t0 = performance.now();
  const move = chooseMove(busy[0], 0, () => 0.5, { level: "hard", maxNodes: Infinity, depth: 6, timeMs: 30 });
  assert.ok(performance.now() - t0 < 150);
  assert.ok(listMoves(busy[0]).some((m) => m.from === move.from && m.to === move.to));
});
