import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { KnownDeck, shuffled } from "../../test/fixtures/known-deck.js";
import { makeRules, forcedMove, askable, ranksIn, rankOf } from "./rules.js";
import { chooseMove, timeoutMove, knowledge } from "./robot.js";

const F = (name) => "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));
const R = (name) => ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name);

// A seeded game straight on the rules, each robot seeing only its own seat's cards.
function game(levels, config, seed, { faces = shuffled(`deck ${seed}`), onMove = () => {} } = {}) {
  const players = levels.length;
  const deck = new KnownDeck(faces);
  const rules = makeRules(config);
  const rng = rngFromSeed(`robots ${seed}`);
  const state = rules.newState(Math.floor(rng() * players), players, deck);
  let worst = 0;
  while (state.winner === -1) {
    const p = state.turn;
    const t0 = performance.now();
    const m = chooseMove(state, p, rng, deck.view(p), { level: levels[p] });
    worst = Math.max(worst, performance.now() - t0);
    onMove(state, p, m, deck);
    for (const slot of rules.reveals(state, p, m)) deck.open(slot);
    rules.applyMove(state, p, m, deck);
  }
  return { state, worst };
}

// A position after the opening round: seat 0 to ask, holding `mine`; the others hold `theirs`; `log` is what the table saw.
function position({ mine, theirs, log = [], stock = 20 }) {
  const all = [mine, ...theirs].flat().map(F);
  for (let f = 0; f < 52; f++) if (!all.includes(f)) all.push(f);
  const deck = new KnownDeck(all);
  const state = makeRules({}).newState(0, theirs.length + 1, { cards: [...Array(52).keys()], deal() {} });
  let at = 0;
  state.hands = [mine, ...theirs].map((names, p) => names.map(() => {
    deck.slots[at].owner = p;
    return at++;
  }));
  state.stock = deck.cards.slice(at, at + stock);
  Object.assign(state, { phase: "ask", turn: 0, log });
  return { state, deck, face: deck.view(0) };
}

test("every level only makes legal moves, and its answers, books and lucky fish are the honest ones", () => {
  for (const level of ["easy", "medium", "hard"]) {
    for (const config of [{}, { books: 2, empty: "out" }, { lucky: "pass", hand: 5 }]) {
      for (const players of [2, 3, 4]) {
        game(Array(players).fill(level), config, `legal ${level} ${players} ${JSON.stringify(config)}`, {
          onMove(state, p, m, deck) {
            const face = deck.view(p);
            const truth = forcedMove(state, p, face);
            if (truth) return assert.deepEqual(m, truth);
            assert.ok(askable(state, p).includes(m.from), "asks someone with cards");
            assert.ok(ranksIn(state.hands[p], face).includes(m.ask), "for a rank it holds");
          },
        });
      }
    }
  }
});

test("Medium asks back whoever just asked for a rank it holds, and doesn't repeat an ask answered 'Go fish'", () => {
  const p = position({ mine: ["7S", "2H"], theirs: [["3C"], ["4C"], ["5C"]], log: [{ t: "ask", p: 2, to: 1, rank: R("7") }, { t: "fish", p: 1, to: 2, rank: R("7") }, { t: "draw", p: 2, why: "fish" }] });
  for (let i = 0; i < 20; i++) assert.deepEqual(chooseMove(p.state, 0, rngFromSeed(`m${i}`), p.face, { level: "medium" }), { ask: R("7"), from: 2 });
  // Once they've handed their 7s over, they don't have them any more.
  p.state.log.push({ t: "ask", p: 3, to: 2, rank: R("7") }, { t: "give", p: 2, to: 3, rank: R("7"), n: 1 });
  for (let i = 0; i < 20; i++) assert.deepEqual(chooseMove(p.state, 0, rngFromSeed(`m${i}`), p.face, { level: "medium" }), { ask: R("7"), from: 3 });
  // In Pairs, another player's pair of 7s leaves seat 2's 7 where it was.
  const pairs = position({ mine: ["7S", "2H"], theirs: [["3C"], ["4C"], ["5C"]], log: [{ t: "ask", p: 2, to: 1, rank: R("7") }, { t: "fish", p: 1, to: 2, rank: R("7") }, { t: "book", p: 3, rank: R("7") }] });
  pairs.state.bookSize = 2;
  for (let i = 0; i < 20; i++) assert.deepEqual(chooseMove(pairs.state, 0, rngFromSeed(`m${i}`), pairs.face, { level: "medium" }), { ask: R("7"), from: 2 });
  const q = position({ mine: ["7S"], theirs: [["3C"], ["4C"]], log: [{ t: "ask", p: 0, to: 1, rank: R("7") }, { t: "fish", p: 1, to: 0, rank: R("7") }] });
  for (let i = 0; i < 20; i++) assert.equal(chooseMove(q.state, 0, rngFromSeed(`m${i}`), q.face, { level: "medium" }).from, 2);
});

