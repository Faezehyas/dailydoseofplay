import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { KnownDeck, shuffled } from "../../test/fixtures/known-deck.js";
import { makeRules, normalizeConfig, forcedMove, askable, ranksIn, handSize, booksDown, rankOf, DEFAULT_CONFIG } from "./rules.js";

// "7H" -> the face of the seven of hearts.
const F = (name) => "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));
const R = (name) => ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name);

// A game where seat p holds hands[p] (names) and the stock starts with
// `stock`, then every other card in order. Every face is known to the rules
// (as in the audit) unless `blind` (as in play). With `faces`, a plain deal.
function start({ hands, stock = [], first = 0, config = {}, blind = false, faces }) {
  const players = hands?.length ?? config.players ?? 2;
  const order = faces ?? [...(hands ?? []).flat(), ...stock].map(F);
  for (let f = 0; f < 52; f++) if (!order.includes(f)) order.push(f);
  const deck = new KnownDeck(order);
  deck.blind = blind;
  const rules = makeRules({ ...config, first: "random" });
  const state = rules.newState(first, players, deck);
  if (hands) {
    for (const s of deck.slots) s.owner = -1;
    state.hands = hands.map((names, p) => names.map((n) => {
      const slot = order.indexOf(F(n));
      deck.slots[slot].owner = p;
      return slot;
    }));
    const held = new Set(state.hands.flat());
    state.stock = order.map((_, slot) => slot).filter((slot) => !held.has(slot));
  }
  return { deck, rules, state };
}

// Plays a move as CardMatch would: the shown cards open first.
function move(g, player, m) {
  for (const slot of g.rules.reveals(g.state, player, m)) g.deck.open(slot);
  return g.rules.applyMove(g.state, player, m, g.deck);
}
const slots = (g, p, ...names) => names.map((n) => g.state.hands[p].find((slot) => g.deck.slots[slot].face === F(n)));
const names = (g, list) => list.map((slot) => g.deck.slots[slot].face);
const throws = (fn, re) => assert.throws(fn, (e) => e instanceof RuleError && re.test(e.message));
// Ends the opening round: everyone lays nothing.
function open(g) {
  while (g.state.phase === "open") move(g, g.state.turn, { done: true });
}

test("config: classic defaults, anything else falls back", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ hand: 6, lucky: "x", books: 3, empty: "out" }), { ...DEFAULT_CONFIG, empty: "out" });
  assert.deepEqual([handSize(2), handSize(3), handSize(4), handSize(4, 7), handSize(2, 5)], [7, 7, 5, 7, 5]);
});

test("the deal: 7 cards each for two or three players, 5 for four, the rest is the stock, then an opening round", () => {
  for (const players of [2, 3, 4]) {
    const g = start({ faces: shuffled(`deal ${players}`), config: { players } });
    const n = players === 4 ? 5 : 7;
    for (const [p, hand] of g.state.hands.entries()) {
      assert.equal(hand.length, n);
      for (const slot of hand) assert.equal(g.deck.owner(slot), p);
    }
    assert.equal(g.state.stock.length, 52 - n * players);
    assert.deepEqual([g.state.phase, g.state.turn], ["open", 0]);
    open(g);
    assert.deepEqual([g.state.phase, g.state.turn], ["ask", 0]);
  }
  const seven = start({ faces: shuffled("seven"), config: { players: 4, hand: 7 } });
  assert.ok(seven.state.hands.every((h) => h.length === 7));
});

test("the opening round: books dealt to you go down before anyone asks, in turn from the first player", () => {
  const g = start({ hands: [["7S", "7H", "7D", "7C", "2S"], ["3S", "4S", "5S", "6S", "8S"]], first: 1 });
  assert.equal(g.state.turn, 1, "the first player starts the round");
  move(g, 1, { done: true });
  throws(() => move(g, 0, { done: true }), /kept a book of 7s/);
  throws(() => move(g, 0, { book: slots(g, 0, "7S", "7H", "7D", "2S") }), /4 cards of one rank/);
  const [ev] = move(g, 0, { book: slots(g, 0, "7S", "7H", "7D", "7C") });
  assert.deepEqual([ev.type, ev.p, ev.rank], ["book", 0, R("7")]);
  assert.deepEqual(g.state.books[0].map((b) => b.rank), [R("7")]);
  assert.deepEqual(names(g, g.state.hands[0]), [F("2S")]);
  move(g, 0, { done: true });
  assert.deepEqual([g.state.phase, g.state.turn], ["ask", 1], "then the first player asks");
});

