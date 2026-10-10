import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../engine/rng.js";
import { KnownDeck, shuffled, settleAll } from "../../test/fixtures/known-deck.js";
import { makeRules, forcedMove, bestKnock } from "./rules.js";
import { chooseMove, timeoutMove, knowledge, danger } from "./robot.js";

const F = (name) => "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));
const L = (names) => (names ? names.split(" ").map(F) : []);

// A seeded game straight on the rules, each robot seeing only its own seat's cards.
function game(levels, config, seed, { faces = shuffled(`deck ${seed}`), onMove = () => {} } = {}) {
  const deck = new KnownDeck(faces, `reshuffle ${seed}`);
  const rules = makeRules(config);
  const rng = rngFromSeed(`robots ${seed}`);
  const state = rules.newState(Math.floor(rng() * 2), 2, deck);
  settleAll(rules, state, deck);
  let worst = 0;
  let moves = 0;
  while (state.winner === -1) {
    const p = state.turn;
    const t0 = performance.now();
    const m = chooseMove(state, p, rng, deck.view(p), { level: levels[p] });
    worst = Math.max(worst, performance.now() - t0);
    onMove(state, p, m, deck);
    for (const slot of rules.reveals(state, p, m)) deck.open(slot);
    rules.applyMove(state, p, m, deck);
    settleAll(rules, state, deck);
    assert.ok(++moves < 5000, "the game ends");
  }
  return { state, worst };
}

// A hand where seat 1 (to move) holds `mine`, seat 0 `theirs`, the pile is `pile` (top last) and `log` is what happened.
function position({ mine, theirs, pile, phase = "discard", stock = 20, log = [], taken = null, open = [] }) {
  const order = [...L(theirs), ...L(mine), ...L(pile)];
  for (let f = 0; f < 52; f++) if (!order.includes(f)) order.push(f);
  const deck = new KnownDeck(order);
  const state = makeRules({ dealer: "host" }).newState(0, 2, { cards: [...Array(52).keys()], deal() {}, open() {} });
  let at = 0;
  state.hands = [L(theirs), L(mine)].map((names, p) => names.map(() => {
    deck.slots[at].owner = p;
    return at++;
  }));
  state.discard = L(pile).map(() => {
    deck.slots[at].open = true;
    return at++;
  });
  for (const name of open) deck.slots[order.indexOf(F(name))].open = true;
  state.stock = deck.cards.slice(at, at + stock);
  const slotOf = (name) => order.indexOf(F(name));
  Object.assign(state, { phase, turn: 1, limit: 10, taken: taken && slotOf(taken), log: log.map((e) => ({ ...e, slot: e.slot && slotOf(e.slot) })) });
  return { state, deck, face: deck.view(1), slotOf };
}

test("every level only makes legal moves, and lays down and defends as the rules' forced move", () => {
  for (const level of ["easy", "medium", "hard"]) {
    for (const config of [{}, { knock: "oklahoma" }, { bigGin: true }, { target: 0 }]) {
      for (let s = 0; s < 6; s++) {
        game([level, level], config, `legal ${level} ${JSON.stringify(config)} ${s}`, {
          onMove(state, p, m, deck) {
            const face = deck.view(p);
            const forced = forcedMove(state, p, face);
            if (forced) return assert.deepEqual(m, forced);
            if (state.phase === "upcard") assert.ok(m.take === true || m.pass === true);
            else if (state.phase === "draw") assert.ok(m.draw === "stock" || m.draw === "pile");
            else if (state.phase === "discard") {
              if (m.discard !== undefined) assert.ok(state.hands[p].includes(m.discard) && m.discard !== state.taken);
              if (m.knock) assert.ok(m.discard === undefined ? state.bigGin : bestKnock(state, p, face).points <= state.limit);
            } else assert.deepEqual(m, { next: true });
          },
        });
      }
    }
  }
});

test("Easy takes from the pile only to complete a meld, throws its highest deadwood and knocks as soon as it can", () => {
  // 7♥ makes 7♠ 7♦ a set; Q♣ only pairs with nothing.
  const take = position({ phase: "draw", mine: "7S 7D 2C 3H 9C KS JD 4S 5H 8D", theirs: "AS 2S 3S 4D 5D 6D 8S 9S 10S JH", pile: "QC 7H" });
  assert.deepEqual(chooseMove(take.state, 1, () => 0, take.face, { level: "easy" }), { draw: "pile" });
  const pass = position({ phase: "draw", mine: "7S 7D 2C 3H 9C KS JD 4S 5H 8D", theirs: "AS 2S 3S 4D 5D 6D 8S 9S 10S JH", pile: "7H QC" });
  assert.deepEqual(chooseMove(pass.state, 1, () => 0, pass.face, { level: "easy" }), { draw: "stock" });
  pass.state.phase = "upcard";
  assert.deepEqual(chooseMove(pass.state, 1, () => 0, pass.face, { level: "easy" }), { pass: true });
  // Eleven cards: K♠ is the highest deadwood.
  const d = position({ mine: "7S 7D 7C 2C 3H 9C KS 4S 5H 8D QD", theirs: "AS 2S 3S 4D 5D 6D 8S 9S 10S JH", pile: "10C" });
  const m = chooseMove(d.state, 1, () => 0, d.face, { level: "easy" });
  assert.ok([d.slotOf("KS"), d.slotOf("QD")].includes(m.discard), "a 10-point card goes");
  // Ten points of deadwood after the throw: it knocks at once.
  const k = position({ mine: "7S 7D 7C 2S 3S 4S 9H 10H JH 2C KD", theirs: "AS 2D 3C 4D 5D 6D 8S 9S 10S JD", pile: "10C" });
  assert.deepEqual(chooseMove(k.state, 1, () => 0, k.face, { level: "easy" }), { discard: k.slotOf("KD"), knock: true });
});

