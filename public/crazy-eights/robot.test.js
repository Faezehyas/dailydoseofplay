import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { KnownDeck, shuffled, settleAll } from "../../test/fixtures/known-deck.js";
import { makeRules, follows, isEight, suitOf, canDraw, playable } from "./rules.js";
import { chooseMove, timeoutMove } from "./robot.js";

const F = (name) => "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));

// A seeded game straight on the rules, each robot seeing only its own seat's cards.
function game(levels, config, seed, onMove = () => {}) {
  const players = levels.length;
  const deck = new KnownDeck(shuffled(`deck ${seed}`), `reshuffle ${seed}`);
  const rules = makeRules(config);
  const rng = rngFromSeed(`robots ${seed}`);
  const state = rules.newState(Math.floor(rng() * players), players, deck);
  settleAll(rules, state, deck);
  let worst = 0;
  while (state.winner === -1) {
    const p = state.turn;
    const t0 = performance.now();
    const m = chooseMove(state, p, rng, deck.view(p), { level: levels[p] });
    worst = Math.max(worst, performance.now() - t0);
    onMove(state, p, m, deck);
    for (const slot of rules.reveals(state, p, m)) deck.open(slot);
    rules.applyMove(state, p, m, deck);
    settleAll(rules, state, deck);
  }
  return { state, worst };
}

// A position: `mine` in seat 0's hand on `top`, the next seat holding `theirs`.
function position({ mine, top, theirs = ["2C", "3C", "4C"], config = {}, suit, history = [] }) {
  const faces = [...mine, ...theirs, top].map(F);
  for (let f = 0; f < 52; f++) if (!faces.includes(f)) faces.push(f);
  const deck = new KnownDeck(faces);
  const rules = makeRules(config);
  const state = rules.newState(0, 2, { cards: [...Array(52).keys()], deal() {} });
  state.hands = [mine.map((_, i) => i), theirs.map((_, i) => mine.length + i)];
  deck.cards.forEach((slot) => (deck.slots[slot].owner = slot < mine.length ? 0 : slot < mine.length + theirs.length ? 1 : -1));
  const topSlot = mine.length + theirs.length;
  deck.open(topSlot);
  state.discard = [topSlot];
  state.stock = deck.cards.slice(topSlot + 1);
  state.top = F(top);
  state.suit = suit ?? suitOf(F(top));
  state.starter = false;
  state.history = history;
  return { state, deck, face: deck.view(0), names: (slot) => [...mine, ...theirs][slot] };
}

test("every level only ever makes a legal move, and draws only when nothing plays", () => {
  for (const level of ["easy", "medium", "hard"]) {
    for (const config of [{}, { actions: true, draw: "one" }]) {
      game([level, level, level], config, `legal ${level} ${JSON.stringify(config)}`, (state, p, m, deck) => {
        const face = deck.view(p);
        if (m.draw) assert.equal(playable(state, p, face).length, 0, "drew with a card that plays");
        if (m.play !== undefined) {
          assert.ok(state.hands[p].includes(m.play) && follows(state, face(m.play)));
          assert.equal(isEight(face(m.play)), Number.isInteger(m.suit));
        }
      });
    }
  }
});

test("Medium follows suit before rank and keeps its 8s while anything else plays", () => {
  const p = position({ mine: ["8S", "9H", "5D"], top: "5H" });
  for (let i = 0; i < 20; i++) assert.equal(p.names(chooseMove(p.state, 0, rngFromSeed(`m${i}`), p.face, { level: "medium" }).play), "9H");
  const only8 = position({ mine: ["8S", "9C", "2C"], top: "5H" });
  const m = chooseMove(only8.state, 0, rngFromSeed("m"), only8.face, { level: "medium" });
  assert.deepEqual([only8.names(m.play), m.suit], ["8S", 3], "and names the suit it holds most of");
});

test("Hard keeps its 8 and names the suit the next player just drew on", () => {
  const p = position({ mine: ["8S", "KH", "3H", "4D", "9D"], top: "KC" });
  assert.equal(p.names(chooseMove(p.state, 0, rngFromSeed("h"), p.face, { level: "hard" }).play), "KH");
  // Down to the 8 and two others: it plays the 8 and names spades, which seat 1 lacks.
  const q = position({ mine: ["8S", "3H", "4D"], top: "KC", history: [{ t: "draw", p: 1, suit: 0, rank: 4 }] });
  const m = chooseMove(q.state, 0, rngFromSeed("h"), q.face, { level: "hard" });
  assert.deepEqual([q.names(m.play), m.suit], ["8S", 0]);
});

test("Hard sheds a high card when the choice is otherwise even", () => {
  const p = position({ mine: ["KH", "2H", "5S", "6D"], top: "9H" });
  assert.equal(p.names(chooseMove(p.state, 0, rngFromSeed("h"), p.face, { level: "hard" }).play), "KH");
});

test("Hard plays a 2 or a queen at a player close to going out", () => {
  const p = position({ mine: ["2H", "9H", "5S", "6D", "7C"], top: "KH", theirs: ["3C"], config: { actions: true } });
  assert.equal(p.names(chooseMove(p.state, 0, rngFromSeed("h"), p.face, { level: "hard" }).play), "2H");
  const q = position({ mine: ["QH", "9H", "5S", "6D", "7C"], top: "KH", theirs: ["3C"], config: { actions: true } });
  assert.equal(q.names(chooseMove(q.state, 0, rngFromSeed("h"), q.face, { level: "hard" }).play), "QH");
});