test("asking: a player who holds cards, for a rank you hold; checked with every face known", () => {
  const g = start({ hands: [["7S", "2H"], ["7H", "3H"], ["9D", "4H"]] });
  open(g);
  throws(() => move(g, 0, { ask: R("7"), from: 0 }), /ask a player who has cards/);
  throws(() => move(g, 0, { ask: R("7"), from: 3 }), /ask a player who has cards/);
  throws(() => move(g, 0, { ask: 13, from: 1 }), /ask for a rank/);
  throws(() => move(g, 0, { ask: R("9"), from: 1 }), /asked for 9s without holding one/);
  // During play the hand is hidden, so the same lie goes through, to be caught in the audit.
  const blind = start({ hands: [["7S", "2H"], ["7H", "3H"], ["9D", "4H"]], blind: true });
  open(blind);
  const [ev] = move(blind, 0, { ask: R("9"), from: 2 });
  assert.deepEqual(ev, { type: "ask", p: 0, to: 2, rank: R("9") });
  assert.deepEqual([blind.state.phase, blind.state.turn, blind.state.ask], ["answer", 2, { from: 0, to: 2, rank: R("9") }]);
  // Nobody can ask a player whose hand is empty.
  const e = start({ hands: [["7S", "2H"], ["7H", "3H"], ["9D", "4H"]] });
  open(e);
  e.state.hands[2] = [];
  throws(() => move(e, 0, { ask: R("7"), from: 2 }), /ask a player who has cards/);
  assert.deepEqual(askable(e.state, 0), [1]);
});

test("an answer hands over every card of the rank: shown, then the asker's, who goes again", () => {
  const g = start({ hands: [["7S", "2H", "3D"], ["7H", "7D", "5C"]] });
  open(g);
  move(g, 0, { ask: R("7"), from: 1 });
  throws(() => move(g, 0, { fish: true }), /not your turn/);
  throws(() => move(g, 1, { give: slots(g, 1, "5C") }), /hand over only 7s/);
  throws(() => move(g, 1, { give: slots(g, 1, "7H") }), /handed over only some 7s/);
  throws(() => move(g, 1, { fish: true }), /said "Go fish" while holding 7s/);
  const given = slots(g, 1, "7H", "7D");
  const [ev] = move(g, 1, { give: given });
  assert.deepEqual([ev.type, ev.p, ev.to, ev.rank, ev.slots], ["give", 1, 0, R("7"), given]);
  for (const slot of given) {
    assert.equal(g.deck.owner(slot), 0, "the asker's now");
    assert.ok(g.deck.slots[slot].open, "face up for everyone");
  }
  assert.deepEqual(names(g, g.state.hands[0]).sort(), [F("7S"), F("2H"), F("3D"), F("7H"), F("7D")].sort());
  assert.deepEqual([g.state.phase, g.state.turn, g.state.ask], ["ask", 0, null], "and asks again");
  assert.deepEqual(g.state.log.at(-1), { t: "give", p: 1, to: 0, rank: R("7"), n: 2 });
});

test("during play, a lie that face-up cards give away is refused at once", () => {
  // As in play: hidden faces are null. Seat 1's 7♥ is face up, as if handed over earlier.
  const g = start({ hands: [["7S", "2H"], ["7H", "7D", "5C"]], blind: true });
  open(g);
  g.deck.open(slots(g, 1, "7H")[0]);
  move(g, 0, { ask: R("7"), from: 1 });
  throws(() => move(g, 1, { fish: true }), /said "Go fish" while holding 7s/);
  throws(() => move(g, 1, { give: slots(g, 1, "7D") }), /handed over only some 7s/);
  // A hand of nothing but face-up cards can't ask for a rank it doesn't hold.
  const h = start({ hands: [["7S"], ["3H", "5C"]], blind: true });
  open(h);
  h.deck.open(slots(h, 0, "7S")[0]);
  throws(() => move(h, 0, { ask: R("9"), from: 1 }), /asked for 9s without holding one/);
});