test("Hard asks whoever has shown a rank, prefers its threes, and skips whoever just said 'Go fish'", () => {
  // Seat 2 asked for 9s earlier: it holds one.
  const p = position({ mine: ["7S", "9H", "2D"], theirs: [["3C", "4C"], ["5C", "6C"], ["8C", "10C"]], log: [{ t: "ask", p: 2, to: 1, rank: R("9") }, { t: "fish", p: 1, to: 2, rank: R("9") }, { t: "draw", p: 2, why: "fish" }] });
  assert.deepEqual(chooseMove(p.state, 0, rngFromSeed("h"), p.face, { level: "hard" }), { ask: R("9"), from: 2 });
  // Seat 1 has shown both a 7 and a 2: completing a book of 7s comes first.
  const shown = [R("2"), R("7")].flatMap((rank) => [{ t: "ask", p: 1, to: 0, rank }, { t: "fish", p: 0, to: 1, rank }]);
  const t = position({ mine: ["7S", "7H", "7D", "2D"], theirs: [["3C", "4C", "5C"]], log: shown });
  assert.equal(chooseMove(t.state, 0, rngFromSeed("h"), t.face, { level: "hard" }).ask, R("7"));
  // Seat 1 just said "Go fish" to 7s and hasn't drawn: ask seat 2 instead.
  const f = position({ mine: ["7S", "7H", "7D"], theirs: [["3C", "4C", "5C"], ["6C", "8C", "9C"]], log: [{ t: "ask", p: 0, to: 1, rank: R("7") }, { t: "fish", p: 1, to: 0, rank: R("7") }] });
  assert.deepEqual(chooseMove(f.state, 0, rngFromSeed("h"), f.face, { level: "hard" }), { ask: R("7"), from: 2 });
  const k = knowledge(f.state, f.face);
  assert.equal(k.lacks[1][R("7")], 0);
  // Once seat 1 has drawn a card, it might hold one again, if not likely.
  f.state.log.push({ t: "draw", p: 1, why: "fish" });
  assert.equal(knowledge(f.state, f.face).lacks[1][R("7")], 1);
});

test("between asks as likely to succeed, Hard asks for a rank it has already shown", () => {
  // Seat 0 holds a 7 and a 9, and showed its 7 as a lucky fish; nothing is known about seat 1's hand.
  const log = [{ t: "lucky", p: 0, rank: R("7") }];
  const p = position({ mine: ["7S", "9H"], theirs: [["3C", "4C", "5C", "6C"]], log });
  for (let i = 0; i < 20; i++) assert.equal(chooseMove(p.state, 0, rngFromSeed(`shown ${i}`), p.face, { level: "hard" }).ask, R("7"));
});

test("Hard remembers a rank another player holds after a pair of it goes down, until all four are booked", () => {
  const log = [{ t: "ask", p: 2, to: 1, rank: R("7") }, { t: "fish", p: 1, to: 2, rank: R("7") }, { t: "draw", p: 2, why: "fish" }, { t: "book", p: 1, rank: R("7") }];
  const p = position({ mine: ["7S", "9H"], theirs: [["3C", "4C"], ["5C", "6C"]], log });
  p.state.bookSize = 2;
  assert.equal(knowledge(p.state, p.face).has[2][R("7")], 1, "seat 2 still holds its 7");
  assert.deepEqual(chooseMove(p.state, 0, rngFromSeed("pairs"), p.face, { level: "hard" }), { ask: R("7"), from: 2 });
  p.state.log.push({ t: "book", p: 0, rank: R("7") });
  assert.equal(knowledge(p.state, p.face).has[2][R("7")], 0, "all four booked");
});