test("Medium keeps cards that may still meld, and doesn't throw next to the card just taken", () => {
  // 9♣ and 10♣ may still meld (8♣, J♣); J♦ is alone.
  const keep = position({ mine: "7S 7D 7C 2S 3S 4S 9C 10C JD 5H 6D", theirs: "AS 2D 3C 4D 5D KD 8S 9S 10S QH", pile: "KC" });
  assert.equal(chooseMove(keep.state, 1, () => 0, keep.face, { level: "medium" }).discard, keep.slotOf("JD"));
  assert.notEqual(chooseMove(keep.state, 1, () => 0, keep.face, { level: "easy" }).discard, keep.slotOf("5H"), "Easy keeps nothing for later");
  // The other player just took J♥: Medium won't throw J♦ (a set for them), Easy would.
  const feed = position({ mine: "7S 7D 7C 2S 3S 4S 9C 10C JD 5H 6D", theirs: "AS 2D 3C 4D 5D KD 8S 9S 10S JH", pile: "KC", open: ["JH"], log: [{ t: "take", p: 0, slot: "JH" }] });
  assert.notEqual(chooseMove(feed.state, 1, () => 0, feed.face, { level: "medium" }).discard, feed.slotOf("JD"));
});

test("Hard counts what is gone: a card whose every meld is out of play is safe to throw", () => {
  // Both other kings are on the pile and Q♠ is in my hand, so K♠ can't help anyone.
  const p = position({ mine: "7S 7D 7C 2S 3S 4S 9C 10C KS QH 6D", theirs: "AS 2D 3C 4D 5D QD 8S 9S 10S JH", pile: "KD KC JS QS" });
  const know = knowledge(p.state, 1, p.face);
  assert.equal(danger(F("KS"), know), 0);
  assert.ok(danger(F("QH"), know) > 0);
  // With J♥ taken by the other player, Q♥ is risky; the safe K♠ goes instead.
  const t = position({ mine: "7S 7D 7C 2S 3S 4S 9C 10C KS QH 6D", theirs: "AS 2D 3C 4D 5D QD 8S 9S 10S JH", pile: "KD KC JS QS", open: ["JH"], log: [{ t: "take", p: 0, slot: "JH" }] });
  assert.equal(chooseMove(t.state, 1, () => 0, t.face, { level: "hard" }).discard, t.slotOf("KS"));
  assert.ok(danger(F("QH"), knowledge(t.state, 1, t.face)) > danger(F("QH"), know), "the take makes Q♥ riskier");
  // Cards the other player holds aren't out of play: with 8♥ and 8♣ taken, 8♦ still makes their set.
  const held = position({ mine: "7S 7D 7C 2S 3S 4S 6D 9D KS QH 8D", theirs: "AS 2D 3C 4D 5D QD 8S 9S 10S JH", pile: "10D 8H 8C", open: ["8H", "8C"], log: [{ t: "take", p: 0, slot: "8H" }, { t: "take", p: 0, slot: "8C" }] });
  held.state.hands[0].push(held.slotOf("8H"), held.slotOf("8C"));
  held.state.discard = [held.slotOf("10D")];
  for (const name of ["8H", "8C"]) held.deck.slots[held.slotOf(name)].owner = 0;
  assert.ok(danger(F("8D"), knowledge(held.state, 1, held.face)) > 1);
});

test("Hard plays on for gin with low deadwood early, and knocks once the stock runs low", () => {
  const early = position({ mine: "7S 7D 7C 2S 3S 4S 9H 10H JH AC KD", theirs: "AS 2D 3C 4D 5D QD 8S 9S 10S JD", pile: "10C", stock: 25 });
  assert.equal(bestKnock(early.state, 1, early.face).points, 1);
  assert.equal(chooseMove(early.state, 1, () => 0, early.face, { level: "hard" }).knock, undefined);
  assert.equal(chooseMove(early.state, 1, () => 0, early.face, { level: "easy" }).knock, true);
  const late = position({ mine: "7S 7D 7C 2S 3S 4S 9H 10H JH AC KD", theirs: "AS 2D 3C 4D 5D QD 8S 9S 10S JD", pile: "10C", stock: 6 });
  assert.equal(chooseMove(late.state, 1, () => 0, late.face, { level: "hard" }).knock, true);
});