test("Go fish: the asker draws; a lucky fish is shown and goes again, else the turn passes", () => {
  const g = start({ hands: [["7S", "2H"], ["5H", "3H"]], stock: ["7D", "9C"] });
  open(g);
  move(g, 0, { ask: R("7"), from: 1 });
  const events = move(g, 1, { fish: true });
  assert.deepEqual(events.map((e) => e.type), ["fish", "draw"]);
  const drawn = g.state.drawn;
  assert.equal(g.deck.slots[drawn].face, F("7D"));
  assert.deepEqual([g.state.phase, g.state.turn, g.deck.owner(drawn), g.deck.slots[drawn].open], ["drawn", 0, 0, false]);
  // Keeping a lucky fish hidden: seen only with every face known.
  throws(() => move(g, 0, { done: true }), /didn't show a lucky 7/);
  throws(() => move(g, 0, { show: g.state.hands[0][0] }), /show the card you drew/);
  const [ev] = move(g, 0, { show: drawn });
  assert.deepEqual([ev.type, ev.slot, ev.rank], ["lucky", drawn, R("7")]);
  assert.ok(g.deck.slots[drawn].open);
  assert.deepEqual([g.state.phase, g.state.turn], ["ask", 0], "goes again");
  // An unlucky one: the turn passes once the drawer is done.
  move(g, 0, { ask: R("2"), from: 1 });
  move(g, 1, { fish: true });
  assert.equal(g.deck.slots[g.state.drawn].face, F("9C"));
  throws(() => move(g, 0, { show: g.state.drawn }), /that isn't 2s/);
  const [pass] = move(g, 0, { done: true });
  assert.deepEqual([pass.type, g.state.phase, g.state.turn], ["pass", "ask", 1]);
});

test("with the lucky fish off, the turn always passes", () => {
  const g = start({ hands: [["7S", "2H"], ["5H", "3H"]], stock: ["7D"], config: { lucky: "pass" } });
  open(g);
  move(g, 0, { ask: R("7"), from: 1 });
  move(g, 1, { fish: true });
  throws(() => move(g, 0, { show: g.state.drawn }), /doesn't go again/);
  move(g, 0, { done: true });
  assert.equal(g.state.turn, 1);
});

test("Go fish with an empty stock passes the turn at once", () => {
  const g = start({ hands: [["7S", "2H"], ["5H", "3H"]] });
  open(g);
  g.state.stock = [];
  const events = move(g, 0, { ask: R("7"), from: 1 }).concat(move(g, 1, { fish: true }));
  assert.deepEqual(events.map((e) => e.type), ["ask", "fish"]);
  assert.deepEqual([g.state.phase, g.state.turn, g.state.drawn], ["ask", 1, null]);
});

test("books go down as soon as you have them: before asking and before ending a turn", () => {
  const g = start({ hands: [["7S", "7H", "7D", "2S"], ["7C", "3H", "4H", "5H"]], stock: ["2H"] });
  open(g);
  move(g, 0, { ask: R("7"), from: 1 });
  move(g, 1, { give: slots(g, 1, "7C") });
  throws(() => move(g, 0, { ask: R("2"), from: 1 }), /kept a book of 7s in hand/);
  move(g, 0, { book: slots(g, 0, "7S", "7H", "7D", "7C") });
  assert.equal(booksDown(g.state), 1);
  // A book completed by a draw goes down before the turn ends.
  const d = start({ hands: [["2S", "2D", "2C", "9S"], ["5H", "6H"]], stock: ["2H"] });
  open(d);
  move(d, 0, { ask: R("9"), from: 1 });
  move(d, 1, { fish: true });
  throws(() => move(d, 0, { done: true }), /kept a book of 2s/);
  move(d, 0, { book: slots(d, 0, "2S", "2D", "2C", "2H") });
  move(d, 0, { done: true });
  assert.deepEqual([d.state.turn, d.state.books[0].length], [1, 1]);
  // A lucky fish laid straight into its book is shown all the same: you go again.
  const l = start({ hands: [["2S", "2D", "2C"], ["5H", "6H"]], stock: ["2H", "9S"] });
  open(l);
  move(l, 0, { ask: R("2"), from: 1 });
  move(l, 1, { fish: true });
  const events = move(l, 0, { book: slots(l, 0, "2S", "2D", "2C", "2H") });
  assert.deepEqual(events.map((e) => e.type), ["book", "lucky", "draw"], "and with an empty hand, a card from the stock");
  assert.deepEqual([l.state.turn, l.state.phase], [0, "ask"]);
});

test("pairs: books of two, 26 of them", () => {
  const g = start({ hands: [["7S", "7H", "7D", "2S", "3S"], ["4S", "4H", "5H", "6H", "8H"]], config: { books: 2 } });
  move(g, 0, { book: slots(g, 0, "7S", "7H") });
  move(g, 0, { done: true });
  throws(() => move(g, 1, { done: true }), /kept a pair of 4s/);
  move(g, 1, { book: slots(g, 1, "4S", "4H") });
  move(g, 1, { done: true });
  assert.deepEqual(names(g, g.state.hands[0]).sort(), [F("7D"), F("2S"), F("3S")].sort(), "the third 7 stays in hand");
  throws(() => move(g, 0, { book: slots(g, 0, "7D", "2S") }), /2 cards of one rank/);
});

test("an empty hand draws one and carries on, or sits out", () => {
  for (const empty of ["draw", "out"]) {
    const z = start({ hands: [["7S", "7H", "7D"], ["7C", "3H", "4H"]], stock: ["9S", "9H"], config: { empty } });
    open(z);
    move(z, 0, { ask: R("7"), from: 1 });
    const events = move(z, 1, { give: slots(z, 1, "7C") }).concat(move(z, 0, { book: slots(z, 0, "7S", "7H", "7D", "7C") }));
    if (empty === "draw") {
      assert.deepEqual(events.map((e) => e.type), ["give", "book", "draw"]);
      assert.deepEqual([z.state.turn, z.state.phase, z.state.hands[0].length], [0, "ask", 1], "drew one and carries on");
    } else {
      // Seat 0 sits out for good, so seat 1, with nobody left to ask, takes the stock.
      assert.deepEqual(events.map((e) => e.type), ["give", "book", "out", "take"]);
      assert.deepEqual([z.state.turn, z.state.phase, z.state.hands[0].length, z.state.stock.length], [1, "ask", 0, 0], "sits out");
    }
  }
});

test("a player who runs out of cards with nothing to draw is announced as out, once", () => {
  const g = start({ hands: [["7S", "2H"], ["7H"], ["9D", "4H"]], config: { empty: "out" } });
  open(g);
  move(g, 0, { ask: R("7"), from: 1 });
  const events = move(g, 1, { give: slots(g, 1, "7H") });
  assert.deepEqual(events.map((e) => e.type), ["give", "out"], "handing over the last card");
  assert.deepEqual(g.state.out, [false, true, false]);
  assert.deepEqual(g.state.log.filter((e) => e.t === "out"), [{ t: "out", p: 1 }]);
  move(g, 0, { ask: R("2"), from: 2 });
  move(g, 2, { fish: true });
  move(g, 0, { done: true });
  assert.equal(g.state.turn, 2, "seat 1 is skipped");
  assert.equal(g.state.log.filter((e) => e.t === "out").length, 1, "and not announced again");
});

test("nobody to ask: you draw one and the turn ends; with everyone else out, you take the stock", () => {
  const draw = start({ hands: [["7S", "2H"], ["7H", "7D"]], stock: ["7C", "9S"] });
  open(draw);
  move(draw, 0, { ask: R("7"), from: 1 });
  // Seat 1 has no cards left, so seat 0, who would ask again, draws one and the turn ends.
  const ev = move(draw, 1, { give: slots(draw, 1, "7H", "7D") });
  assert.deepEqual(ev.map((e) => e.type), ["give", "draw"]);
  assert.equal(draw.state.hands[1].length, 0);
  assert.deepEqual([draw.state.phase, draw.state.turn], ["drawn", 0]);
  assert.deepEqual(names(draw, draw.state.hands[0]).sort(), [F("7S"), F("2H"), F("7H"), F("7D"), F("7C")].sort());
  assert.equal(draw.state.drawn, null, "not a Go fish: nothing to show");
  move(draw, 0, { book: slots(draw, 0, "7S", "7H", "7D", "7C") });
  move(draw, 0, { done: true });
  assert.deepEqual([draw.state.turn, draw.state.phase, draw.state.hands[1].length], [1, "ask", 1], "seat 1 draws one and asks");

  const out = start({ hands: [["7S", "2H"], ["7H", "7D"]], stock: ["7C", "9S", "2S"], config: { empty: "out" } });
  open(out);
  move(out, 0, { ask: R("7"), from: 1 });
  const evs = move(out, 1, { give: slots(out, 1, "7H", "7D") });
  assert.deepEqual(evs.map((e) => e.type), ["give", "out", "take"], "seat 1 is out for good");
  assert.equal(out.state.stock.length, 0);
  assert.equal(out.state.hands[0].length, 52, "every card left: the whole stock too");
});

test("the end: all 13 books down, the most books wins, and a tie is a shared win", () => {
  // Two players with every rank split 4 and 0: lay them all.
  const g = start({ faces: shuffled("end"), config: { players: 2 } });
  open(g);
  // Rig the hands: seat 0 holds 7 ranks, seat 1 six, the stock nothing.
  g.state.stock = [];
  g.state.hands = [[], []];
  for (let i = 0; i < 13; i++) {
    const p = i < 7 ? 0 : 1;
    for (let s = 0; s < 52; s++) if (g.deck.slots[s].face % 13 === i) (g.deck.slots[s].owner = p), g.state.hands[p].push(s);
  }
  for (let i = 0; i < 6; i++) move(g, 0, { book: g.state.hands[0].filter((s) => g.deck.slots[s].face % 13 === i) });
  assert.equal(g.state.winner, -1);
  const last = move(g, 0, { book: g.state.hands[0].slice() });
  // Seat 0's hand is empty: no stock, so it sits out and seat 1 lays the rest.
  assert.deepEqual(last.map((e) => e.type), ["book", "out"]);
  assert.equal(g.state.turn, 1);
  for (let i = 7; i < 13; i++) move(g, 1, { book: g.state.hands[1].filter((s) => g.deck.slots[s].face % 13 === i) });
  assert.equal(booksDown(g.state), 13);
  assert.deepEqual([g.state.winner, g.state.winners, g.state.phase], [0, [0], "over"]);
  throws(() => move(g, 1, { done: true }), /the game is over/);

  // Pairs between two players: 13 each is a tie.
  const suits = (a, b) => ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].flatMap((r) => [r + a, r + b]);
  const t = start({ hands: [suits("S", "H"), suits("D", "C")], config: { books: 2 } });
  while (t.state.winner === -1) {
    const p = t.state.turn;
    move(t, p, forcedMove(t.state, p, (s) => t.deck.slots[s].face));
  }
  assert.deepEqual(t.state.winners, [0, 1]);
  assert.deepEqual(t.state.books.map((b) => b.length), [13, 13]);
});

test("illegal moves throw RuleError: out of turn, the wrong phase, malformed", () => {
  const g = start({ hands: [["7S", "2H"], ["5H", "3H"]] });
  throws(() => move(g, 1, { done: true }), /not your turn/);
  throws(() => move(g, 0, { ask: R("7"), from: 1 }), /doesn't fit now/);
  open(g);
  throws(() => move(g, 0, { done: true }), /doesn't fit now/);
  throws(() => move(g, 0, { give: slots(g, 0, "7S") }), /doesn't fit now/);
  throws(() => move(g, 0, null), /bad move/);
  throws(() => move(g, 0, { book: "7" }), /4 cards of one rank/);
  throws(() => move(g, 0, { book: [1, 1, 1, 1] }), /4 cards of one rank/);
  throws(() => move(g, 0, { book: slots(g, 1, "5H", "3H").concat(slots(g, 0, "7S", "2H")) }), /aren't all in your hand/);
  throws(() => move(g, 0, { wave: true }), /doesn't fit now/);
  move(g, 0, { ask: R("7"), from: 1 });
  throws(() => move(g, 1, { give: [] }), /hand over the cards/);
  throws(() => move(g, 1, { give: slots(g, 0, "7S") }), /aren't in your hand/);
  throws(() => move(g, 1, { show: 3 }), /doesn't fit now/);
});

// A seeded game straight on the rules: forced moves, and random asks.
function randomGame(players, config, seed) {
  const g = start({ faces: shuffled(`deck ${seed}`), config: { ...config, players } });
  const rng = rngFromSeed(`asks ${seed}`);
  let moves = 0;
  while (g.state.winner === -1) {
    const p = g.state.turn;
    const face = g.deck.view(p);
    let m = forcedMove(g.state, p, face);
    if (!m) {
      const ranks = ranksIn(g.state.hands[p], face);
      const who = askable(g.state, p);
      m = { ask: ranks[Math.floor(rng() * ranks.length)], from: who[Math.floor(rng() * who.length)] };
    }
    move(g, p, m);
    if (++moves > 5000) throw new Error(`game ${seed} didn't finish`);
  }
  return g;
}

test("seeded full games for 2, 3 and 4 players always finish, every card in a book", () => {
  for (const players of [2, 3, 4]) {
    for (const config of [{}, { lucky: "pass" }, { empty: "out" }, { books: 2 }, { hand: 5, empty: "out", lucky: "pass" }]) {
      for (let s = 0; s < 25; s++) {
        const g = randomGame(players, config, `${players} ${JSON.stringify(config)} ${s}`);
        const per = config.books === 2 ? 26 : 13;
        assert.equal(booksDown(g.state), per);
        assert.ok(g.state.hands.every((h) => !h.length) && !g.state.stock.length);
        const best = Math.max(...g.state.books.map((b) => b.length));
        assert.deepEqual(g.state.winners, g.state.books.flatMap((b, p) => (b.length === best ? [p] : [])));
        for (const b of g.state.books.flat()) assert.ok(b.slots.every((slot) => rankOf(g.deck.slots[slot].face) === b.rank && g.deck.slots[slot].open));
      }
    }
  }
});