test("with nothing that plays, a robot draws, or passes when it can't", () => {
  const p = position({ mine: ["3S", "4D"], top: "KH" });
  assert.deepEqual(chooseMove(p.state, 0, rngFromSeed("d"), p.face, { level: "hard" }), { draw: true });
  p.state.stock = [];
  assert.ok(!canDraw(p.state));
  assert.deepEqual(chooseMove(p.state, 0, rngFromSeed("d"), p.face, { level: "easy" }), { pass: true });
});

test("the timer's move: the first card that plays, else draw", () => {
  const p = position({ mine: ["3S", "8D", "4H", "5H"], top: "KH" });
  assert.deepEqual(timeoutMove(p.state, 0, p.face), { play: 1, suit: 1 });
  const q = position({ mine: ["3S", "4D"], top: "KH" });
  assert.deepEqual(timeoutMove(q.state, 0, q.face), { draw: true });
});

test("a robot never reads another seat's cards: its moves don't change when that seat holds different cards", () => {
  for (const level of ["easy", "medium", "hard"]) {
    for (let s = 0; s < 20; s++) {
      const base = shuffled(`peek ${level} ${s}`);
      // The same game, except seat 1 is dealt other cards: its hand (deck positions 1, 3 … 13)
      // trades places with cards deep in the stock (30–36), which stay hidden for many turns.
      const other = base.slice();
      for (let i = 0; i < 7; i++) [other[1 + 2 * i], other[30 + i]] = [other[30 + i], other[1 + 2 * i]];
      const moves = [other, base].map((faces) => {
        const deck = new KnownDeck(faces, "same");
        const rules = makeRules({ strict: false, draw: "one" });
        const state = rules.newState(0, 2, deck);
        settleAll(rules, state, deck);
        const rng = rngFromSeed(`peek ${s}`);
        const mine = [];
        // Seat 1 draws one and passes, so both games stay the same in public; stop before a traded card comes out.
        while (state.winner === -1 && state.stock[0] < 30) {
          const m = state.turn === 0 ? chooseMove(state, 0, rng, deck.view(0), { level }) : state.drew ? { pass: true } : { draw: true };
          if (state.turn === 0) mine.push(m);
          for (const slot of rules.reveals(state, state.turn, m)) deck.open(slot);
          rules.applyMove(state, state.turn, m, deck);
          settleAll(rules, state, deck);
        }
        return mine;
      });
      assert.ok(moves[1].length > 2, "several turns compared");
      assert.deepEqual(moves[0], moves[1], `${level}, game ${s}`);
    }
  }
});

test("after a round of nothing but 8s, an 8 names a suit the next player probably holds", () => {
  // Four players have each played an 8 in turn, and seat 1 last drew on spades.
  const history = [0, 1, 2, 3].map((p) => ({ t: "play", p, face: F(["8S", "8H", "8D", "8C"][p]), suit: 0 }));
  history.push({ t: "draw", p: 1, suit: 0, rank: 7 });
  for (const level of ["easy", "medium", "hard"]) {
    const p = position({ mine: ["8S", "3S", "4S", "5S"], top: "KC", history });
    p.state.players = 4;
    p.state.hands.push([], []);
    p.state.strict = true;
    const m = chooseMove(p.state, 0, rngFromSeed("loop"), p.face, { level });
    if (p.names(m.play) === "8S") assert.notEqual(m.suit, 0, `${level} names a suit other than the one seat 1 lacks`);
  }
});

test("four Hard robots never play on to the move limit", () => {
  for (let s = 0; s < 300; s++) {
    const { state } = game(["hard", "hard", "hard", "hard"], {}, `limit ${s}`);
    assert.notEqual(state.ended, "long", `game ${s} ran to ${state.turns} turns`);
  }
});

test("Hard beats Easy most of the time", () => {
  let wins = 0;
  const n = 1000;
  for (let i = 0; i < n; i++) {
    const seat = i % 2;
    if (game(seat ? ["easy", "hard"] : ["hard", "easy"], {}, `hve ${i}`).state.winner === seat) wins++;
  }
  // Crazy Eights is mostly the deal: about 60%, against 50% for even players.
  assert.ok(wins / n > 0.55, `Hard won ${wins} of ${n}`);
});

test("robot vs robot always finishes, every level and rule, well under 100 ms a move", () => {
  let worst = 0;
  for (const config of [{}, { draw: "one" }, { actions: true }, { actions: true, draw: "one", strict: false }]) {
    for (const levels of [["hard", "medium"], ["easy", "hard", "medium"], ["hard", "hard", "hard", "hard"], ["easy", "medium", "hard", "easy"]]) {
      for (let s = 0; s < 10; s++) {
        const r = game(levels, config, `${levels}-${JSON.stringify(config)}-${s}`);
        worst = Math.max(worst, r.worst);
        assert.ok(r.state.winner >= 0);
      }
    }
  }
  assert.ok(worst < 100, `slowest move took ${worst.toFixed(1)} ms`);
});