test("the timer's move: the forced one, else what Hard would do; the next hand when the scores are up", () => {
  const p = position({ mine: "7S 7D 7C 2S 3S 4S 9H 10H JH 2C KD", theirs: "AS 2D 3C 4D 5D QD 8S 9S 10S JD", pile: "10C" });
  assert.deepEqual(timeoutMove(p.state, 1, p.face), chooseMove(p.state, 1, () => 0, p.face, { level: "hard" }));
  p.state.phase = "result";
  assert.deepEqual(timeoutMove(p.state, 1, p.face), { next: true });
});

test("a robot never reads the other hand: swapping its hidden cards for others leaves every choice the same", () => {
  // Seat 0 is scripted so its own ten cards stay hidden: it passes, draws from the stock and throws what it drew.
  const script = (st, p) => (st.phase === "upcard" ? { pass: true } : st.phase === "draw" ? { draw: "stock" } : st.phase === "discard" ? { discard: st.hands[p].at(-1) } : null);
  let compared = 0;
  for (const level of ["easy", "medium", "hard"]) {
    for (let s = 0; s < 12; s++) {
      // Two deals that differ only in seat 0's hand (the dealer's: every second card), traded with the stock's bottom ten.
      const base = shuffled(`peek ${level} ${s}`);
      const other = base.slice();
      for (let k = 0; k < 10; k++) [other[2 * k + 1], other[42 + k]] = [other[42 + k], other[2 * k + 1]];
      const games = [base, other].map((faces) => {
        const deck = new KnownDeck(faces);
        const rules = makeRules({ dealer: "host" });
        const state = rules.newState(0, 2, deck);
        settleAll(rules, state, deck);
        return { deck, rules, state, rng: rngFromSeed(`peek ${s}`) };
      });
      // What seat 1 may see: its hand, the pile and every open card.
      const sees = (g) => JSON.stringify(g.deck.slots.map((x, id) => (!x.gone && (x.open || x.owner === 1) ? [id, x.face] : null)));
      while (games[0].state.phase !== "lay" && games[0].state.winner === -1 && sees(games[0]) === sees(games[1])) {
        const p = games[0].state.turn;
        const moves = games.map((g) => (p === 1 ? chooseMove(g.state, 1, g.rng, g.deck.view(1), { level }) : script(g.state, 0)));
        if (p === 1) {
          assert.deepEqual(moves[0], moves[1], `${level}, game ${s}, move ${games[0].state.moves}`);
          compared++;
        }
        if (!moves[0]) break;
        games.forEach((g, k) => {
          for (const slot of g.rules.reveals(g.state, p, moves[k])) g.deck.open(slot);
          g.rules.applyMove(g.state, p, moves[k], g.deck);
          settleAll(g.rules, g.state, g.deck);
        });
      }
    }
  }
  assert.ok(compared > 300, `${compared} choices compared`);
});

test("Hard beats Easy most of the time, and Medium sits between them", () => {
  const n = 200;
  const rate = (a, b) => {
    let wins = 0;
    for (let i = 0; i < n; i++) {
      const seat = i % 2;
      if (game(seat ? [b, a] : [a, b], { dealer: i % 4 < 2 ? "host" : "guest" }, `${a} v ${b} ${i}`).state.winner === seat) wins++;
    }
    return wins / n;
  };
  // Games to 100: about 69%, 59% and 59% over 600 games.
  const hard = rate("hard", "easy");
  assert.ok(hard > 0.6, `Hard won ${hard * 100}% against Easy`);
  const medium = rate("medium", "easy");
  assert.ok(medium > 0.52, `Medium won ${medium * 100}% against Easy`);
  const top = rate("hard", "medium");
  assert.ok(top > 0.52, `Hard won ${top * 100}% against Medium`);
});

test("robot vs robot always finishes, every level and rule, well under 100 ms a choice", () => {
  let worst = 0;
  for (const config of [{}, { knock: "oklahoma" }, { bigGin: true }, { target: 0 }, { knock: "oklahoma", bigGin: true, dealer: "guest" }]) {
    for (const levels of [["easy", "hard"], ["medium", "hard"], ["hard", "hard"], ["easy", "medium"]]) {
      for (let s = 0; s < 4; s++) {
        const r = game(levels, config, `${levels}-${JSON.stringify(config)}-${s}`);
        worst = Math.max(worst, r.worst);
        assert.equal(r.state.phase, "over");
        assert.ok(r.state.final);
      }
    }
  }
  assert.ok(worst < 50, `slowest choice took ${worst.toFixed(1)} ms`);
});
