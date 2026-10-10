import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { KnownDeck, shuffled, settleAll } from "../../test/fixtures/known-deck.js";
import { makeRules, normalizeConfig, suitOf, rankOf, points, cardName, follows, canDraw, canPass, handSize, DEFAULT_CONFIG, MAX_TURNS } from "./rules.js";
import { chooseMove } from "./robot.js";

// "7H" -> the face of the seven of hearts.
const F = (name) => "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));

// A game whose deck starts with `top` (by name, top first), the rest in order.
// Two players get 7 cards each, dealt one at a time starting with `first`.
function start({ top = [], players = 2, first = 0, config = {} } = {}) {
  const faces = top.map(F);
  for (let f = 0; f < 52; f++) if (!faces.includes(f)) faces.push(f);
  const deck = new KnownDeck(faces);
  const rules = makeRules({ ...config, first: "random" });
  const state = rules.newState(first, players, deck);
  const events = settleAll(rules, state, deck);
  return { deck, rules, state, events };
}

// Plays a move as CardMatch would: the shown card opens first, then settle runs.
function move(g, player, m) {
  for (const slot of g.rules.reveals(g.state, player, m)) g.deck.open(slot);
  const events = g.rules.applyMove(g.state, player, m, g.deck);
  settleAll(g.rules, g.state, g.deck);
  return events;
}

const slotOf = (g, player, name) => g.state.hands[player].find((slot) => g.deck.face(slot) === F(name));
const names = (g, slots) => slots.map((slot) => cardName(g.deck.face(slot)));

// Hands as dealt from `cards` (14 names, two players, first player 0): even indexes to 0, odd to 1.
const deal2 = (mine, theirs, rest = []) => mine.flatMap((c, i) => [c, theirs[i]]).concat(rest);

test("the face mapping: suit = face / 13, rank = face % 13", () => {
  assert.deepEqual([suitOf(F("AS")), rankOf(F("AS"))], [0, 0]);
  assert.deepEqual([suitOf(F("8H")), rankOf(F("8H"))], [1, 7]);
  assert.deepEqual([suitOf(F("KC")), rankOf(F("KC"))], [3, 12]);
  assert.equal(cardName(F("10D")), "10♦");
  assert.deepEqual(["8S", "KH", "QD", "JC", "AS", "7H", "10C"].map((n) => points(F(n))), [50, 10, 10, 10, 1, 7, 10]);
});

test("the deal: 7 cards each for two players, 5 for three or four, and the starter turned", () => {
  for (const players of [2, 3, 4]) {
    const g = start({ players });
    assert.equal(handSize(players), players === 2 ? 7 : 5);
    for (const hand of g.state.hands) assert.equal(hand.length, handSize(players));
    for (const [p, hand] of g.state.hands.entries()) for (const slot of hand) assert.equal(g.deck.owner(slot), p);
    assert.equal(g.state.discard.length, 1);
    assert.equal(g.state.stock.length, 52 - players * handSize(players) - 1);
    assert.equal(g.state.starter, false);
    assert.equal(g.state.top, g.deck.face(g.state.discard[0]));
    assert.equal(g.state.suit, suitOf(g.state.top));
    assert.ok(g.deck.slots[g.state.discard[0]].open, "the starter is face up");
    assert.deepEqual([g.events[0].type, g.events.at(-1).type], ["flip", "starter"]);
  }
});

test("a starter 8 goes to the bottom of the stock and the next card is turned, again if need be", () => {
  const cards = deal2(["2S", "3S", "4S", "5S", "6S", "7S", "9S"], ["2H", "3H", "4H", "5H", "6H", "7H", "9H"], ["8D", "8C", "KH"]);
  const g = start({ top: cards });
  assert.deepEqual(g.events.map((e) => e.type), ["flip", "bury", "flip", "bury", "flip", "starter"]);
  assert.equal(g.state.top, F("KH"));
  assert.deepEqual(names(g, g.state.stock.slice(-2)), ["8♦", "8♣"], "both 8s at the bottom, in the order they came");
  assert.equal(g.state.stock.length, 52 - 14 - 1);
  assert.ok(!g.state.history.some((h) => h.t === "play"));
});