test("the timer's move: the honest one, else a sensible ask", () => {
  const p = position({ mine: ["7S", "9H"], theirs: [["3C"], ["5C"]], log: [{ t: "ask", p: 2, to: 1, rank: R("9") }, { t: "fish", p: 1, to: 2, rank: R("9") }] });
  assert.deepEqual(timeoutMove(p.state, 0, p.face), { ask: R("9"), from: 2 });
  p.state.phase = "answer";
  p.state.turn = 0;
  p.state.ask = { from: 1, to: 0, rank: R("7") };
  assert.deepEqual(timeoutMove(p.state, 0, p.face), { give: [0] });
});

test("a robot never reads another seat's cards: while the table looks the same, its moves don't change when that seat holds other ranks", () => {
  let compared = 0;
  for (const level of ["easy", "medium", "hard"]) {
    for (let s = 0; s < 20; s++) {
      // Three seats; in the second game seat 2 is dealt other ranks, from the bottom of the stock.
      const base = shuffled(`peek ${level} ${s}`);
      const first = s % 3;
      const other = base.slice();
      const seat2 = [0, 1, 2, 3, 4, 5, 6].map((r) => r * 3 + ((2 - first + 3) % 3));
      for (const i of seat2) {
        const j = other.findIndex((f, k) => k >= 40 && rankOf(f) !== rankOf(other[i]) && !seat2.some((x) => rankOf(other[x]) === rankOf(f)));
        if (j >= 0) [other[i], other[j]] = [other[j], other[i]];
      }
      const games = [base, other].map((faces) => {
        const deck = new KnownDeck(faces);
        const rules = makeRules({});
        // A random stream per seat: seat 2's robot may draw more numbers with its other hand.
        return { deck, rules, state: rules.newState(first, 3, deck), rngs: [0, 1, 2].map((p) => rngFromSeed(`peek ${s} ${p}`)) };
      });
      // Step both games together while every public fact is the same; seats 0 and 1 must choose alike.
      while (games[0].state.winner === -1 && JSON.stringify(games[0].state) === JSON.stringify(games[1].state)) {
        const p = games[0].state.turn;
        const moves = games.map((g) => chooseMove(g.state, p, g.rngs[p], g.deck.view(p), { level }));
        if (p !== 2) {
          assert.deepEqual(moves[0], moves[1], `${level}, game ${s}, seat ${p}`);
          compared++;
        }
        games.forEach((g, i) => {
          for (const slot of g.rules.reveals(g.state, p, moves[i])) g.deck.open(slot);
          g.rules.applyMove(g.state, p, moves[i], g.deck);
        });
      }
    }
  }
  assert.ok(compared > 200, `${compared} moves compared`);
});

test("Hard beats Easy most of the time", () => {
  let wins = 0;
  const n = 1000;
  for (let i = 0; i < n; i++) {
    const seat = i % 2;
    if (game(seat ? ["easy", "hard"] : ["hard", "easy"], {}, `hve ${i}`).state.winner === seat) wins++;
  }
  // Two-player Go Fish is mostly luck: about 62%, against 50% for even players.
  assert.ok(wins / n > 0.58, `Hard won ${wins} of ${n}`);
  // Against three Easy robots, choosing whom to ask counts for far more.
  let four = 0;
  for (let i = 0; i < 200; i++) {
    const levels = ["easy", "easy", "easy", "easy"];
    levels[i % 4] = "hard";
    if (game(levels, {}, `four ${i}`).state.winners.includes(i % 4)) four++;
  }
  assert.ok(four / 200 > 0.6, `Hard won ${four} of 200 against three Easy robots`);
});

test("robot vs robot always finishes, every level and rule, well under 100 ms a move", () => {
  let worst = 0;
  for (const config of [{}, { lucky: "pass" }, { empty: "out" }, { books: 2 }, { hand: 7, empty: "out", lucky: "pass", books: 2 }]) {
    for (const levels of [["hard", "medium"], ["easy", "hard", "medium"], ["hard", "hard", "hard", "hard"], ["easy", "medium", "hard", "easy"]]) {
      for (let s = 0; s < 10; s++) {
        const r = game(levels, config, `${levels}-${JSON.stringify(config)}-${s}`);
        worst = Math.max(worst, r.worst);
        assert.ok(r.state.winners.length >= 1 && r.state.hands.every((h) => !h.length));
      }
    }
  }
  assert.ok(worst < 100, `slowest move took ${worst.toFixed(1)} ms`);
});
