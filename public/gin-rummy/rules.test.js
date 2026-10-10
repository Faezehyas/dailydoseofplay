import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import { rngFromSeed } from "../engine/rng.js";
import { KnownDeck, shuffled, settleAll } from "../../test/fixtures/known-deck.js";
import { makeRules, normalizeConfig, forcedMove, bestKnock, arrange, DEFAULT_CONFIG, GAME_BONUS, LINE_BONUS } from "./rules.js";

// "7H" -> the face of the seven of hearts; "7H 8H" -> a list.
const F = (name) => "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));
const L = (names) => (names ? names.split(" ").map(F) : []);

// A hand where seat p is dealt hands[p] (names), `up` is turned, and the
// stock starts with `stock`, then every other card. Every face is known to
// the rules (as in the audit) unless `blind` (as in play); the moves still
// open what they show, as CardMatch does.
function start({ hands, up, stock = "", dealer = 0, config = {}, blind = false, faces }) {
  let order = faces;
  if (!order) {
    const first = 1 - dealer;
    const a = L(hands[first]);
    const b = L(hands[dealer]);
    order = [];
    for (let r = 0; r < 10; r++) order.push(a[r], b[r]);
    order.push(F(up), ...L(stock));
    for (let f = 0; f < 52; f++) if (!order.includes(f)) order.push(f);
  }
  assert.deepEqual(order.slice().sort((a, b) => a - b), [...Array(52).keys()], "one full deck");
  const deck = new KnownDeck(order);
  deck.blind = blind;
  const rules = makeRules({ ...config, dealer: dealer ? "guest" : "host" });
  const state = rules.newState(0, 2, deck);
  const events = settleAll(rules, state, deck);
  return { deck, rules, state, events };
}

// Plays a move as CardMatch would: the shown cards (from the player's own hand) open first, then settle().
function move(g, player, m) {
  const shown = g.rules.reveals(g.state, player, m);
  if (shown.some((s) => g.deck.slots[s]?.owner !== player)) throw new RuleError("a move can only show cards from your own hand");
  for (const slot of shown) g.deck.open(slot);
  const events = g.rules.applyMove(g.state, player, m, g.deck);
  return [...events, ...settleAll(g.rules, g.state, g.deck)];
}
const slot = (g, name) => g.deck.slots.findIndex((s) => !s.gone && s.face === F(name));
const names = (g, slots) => slots.map((s) => g.deck.slots[s].face);
const throws = (fn, re) => assert.throws(fn, (e) => e instanceof RuleError && re.test(e.message));
const view = (g) => (s) => g.deck.slots[s].face;

// Seat 1 (the non-dealer) holds a gin hand after drawing 9♦; seat 0 holds junk.
const GIN = { hands: ["2C 4D 6H 8S 10C QD KS 3H 5S 6C", "AS 2S 3S 7H 7D 7C 9D 10D JD KH"], up: "QC", stock: "8D 4S" };
// The same knocker against a defender who can lay off on both ends of A-2-3♠ and 9-10-J♦.
const KNOCK = { hands: ["4S 8D 6H 8S 10C QD KS 3H 5S 2C", "AS 2S 3S 7H 7D 7C 9D 10D JD KH"], up: "QC", stock: "4D 5D" };

test("config: classic defaults, anything else falls back", () => {
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(DEFAULT_CONFIG, { target: 100, knock: "classic", bigGin: false, dealer: "random", moveSeconds: 0, level: "easy", fourColor: false });
  assert.deepEqual(normalizeConfig({ target: 50, knock: "x", bigGin: "yes", dealer: "guest", moveSeconds: 30 }), { ...DEFAULT_CONFIG, dealer: "guest", moveSeconds: 30 });
  assert.equal(normalizeConfig({ target: 0 }).target, 0);
});