test("follow by suit or by rank; anything else is refused", () => {
  const g = start({ top: deal2(["5H", "9C", "2S", "3D", "4D", "6D", "10S"], ["2H", "3H", "4H", "5S", "6H", "7H", "9H"], ["7C"]) });
  assert.equal(g.state.top, F("7C"));
  assert.ok(follows(g.state, F("9C")) && follows(g.state, F("7S")) && !follows(g.state, F("5H")));
  assert.throws(() => move(g, 0, { play: slotOf(g, 0, "5H") }), (e) => e instanceof RuleError && /play a ♣, a 7 or an 8/.test(e.message));
  const [ev] = move(g, 0, { play: slotOf(g, 0, "9C") });
  assert.deepEqual([ev.type, ev.player, ev.face, ev.suit, ev.eight], ["play", 0, F("9C"), 3, false]);
  assert.equal(g.state.turn, 1);
  // By rank: a 9 of another suit changes the suit.
  const g2 = start({ top: deal2(["9H", "2C", "3C", "4C", "5C", "6C", "10C"], ["2H", "3H", "4H", "5S", "6H", "7H", "9D"], ["9S"]) });
  move(g2, 0, { play: slotOf(g2, 0, "9H") });
  assert.equal(g2.state.suit, 1);
});

test("an 8 is wild and names the suit; the next player follows the named suit or plays an 8", () => {
  const g = start({ top: deal2(["8H", "2S", "3S", "4S", "5S", "6S", "7S"], ["2C", "3H", "4C", "5D", "8C", "7H", "9H"], ["KD"]) });
  assert.throws(() => move(g, 0, { play: slotOf(g, 0, "8H") }), /an 8 needs a suit/);
  assert.throws(() => move(g, 0, { play: slotOf(g, 0, "8H"), suit: 4 }), /an 8 needs a suit/);
  const [ev] = move(g, 0, { play: slotOf(g, 0, "8H"), suit: 3 });
  assert.deepEqual([ev.eight, ev.suit, g.state.suit, g.state.named], [true, 3, 3, true]);
  // Hearts (the 8's own suit) no longer follows; clubs or another 8 do.
  assert.throws(() => move(g, 1, { play: slotOf(g, 1, "3H") }), RuleError);
  assert.throws(() => move(g, 1, { play: slotOf(g, 1, "5D") }), RuleError);
  move(g, 1, { play: slotOf(g, 1, "2C") });
  assert.deepEqual([g.state.suit, g.state.named], [3, false]);
  // A suit on anything but an 8 is refused.
  const g2 = start({ top: deal2(["KD", "2S", "3S", "4S", "5S", "6S", "7S"], ["2C", "3H", "4C", "5D", "6C", "7H", "9H"], ["QD"]) });
  assert.throws(() => move(g2, 0, { play: slotOf(g2, 0, "KD"), suit: 1 }), /only an 8 names a suit/);
});

test("draw until you can play: draw again and again, then play the card you drew", () => {
  const hand0 = ["2S", "3S", "4S", "5S", "6S", "7S", "9S"];
  const g = start({ top: deal2(hand0, ["2C", "3C", "4C", "5C", "6C", "7C", "9C"], ["KH", "AD", "10D", "4H"]) });
  assert.equal(g.state.top, F("KH"));
  assert.equal(g.state.draw, "until");
  const [ev] = move(g, 0, { draw: true });
  assert.deepEqual([ev.type, ev.player, cardName(g.deck.face(ev.slot))], ["draw", 0, "A♦"]);
  assert.equal(g.deck.owner(ev.slot), 0);
  assert.equal(g.state.turn, 0, "still your turn after drawing");
  assert.throws(() => move(g, 0, { pass: true }), /play a card or draw again/);
  move(g, 0, { draw: true });
  move(g, 0, { draw: true });
  assert.equal(g.state.drew, 3);
  move(g, 0, { play: slotOf(g, 0, "4H") });
  assert.deepEqual([g.state.turn, g.state.drew, g.state.hands[0].length], [1, 0, 9]);
});