test("the deal: ten each, one at a time from the non-dealer, then the upcard turned onto the pile", () => {
  for (const dealer of [0, 1]) {
    const g = start({ faces: shuffled(`deal ${dealer}`), dealer });
    const st = g.state;
    assert.deepEqual([st.dealer, st.turn, st.phase, st.hand], [dealer, 1 - dealer, "upcard", 1]);
    for (const p of [0, 1]) {
      assert.equal(st.hands[p].length, 10);
      for (const s of st.hands[p]) assert.equal(g.deck.owner(s), p);
    }
    // The non-dealer gets the first card, the dealer the second, and so on.
    assert.deepEqual(st.hands[1 - dealer].slice(0, 3), [0, 2, 4]);
    assert.deepEqual(st.hands[dealer].slice(0, 3), [1, 3, 5]);
    assert.deepEqual([st.discard, st.upcard, st.stock.length], [[20], 20, 31]);
    assert.ok(g.deck.slots[20].open, "the upcard is face up");
    assert.equal(st.limit, 10);
    assert.deepEqual(g.events, [{ type: "upcard", slot: 20, limit: 10 }]);
  }
  // A coin toss deals by `first`; the room can name the dealer instead.
  const toss = makeRules({ dealer: "random" }).newState(1, 2, new KnownDeck(shuffled("toss")));
  assert.deepEqual([toss.dealer, toss.turn], [1, 0]);
  throws(() => makeRules({}).newState(0, 3, new KnownDeck(shuffled("three"))), /two players/);
});

test("Oklahoma: the upcard's points set the knock limit", () => {
  for (const [up, limit] of [["8C", 8], ["KC", 10], ["AC", 1], ["10H", 10]]) {
    const g = start({ ...GIN, up, config: { knock: "oklahoma" } });
    assert.equal(g.state.limit, limit, up);
  }
});

test("the upcard: the non-dealer may take it, and then can't throw it straight back", () => {
  const g = start(GIN);
  throws(() => move(g, 0, { take: true }), /not your turn/);
  throws(() => move(g, 1, { draw: "stock" }), /doesn't fit now \(upcard\)/);
  const [ev] = move(g, 1, { take: true });
  assert.deepEqual(ev, { type: "take", p: 1, slot: slot(g, "QC"), from: "upcard" });
  assert.deepEqual([g.state.phase, g.state.turn, g.state.hands[1].length, g.state.discard], ["discard", 1, 11, []]);
  throws(() => move(g, 1, { discard: slot(g, "QC") }), /can't discard the card you just took/);
  move(g, 1, { discard: slot(g, "KH") });
  assert.deepEqual([g.state.phase, g.state.turn], ["draw", 0], "then the dealer's turn as usual");
  assert.deepEqual(names(g, g.state.discard), [F("KH")]);
});

test("the upcard: the non-dealer passes and the dealer takes it", () => {
  const g = start(GIN);
  move(g, 1, { pass: true });
  assert.deepEqual([g.state.phase, g.state.turn, g.state.passes], ["upcard", 0, 1]);
  move(g, 0, { take: true });
  assert.deepEqual([g.state.phase, g.state.turn, g.state.hands[0].length], ["discard", 0, 11]);
  move(g, 0, { discard: slot(g, "KS") });
  assert.deepEqual([g.state.phase, g.state.turn], ["draw", 1], "then the non-dealer draws");
  assert.deepEqual(g.state.log.slice(0, 2), [{ t: "pass", p: 1, slot: g.state.upcard }, { t: "take", p: 0, slot: g.state.upcard }]);
});

test("the upcard: both pass and the non-dealer draws from the stock", () => {
  const g = start(GIN);
  move(g, 1, { pass: true });
  const events = move(g, 0, { pass: true });
  assert.deepEqual(events.map((e) => e.type), ["pass", "draw"]);
  assert.deepEqual([g.state.phase, g.state.turn, g.state.hands[1].length, g.state.stock.length], ["discard", 1, 11, 30]);
  assert.equal(g.deck.slots[events[1].slot].face, F("8D"), "the stock's top card");
  assert.ok(!g.deck.slots[events[1].slot].open, "dealt face down");
  assert.deepEqual(names(g, g.state.discard), [F("QC")], "the upcard stays on the pile");
});

test("a turn: draw from either pile, then discard; the card from the pile can't go straight back", () => {
  const g = start(GIN);
  move(g, 1, { pass: true });
  move(g, 0, { pass: true });
  move(g, 1, { discard: slot(g, "8D") }); // the card just drawn from the stock may go back
  assert.deepEqual([g.state.phase, g.state.turn], ["draw", 0]);
  throws(() => move(g, 0, { discard: slot(g, "2C") }), /doesn't fit now \(draw\)/);
  throws(() => move(g, 0, { draw: "deck" }), /doesn't fit now/);
  move(g, 0, { draw: "pile" });
  assert.equal(g.state.taken, slot(g, "8D"));
  assert.ok(g.state.hands[0].includes(slot(g, "8D")));
  throws(() => move(g, 0, { discard: slot(g, "8D") }), /can't discard the card you just took/);
  throws(() => move(g, 0, { discard: slot(g, "AS") }), /only show cards from your own hand/);
  throws(() => move(g, 0, { discard: 999 }), /only show cards from your own hand/);
  move(g, 0, { discard: slot(g, "KS") });
  move(g, 1, { draw: "stock" });
  assert.equal(g.state.taken, null);
  assert.equal(g.deck.slots[g.state.hands[1].at(-1)].face, F("4S"));
  assert.deepEqual(g.state.log.map((e) => e.t), ["pass", "pass", "draw", "discard", "take", "discard", "draw"]);
});

test("knocking: only with 10 points of deadwood or less, after drawing", () => {
  // Seat 1 holds A-2-3♠, 7♥ 7♦ 7♣, 9-10-J♦ and K♥: after the upcard Q♣ it has K♥ Q♣ to shed.
  const g = start(GIN);
  move(g, 1, { take: true });
  // Throwing K♥ leaves Q♣: 10 points, just enough.
  const best = bestKnock(g.state, 1, view(g));
  assert.equal(best.points, 10);
  throws(() => move(g, 1, { discard: slot(g, "7H"), knock: true }), /at most, not 34/);
  const events = move(g, 1, { discard: slot(g, "KH"), knock: true });
  assert.deepEqual(events.map((e) => e.type), ["discard", "knock"]);
  assert.deepEqual(events[1], { type: "knock", p: 1, gin: 0 });
  assert.deepEqual([g.state.phase, g.state.turn, g.state.knock], ["lay", 1, { p: 1, discard: slot(g, "KH"), gin: 0 }]);
  // The whole hand was shown with the knock.
  assert.ok(g.state.hands[1].every((s) => g.deck.slots[s].open));
  assert.deepEqual(g.rules.reveals({ ...g.state, phase: "discard" }, 1, { discard: 0, knock: true }), g.state.hands[1]);
});

test("laying down: the knocker's melds are checked, and the deadwood must be within the limit", () => {
  const g = start(GIN);
  move(g, 1, { take: true });
  move(g, 1, { discard: slot(g, "KH"), knock: true });
  const s = (n) => L(n).map((f) => g.deck.slots.findIndex((x) => x.face === f));
  throws(() => move(g, 1, { melds: [s("AS 2S 3S"), s("7H 7D 9D")] }), /isn't a set or a run/);
  throws(() => move(g, 1, { melds: [s("AS 2S 3S"), s("AS 7D 7C")] }), /own cards/);
  throws(() => move(g, 1, { melds: [s("2C 4D 6H")] }), /own cards/);
  throws(() => move(g, 1, { melds: [s("AS 2S 3S")] }), /10 points of deadwood at most/);
  throws(() => move(g, 0, { melds: [] }), /not your turn/);
  const auto = forcedMove(g.state, 1, view(g));
  assert.deepEqual(auto.melds.map((m) => names(g, m)), [L("AS 2S 3S"), L("7H 7D 7C"), L("9D 10D JD")]);
  const [ev] = move(g, 1, auto);
  assert.deepEqual([ev.type, names(g, ev.deadwood), ev.points], ["lay", L("QC"), 10]);
  assert.deepEqual([g.state.phase, g.state.turn], ["defend", 0]);
});

test("the defence: own melds, then lay-offs onto the knocker's melds; the knock scores the difference", () => {
  const g = start(KNOCK);
  move(g, 1, { take: true });
  move(g, 1, { discard: slot(g, "KH"), knock: true });
  move(g, 1, forcedMove(g.state, 1, view(g)));
  const s = (n) => slot(g, n);
  throws(() => move(g, 0, { melds: [], layoffs: [[s("4S"), 1]] }), /doesn't fit that meld/);
  throws(() => move(g, 0, { melds: [], layoffs: [[s("5S"), 0]] }), /doesn't fit that meld/, "5♠ only after 4♠");
  throws(() => move(g, 0, { melds: [], layoffs: [[s("4S"), 0], [s("4S"), 0]] }), /from your deadwood/);
  throws(() => move(g, 0, { melds: [], layoffs: [[s("AS"), 0]] }), /from your deadwood/);
  throws(() => move(g, 0, { melds: [], layoffs: [[s("4S"), 7]] }), /doesn't fit/);
  throws(() => move(g, 0, { melds: [], layoffs: "all" }), /bad lay-offs/);
  const auto = forcedMove(g.state, 0, view(g));
  // 4♠ then 5♠ on A-2-3♠; 8♦ and Q♦ on either end of 9-10-J♦.
  assert.deepEqual(auto.layoffs.map(([x, j]) => [g.deck.slots[x].face, j]).sort((a, b) => a[0] - b[0]), [[F("4S"), 0], [F("5S"), 0], [F("8D"), 2], [F("QD"), 2]].sort((a, b) => a[0] - b[0]));
  const events = move(g, 0, auto);
  assert.deepEqual(events.map((e) => e.type), ["defend", "score"]);
  // 6♥ 8♠ 10♣ K♠ 3♥ 2♣ left: 39, against the knocker's 10.
  assert.deepEqual([names(g, events[0].deadwood).sort((a, b) => a - b), events[0].points], [L("6H 8S 10C KS 3H 2C").sort((a, b) => a - b), 39]);
  assert.deepEqual(events[1], { type: "score", kind: "knock", winner: 1, points: 29, scores: [0, 29] });
  assert.deepEqual([g.state.phase, g.state.scores, g.state.wins, g.state.turn], ["result", [0, 29], [0, 1], 1]);
  assert.deepEqual(g.state.history, [{ hand: 1, dealer: 0, kind: "knock", winner: 1, points: 29 }]);
  // The knocker's melds with the lay-offs on them, as the table shows them.
  assert.deepEqual(g.state.layoffs.length, 4);
});

test("an undercut: the defender's deadwood is equal or lower, and they score the difference plus 25", () => {
  // The defender has 4-5-6♣, three 8s and 10-J-Q♥, and 5♠ (5) against the knocker's 10.
  for (const [extra, dead, points] of [["5S", 5, 30], ["10S", 10, 25]]) {
    const g = start({ ...KNOCK, hands: [`4C 5C 6C 8H 8S 8D 10H JH QH ${extra}`, KNOCK.hands[1]] });
    move(g, 1, { take: true });
    move(g, 1, { discard: slot(g, "KH"), knock: true });
    move(g, 1, forcedMove(g.state, 1, view(g)));
    const events = move(g, 0, forcedMove(g.state, 0, view(g)));
    assert.equal(events[0].points, dead);
    assert.deepEqual(events[1], { type: "score", kind: "undercut", winner: 0, points, scores: [points, 0] }, extra);
  }
});

test("gin: 25 plus the defender's deadwood, and nothing can be laid off", () => {
  // Q♦ makes 9-10-J-Q♦; throwing K♥ leaves no deadwood.
  const g = start({ ...KNOCK, hands: ["4S 8D 6H 8S 10C 2D KS 3H 5S 2C", KNOCK.hands[1]], up: "QD" });
  move(g, 1, { take: true });
  assert.equal(bestKnock(g.state, 1, view(g)).points, 0);
  const [, knock] = move(g, 1, { discard: slot(g, "KH"), knock: true });
  assert.deepEqual(knock, { type: "knock", p: 1, gin: 1 });
  const s = (n) => slot(g, n);
  throws(() => move(g, 1, { melds: [[s("AS"), s("2S"), s("3S")], [s("7H"), s("7D"), s("7C")], [s("9D"), s("10D"), s("JD")]] }), /gin lays every card in melds/);
  move(g, 1, forcedMove(g.state, 1, view(g)));
  throws(() => move(g, 0, { melds: [], layoffs: [[s("8D"), 2]] }), /nothing can be laid off on gin/);
  const auto = forcedMove(g.state, 0, view(g));
  assert.deepEqual(auto.layoffs, []);
  const events = move(g, 0, auto);
  // No melds: 4 + 8 + 6 + 8 + 10 + 2 + 10 + 3 + 5 + 2 = 58.
  assert.deepEqual(events[1], { type: "score", kind: "gin", winner: 1, points: 25 + 58, scores: [0, 83] });
});

test("Big Gin: with the room's setting, all eleven cards melded go out without a discard", () => {
  const hands = { ...KNOCK, hands: ["4S 8D 6H 8S 10C 2D KS 3H 5S 2C", "AS 2S 3S 7H 7D 7C 9D 10D JD QD"], up: "KD" };
  const off = start(hands);
  move(off, 1, { take: true });
  throws(() => move(off, 1, { knock: true }), /Big Gin is off/);
  // Without Big Gin, eleven melded cards still go out as gin, with a discard: 10-J-Q-K♦ is still a run.
  assert.deepEqual(move(off, 1, { discard: slot(off, "9D"), knock: true })[1], { type: "knock", p: 1, gin: 1 });
  const on = start({ ...hands, config: { bigGin: true } });
  move(on, 1, { take: true });
  assert.deepEqual(move(on, 1, { knock: true }), [{ type: "knock", p: 1, gin: 2 }]);
  assert.deepEqual([on.state.hands[1].length, on.state.knock.discard, on.state.discard.length], [11, null, 0]);
  move(on, 1, forcedMove(on.state, 1, view(on)));
  assert.equal(on.state.laid[1].melds.flat().length, 11);
  const score = move(on, 0, forcedMove(on.state, 0, view(on)))[1];
  assert.deepEqual([score.kind, score.points], ["big", 31 + 58]);
  // Big Gin needs every card in a meld.
  const not = start({ ...hands, up: "QC", config: { bigGin: true } });
  move(not, 1, { take: true });
  throws(() => move(not, 1, { knock: true }), /all eleven cards in melds/);
});

test("a hand is a draw when a discard leaves two cards in the stock without a knock", () => {
  const g = start({ faces: shuffled("dead"), dealer: 0, config: { target: 100 } });
  move(g, 1, { pass: true });
  move(g, 0, { pass: true });
  let p = 1;
  let events = [];
  while (g.state.phase !== "result") {
    if (g.state.phase === "draw") move(g, p, { draw: "stock" });
    const hand = g.state.hands[p];
    events = move(g, p, { discard: hand.find((s) => s !== g.state.taken) });
    p = 1 - p;
  }
  assert.equal(g.state.stock.length, 2);
  assert.deepEqual(events.at(-1), { type: "score", kind: "draw", winner: -1, points: 0, scores: [0, 0] });
  assert.deepEqual([g.state.scores, g.state.wins, g.state.result.kind], [[0, 0], [0, 0], "draw"]);
  // With one hand a game, a drawn hand is a drawn game.
  const one = start({ faces: shuffled("dead"), dealer: 0, config: { target: 0 } });
  move(one, 1, { pass: true });
  move(one, 0, { pass: true });
  p = 1;
  while (one.state.winner === -1) {
    if (one.state.phase === "draw") move(one, p, { draw: "stock" });
    move(one, p, { discard: one.state.hands[p].find((s) => s !== one.state.taken) });
    p = 1 - p;
  }
  assert.deepEqual([one.state.winner, one.state.phase, one.state.final], [2, "over", { totals: [0, 0], game: 0, line: 0 }]);
});

test("the last discard: with two cards left in the stock a player may still knock instead", () => {
  // Seat 1 holds the knock hand; the stock is run down to three, so its draw leaves two.
  const g = start({ ...KNOCK, stock: "" });
  move(g, 1, { pass: true });
  move(g, 0, { pass: true });
  move(g, 1, { discard: slot(g, "KH") });
  let p = 0;
  while (g.state.stock.length > 3) {
    move(g, p, { draw: "stock" });
    move(g, p, { discard: g.state.hands[p].at(-1) });
    p = 1 - p;
  }
  // Seat p draws the third-last card and knocks rather than ending the hand.
  if (p === 0) {
    move(g, 0, { draw: "stock" });
    move(g, 0, { discard: g.state.hands[0].at(-1) });
  }
  move(g, 1, { draw: "stock" });
  assert.equal(g.state.stock.length, 2);
  const k = bestKnock(g.state, 1, view(g));
  assert.ok(k.points <= 10);
  const events = move(g, 1, { discard: k.discard, knock: true });
  assert.equal(events.at(-1).type, "knock");
  assert.equal(g.state.phase, "lay", "a knock, not a drawn hand");
});

test("the next hand: both players ready, the deck shuffled again by everyone, the deal passes to the other player", () => {
  const g = start(KNOCK);
  move(g, 1, { take: true });
  move(g, 1, { discard: slot(g, "KH"), knock: true });
  move(g, 1, forcedMove(g.state, 1, view(g)));
  move(g, 0, forcedMove(g.state, 0, view(g)));
  const old = g.state.cards.slice();
  assert.equal(g.state.turn, 1, "the non-dealer is asked first");
  throws(() => move(g, 0, { next: true }), /not your turn/);
  throws(() => move(g, 1, { take: true }), /doesn't fit now \(result\)/);
  assert.deepEqual(move(g, 1, { next: true }), [{ type: "ready", p: 1 }]);
  const events = move(g, 0, { next: true });
  assert.deepEqual(events.map((e) => e.type), ["ready", "gather", "deal", "upcard"]);
  const st = g.state;
  assert.deepEqual([st.hand, st.dealer, st.turn, st.phase, st.scores], [2, 1, 0, "upcard", [0, 29]]);
  assert.ok(old.every((s) => g.deck.slots[s].gone), "the old slots were shuffled away");
  assert.equal(new Set(st.cards).size, 52);
  assert.ok(st.cards.every((s) => s >= 52), "new slots");
  assert.deepEqual([st.hands[0].length, st.hands[1].length, st.stock.length, st.discard.length, st.knock, st.layoffs, st.laid, st.result], [10, 10, 31, 1, null, [], [null, null], null]);
  assert.deepEqual(events[2].hands, st.hands);
  // Every face of the old hand is in the new one.
  assert.deepEqual(st.cards.map((s) => g.deck.slots[s].face).sort((a, b) => a - b), [...Array(52).keys()]);
});

test("a game to 100: the hands add up, and the winner gets 100 for the game and 25 a hand to each", () => {
  const g = start({ faces: shuffled("to 100"), dealer: 0 });
  const rng = rngFromSeed("to 100");
  let hands = 0;
  while (g.state.winner === -1) {
    playHand(g, rng);
    hands++;
    if (g.state.winner === -1) {
      move(g, g.state.turn, { next: true });
      move(g, g.state.turn, { next: true });
    }
  }
  const st = g.state;
  const w = st.winner;
  assert.ok(st.scores[w] >= 100 && st.scores[1 - w] < 100);
  assert.equal(st.history.length, hands);
  assert.deepEqual(st.wins, [0, 1].map((p) => st.history.filter((h) => h.winner === p).length));
  assert.deepEqual(st.scores, [0, 1].map((p) => st.history.filter((h) => h.winner === p).reduce((n, h) => n + h.points, 0)));
  assert.deepEqual(st.final.totals, [0, 1].map((p) => st.scores[p] + LINE_BONUS * st.wins[p] + (p === w ? GAME_BONUS : 0)));
  // Each hand the other player dealt.
  assert.deepEqual(st.history.map((h) => h.dealer), st.history.map((_, i) => i % 2));
  throws(() => move(g, st.turn, { next: true }), /game is over/);
});

test("one hand a game: the hand's winner wins, with the hand's points and no bonuses", () => {
  const g = start({ ...KNOCK, config: { target: 0 } });
  move(g, 1, { take: true });
  move(g, 1, { discard: slot(g, "KH"), knock: true });
  move(g, 1, forcedMove(g.state, 1, view(g)));
  const events = move(g, 0, forcedMove(g.state, 0, view(g)));
  assert.deepEqual(events.at(-1), { type: "over", winner: 1, totals: [0, 29] });
  assert.deepEqual([g.state.winner, g.state.phase, g.state.final], [1, "over", { totals: [0, 29], game: 0, line: 0 }]);
});

test("illegal moves throw RuleError", () => {
  const g = start(GIN);
  for (const bad of [null, 7, "take", {}, { take: "yes" }, { pass: 1 }, { draw: "stock" }, { discard: 3 }, { melds: [] }, { next: true }]) throws(() => move(g, 1, bad), /bad move|doesn't fit now/);
  throws(() => move(g, 0, { pass: true }), /not your turn/);
  move(g, 1, { take: true });
  throws(() => move(g, 1, { take: true }), /doesn't fit now \(discard\)/);
  throws(() => move(g, 1, { discard: "KH" }), /discard a card from your hand/);
  throws(() => move(g, 1, { discard: slot(g, "2C") }), /only show cards from your own hand/, "the other player's card");
  // The rules refuse it too, should a card get past the engine's check.
  throws(() => g.rules.applyMove(g.state, 1, { discard: slot(g, "2C") }, g.deck), /discard a card from your hand/);
});

test("during play the knock is checked on the cards it shows", () => {
  // As in play: hidden faces are null until a move shows them.
  const g = start({ ...GIN, blind: true });
  move(g, 1, { take: true });
  assert.equal(bestKnock(g.state, 1, (s) => g.deck.face(s)), null, "the other browser can't see the hand");
  const events = move(g, 1, { discard: slot(g, "KH"), knock: true });
  assert.equal(events[1].type, "knock");
  assert.ok(g.state.hands[1].every((s) => g.deck.face(s) !== null), "the knock showed every card");
  assert.ok(g.state.hands[0].every((s) => g.deck.face(s) === null), "the defender's hand is still hidden");
  move(g, 1, forcedMove(g.state, 1, (s) => g.deck.face(s)));
  // The defender's own browser knows its hand; its defence shows it.
  move(g, 0, forcedMove(g.state, 0, view(g)));
  assert.ok(g.state.hands[0].every((s) => g.deck.face(s) !== null));
  assert.equal(g.state.phase, "result");
});

test("arrange: the hand as melds and deadwood, by slot", () => {
  const g = start(GIN);
  const a = arrange(g.state.hands[1], view(g));
  assert.deepEqual([a.melds.map((m) => names(g, m)), names(g, a.deadwood), a.points], [[L("AS 2S 3S"), L("7H 7D 7C"), L("9D 10D JD")], L("KH"), 10]);
  assert.equal(arrange(g.state.hands[1], () => null), null);
});

// Plays one hand: mostly the discard that leaves the least deadwood, sometimes any card; knocks whenever it can.
function playHand(g, rng) {
  const st = g.state;
  for (let i = 0; i < 400 && st.phase !== "result" && st.phase !== "over"; i++) {
    const p = st.turn;
    const face = view(g);
    let m = forcedMove(st, p, face);
    if (!m && st.phase === "upcard") m = rng() < 0.3 ? { take: true } : { pass: true };
    if (!m && st.phase === "draw") m = { draw: rng() < 0.3 ? "pile" : "stock" };
    if (!m && st.phase === "discard") {
      const k = bestKnock(st, p, face);
      if (k && k.points <= st.limit) m = { discard: k.discard, knock: true };
      else if (rng() < 0.8) m = { discard: k.discard };
      else {
        const options = st.hands[p].filter((s) => s !== st.taken);
        m = { discard: options[Math.floor(rng() * options.length)] };
      }
    }
    move(g, p, m);
  }
}

test("seeded games with random play always finish, with every hand adding up", () => {
  const kinds = new Set();
  for (let s = 0; s < 40; s++) {
    const config = [{}, { knock: "oklahoma" }, { bigGin: true }, { target: 0 }][s % 4];
    const g = start({ faces: shuffled(`full ${s}`), dealer: s % 2, config });
    const rng = rngFromSeed(`full ${s}`);
    for (let hand = 0; g.state.winner === -1; hand++) {
      assert.ok(hand < 60, "the game ends");
      playHand(g, rng);
      for (const h of g.state.history) kinds.add(h.kind);
      if (g.state.winner === -1) {
        move(g, g.state.turn, { next: true });
        move(g, g.state.turn, { next: true });
      }
    }
    assert.equal(g.state.phase, "over");
  }
  for (const k of ["knock", "undercut", "gin", "draw"]) assert.ok(kinds.has(k), `a ${k} came up`);
});