test("draw one, then pass: one card a turn, and a pass ends the turn", () => {
  const g = start({ config: { draw: "one" }, top: deal2(["2S", "3S", "4S", "5S", "6S", "7S", "9S"], ["2C", "3C", "4C", "5C", "6C", "7C", "9C"], ["KH", "AD", "4H"]) });
  assert.ok(canDraw(g.state) && !canPass(g.state));
  assert.throws(() => move(g, 0, { pass: true }), /draw a card first/);
  move(g, 0, { draw: true });
  assert.ok(!canDraw(g.state) && canPass(g.state));
  assert.throws(() => move(g, 0, { draw: true }), /you've drawn your card this turn/);
  const [ev] = move(g, 0, { pass: true });
  assert.deepEqual([ev.type, ev.afterDraw, g.state.turn], ["pass", true, 1]);
  // After the one draw, a card that plays may still go down.
  move(g, 1, { draw: true });
  move(g, 1, { play: slotOf(g, 1, "4H") });
  assert.deepEqual([g.state.turn, g.state.top], [0, F("4H")]);
});

test("drawing while holding a card that plays breaks the rule, which only a known face can show", () => {
  const g = start({ top: deal2(["KS", "2D", "3D", "4D", "5D", "6D", "7D"], ["2C", "3C", "4C", "5C", "6C", "7C", "9C"], ["KH"]) });
  assert.throws(() => move(g, 0, { draw: true }), /drew while holding a card that plays/);
  // In play the other browsers can't see the hand: deck.face() is null, so it is allowed there.
  g.deck.blind = true;
  g.rules.applyMove(g.state, 0, { draw: true }, g.deck);
  assert.equal(g.state.hands[0].length, 8);
  // With the rule off, drawing is always allowed.
  const free = start({ config: { strict: false }, top: deal2(["KS", "2D", "3D", "4D", "5D", "6D", "7D"], ["2C", "3C", "4C", "5C", "6C", "7C", "9C"], ["KH"]) });
  move(free, 0, { draw: true });
  assert.equal(free.state.hands[0].length, 8);
});

test("when the stock runs out, the discard pile under its top card is shuffled into a new stock", () => {
  const g = start({ config: { strict: false }, top: deal2(["2S", "3S", "4S", "5S", "6S", "7S", "9S"], ["2C", "3C", "4C", "5C", "6C", "7C", "9C"], ["KH"]) });
  // Empty the stock into seat 0's hand by hand, as if drawn earlier.
  const taken = g.state.stock.splice(0);
  for (const slot of taken) {
    g.deck.deal(slot, 0);
    g.state.hands[0].push(slot);
  }
  // Put four cards under the starter on the discard pile.
  const under = g.state.hands[1].splice(0, 4);
  for (const slot of under) g.deck.open(slot);
  g.state.discard.unshift(...under);
  const top = g.state.discard.at(-1);
  g.state.turn = 1;
  const [ev] = move(g, 1, { draw: true });
  assert.equal(ev.shuffled, 4);
  assert.deepEqual(g.state.discard, [top], "the top card stays");
  assert.equal(g.state.stock.length, 3);
  assert.equal(g.state.reshuffles, 1);
  for (const slot of under) assert.ok(g.deck.slots[slot].gone, "old slots are replaced by new ones");
  assert.ok(g.state.stock.every((slot) => !g.deck.slots[slot].open), "reshuffled cards are face down again");
  assert.equal(g.deck.owner(ev.slot), 1);
});

test("with nothing left to draw you pass, and a full round of passes ends a blocked game", () => {
  const g = start({ config: { strict: false }, top: deal2(["2S", "3S", "4S", "5S", "6S", "7S", "9S"], ["2C", "3C", "4C", "5C", "6C", "7C", "9C"], ["KH"]) });
  const rest = g.state.stock.splice(0);
  rest.forEach((slot, i) => {
    const p = i < 10 ? 1 : 0;
    g.deck.deal(slot, p);
    g.state.hands[p].push(slot);
  });
  assert.ok(!canDraw(g.state) && canPass(g.state));
  assert.throws(() => move(g, 0, { draw: true }), /nothing left to draw/);
  move(g, 0, { pass: true });
  assert.equal(g.state.turn, 1);
  move(g, 1, { pass: true });
  assert.equal(g.state.ended, "blocked");
  const sizes = g.state.hands.map((h) => h.length);
  assert.equal(g.state.winner, sizes[0] < sizes[1] ? 0 : 1, "the fewest cards win a blocked game");
  assert.throws(() => move(g, 0, { pass: true }), /the game is over/);
});

test("passing instead of drawing from empty piles, with a card that plays, breaks the rule", () => {
  const g = start({ top: deal2(["KS", "2D", "3D", "4D", "5D", "6D", "7D"], ["2C", "3C", "4C", "5C", "6C", "7C", "9C"], ["KH"]) });
  const rest = g.state.stock.splice(0);
  rest.forEach((slot) => {
    g.deck.deal(slot, 1);
    g.state.hands[1].push(slot);
  });
  assert.throws(() => move(g, 0, { pass: true }), /passed while holding a card that plays/);
});

test("illegal moves: out of turn, a card not in your hand, malformed, and after the game is over", () => {
  const g = start({ top: deal2(["KS", "2D", "3D", "4D", "5D", "6D", "7D"], ["2C", "3C", "4C", "5C", "6C", "7H", "9C"], ["KH"]) });
  assert.throws(() => move(g, 1, { play: slotOf(g, 1, "7H") }), /not your turn/);
  assert.throws(() => move(g, 0, { play: slotOf(g, 1, "7H") }), /that card isn't in your hand/);
  assert.throws(() => move(g, 0, { play: 999 }), RuleError);
  assert.throws(() => move(g, 0, {}), /bad move/);
  assert.throws(() => move(g, 0, null), /bad move/);
  assert.throws(() => move(g, 0, { draw: 1 }), /bad move/);
});

test("a game that reaches the move limit ends with the fewest cards winning", () => {
  const g = start({ top: deal2(["KS", "2D", "3D", "4D", "5D", "6D", "7D"], ["2C", "3C", "4C", "5C", "6C", "7H", "9C"], ["KH"]) });
  g.state.turns = MAX_TURNS - 1;
  g.state.hands[1].pop();
  move(g, 0, { play: slotOf(g, 0, "KS") });
  assert.deepEqual([g.state.ended, g.state.winner], ["long", 1]);
});

test("the last card wins", () => {
  const g = start({ top: deal2(["KS", "2D", "3D", "4D", "5D", "6D", "7D"], ["2C", "3C", "4C", "5C", "6C", "7H", "9C"], ["KH"]) });
  g.state.hands[0] = [slotOf(g, 0, "KS")];
  const [ev] = move(g, 0, { play: g.state.hands[0][0] });
  assert.equal(ev.type, "play");
  assert.deepEqual([g.state.winner, g.state.ended], [0, "out"]);
  assert.throws(() => move(g, 1, { draw: true }), /the game is over/);
});

// Hands dealt one card at a time round the table, first player 0.
const dealRound = (...hands) => hands[0].flatMap((_, i) => hands.map((h) => h[i]));

test("action cards: a 2 makes the next player take two and miss a turn, a queen skips, an ace reverses", () => {
  const hands = [["2H", "QH", "AH", "4H", "5S"], ["6S", "7S", "2C", "3C", "4C"], ["5C", "6C", "7C", "9C", "3D"]];
  const g = start({ players: 3, config: { actions: true }, top: [...dealRound(...hands), "KH", "JS", "JD"] });
  assert.equal(g.state.top, F("KH"));
  const [two] = move(g, 0, { play: slotOf(g, 0, "2H") });
  assert.deepEqual([two.action, two.victim, names(g, two.dealt)], ["two", 1, ["J♠", "J♦"]]);
  assert.equal(g.state.hands[1].length, 7);
  assert.equal(g.state.turn, 2, "the victim misses their turn");
  g.state.turn = 0;
  const [q] = move(g, 0, { play: slotOf(g, 0, "QH") });
  assert.deepEqual([q.action, q.victim, g.state.turn], ["skip", 1, 2]);
  g.state.turn = 0;
  const [a] = move(g, 0, { play: slotOf(g, 0, "AH") });
  assert.deepEqual([a.action, a.dir, g.state.dir, g.state.turn], ["reverse", -1, -1, 2]);
  // Without the setting they are plain cards.
  const plain = start({ players: 3, top: [...dealRound(...hands), "KH"] });
  const [ev] = move(plain, 0, { play: slotOf(plain, 0, "2H") });
  assert.equal(ev.action, undefined);
  assert.deepEqual([plain.state.turn, plain.state.hands[1].length], [1, 5]);
});

test("a 2 with the stock empty reshuffles the discard pile to deal its cards", () => {
  const hands = [["2H", "QS", "AS", "4S", "5S"], ["6S", "7S", "2C", "3C", "4C"], ["5C", "6C", "7C", "9C", "3D"]];
  const g = start({ players: 3, config: { actions: true }, top: [...dealRound(...hands), "KH", "JS"] });
  const rest = g.state.stock.splice(1);
  for (const slot of rest) {
    g.deck.deal(slot, 2);
    g.state.hands[2].push(slot);
  }
  const under = g.state.hands[1].splice(0, 3);
  under.forEach((slot) => g.deck.open(slot));
  g.state.discard.unshift(...under);
  const [two] = move(g, 0, { play: slotOf(g, 0, "2H") });
  assert.equal(two.dealt.length, 2);
  assert.equal(two.shuffled, 4, "the three under the starter and the starter itself");
  assert.deepEqual(names(g, g.state.discard), ["2♥"]);
  assert.equal(g.state.hands[1].length, 4);
});

test("with two players an ace brings the turn straight back", () => {
  const g = start({ config: { actions: true }, top: deal2(["AH", "2D", "3D", "4D", "5D", "6D", "7D"], ["2C", "3C", "4C", "5C", "6C", "7H", "9C"], ["KH"]) });
  move(g, 0, { play: slotOf(g, 0, "AH") });
  assert.equal(g.state.turn, 0);
});

test("who goes first: the coin toss, the room's creator, or the next player", () => {
  for (const [first, toss, want] of [["random", 2, 2], ["host", 2, 0], ["guest", 2, 1]]) {
    const deck = new KnownDeck(shuffled("first"));
    const st = makeRules({ first }).newState(toss, 3, deck);
    assert.equal(st.turn, want, first);
  }
});

test("config is normalized: unknown values fall back to the defaults", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ draw: "lots", strict: "yes", actions: 1, moveSeconds: 7, robots: 9 }), DEFAULT_CONFIG);
  assert.equal(normalizeConfig({ draw: "one" }).draw, "one");
});

// Seeded games between robots, straight on the rules, each seeing only what its seat may.
function game(players, config, seed, levels = Array(players).fill("medium")) {
  const deck = new KnownDeck(shuffled(`deck ${seed}`), `reshuffle ${seed}`);
  const rules = makeRules(config);
  const rng = rngFromSeed(`robots ${seed}`);
  const state = rules.newState(Math.floor(rng() * players), players, deck);
  settleAll(rules, state, deck);
  while (state.winner === -1) {
    const p = state.turn;
    const m = chooseMove(state, p, rng, deck.view(p), { level: levels[p] });
    for (const slot of rules.reveals(state, p, m)) deck.open(slot);
    rules.applyMove(state, p, m, deck);
    settleAll(rules, state, deck);
  }
  return { state, deck };
}

test("seeded full games for 2, 3 and 4 players, every rule mix, always finish", () => {
  const configs = [{}, { draw: "one" }, { actions: true }, { draw: "one", actions: true, strict: false }];
  let reshuffles = 0;
  for (const players of [2, 3, 4]) {
    for (const config of configs) {
      for (let s = 0; s < 25; s++) {
        const { state, deck } = game(players, config, `${players}-${JSON.stringify(config)}-${s}`, ["easy", "medium", "hard", "hard"].slice(0, players));
        assert.ok(state.winner >= 0 && state.winner < players);
        assert.ok(state.turns < MAX_TURNS, "finished well inside the turn limit");
        if (state.ended === "out") assert.equal(state.hands[state.winner].length, 0);
        reshuffles += state.reshuffles;
        // Every card is somewhere, once.
        const places = [...state.stock, ...state.discard, ...state.hands.flat()].map((slot) => deck.face(slot));
        assert.deepEqual(places.sort((a, b) => a - b), [...Array(52).keys()]);
      }
    }
  }
  assert.ok(reshuffles > 0, "some games reshuffled the discard pile");
});
