import test from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed } from "../rng.js";
import { cardPoints, isSet, isRun, isMeld, meldsIn, bestMelds, fits, bestLayoffs, bestDefence } from "./melds.js";

// "7H" -> the face of the seven of hearts; "7H 8H 9H" -> a list.
const F = (name) => "SHDC".indexOf(name.at(-1)) * 13 + ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"].indexOf(name.slice(0, -1));
const H = (names) => names.split(" ").map(F);
const N = (faces) => faces.map((f) => `${["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][f % 13]}${"SHDC"[Math.floor(f / 13)]}`).join(" ");
const names = (melds) => melds.map(N);

// A reference that shares nothing with melds.js: every subset of three or
// more cards that is a meld by definition, then every way to pick disjoint ones.
function slowBest(faces) {
  const meld = (cards) => {
    if (cards.length < 3) return false;
    const ranks = cards.map((f) => f % 13);
    const suits = cards.map((f) => Math.floor(f / 13));
    if (cards.length <= 4 && ranks.every((r) => r === ranks[0])) return true;
    if (!suits.every((s) => s === suits[0])) return false;
    const sorted = ranks.slice().sort((a, b) => a - b);
    return sorted.every((r, i) => !i || r === sorted[i - 1] + 1);
  };
  const n = faces.length;
  const melds = [];
  for (let m = 1; m < 1 << n; m++) if (meld(faces.filter((_, i) => m & (1 << i)))) melds.push(m);
  const value = (f) => Math.min((f % 13) + 1, 10);
  let best = Infinity;
  (function go(used, k) {
    let dead = 0;
    for (let i = 0; i < n; i++) if (!(used & (1 << i))) dead += value(faces[i]);
    best = Math.min(best, dead);
    for (let j = k; j < melds.length; j++) if (!(melds[j] & used)) go(used | melds[j], j + 1);
  })(0, 0);
  return best;
}

// Biggest meld first, then the next biggest that still fits: what a hurried player does.
function greedy(faces) {
  let left = faces.slice();
  for (;;) {
    const options = meldsIn(left).sort((a, b) => b.length - a.length);
    if (!options.length) return left.reduce((n, f) => n + cardPoints(f), 0);
    left = left.filter((f) => !options[0].includes(f));
  }
}

function deal(rng, n) {
  const deck = [...Array(52).keys()];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.slice(0, n);
}

test("card points: aces 1, court cards 10, the rest their number", () => {
  assert.deepEqual(H("AS 2H 9D 10C JS QH KD").map(cardPoints), [1, 2, 9, 10, 10, 10, 10]);
});

test("sets are three or four of a rank; runs are three or more in a row in one suit, aces low", () => {
  assert.ok(isSet(H("7S 7H 7D")) && isSet(H("7S 7H 7D 7C")));
  assert.ok(!isSet(H("7S 7H")) && !isSet(H("7S 7H 8D")));
  assert.ok(isRun(H("AS 2S 3S")), "A-2-3 is a run");
  assert.ok(isRun(H("JH QH KH")) && isRun(H("9D 10D JD QD KD")));
  assert.ok(!isRun(H("QS KS AS")), "Q-K-A is not: aces are low");
  assert.ok(!isRun(H("KS AS 2S")), "no wrapping round");
  assert.ok(!isRun(H("4S 5S 7S")) && !isRun(H("4S 5H 6S")) && !isRun(H("4S 5S")));
  assert.ok(isRun(H("6C 4C 5C")), "in any order");
  assert.ok(isMeld(H("3D 3C 3H")) && isMeld(H("3D 4D 5D")) && !isMeld(H("3D 4D 5C")));
  assert.ok(isRun(H("AC 2C 3C 4C 5C 6C 7C 8C 9C 10C JC QC KC")), "a whole suit");
});

test("the candidate melds: every three of a four-set and the four, every stretch of a long run", () => {
  const four = meldsIn(H("9S 9H 9D 9C"));
  assert.equal(four.length, 5);
  assert.ok(four.every(isSet));
  // A run of five holds three runs of three, two of four and one of five.
  const run = meldsIn(H("2H 3H 4H 5H 6H"));
  assert.deepEqual(run.map((m) => m.length).sort(), [3, 3, 3, 4, 4, 5]);
  assert.deepEqual(meldsIn(H("QS KS AS 2S")), [], "no Q-K-A or K-A-2");
  assert.deepEqual(meldsIn(H("5S 6H 7S 8S")), [], "a gap breaks a run");
});

test("the best arrangement: sets, runs, four-card sets and long runs", () => {
  const gin = bestMelds(H("AS 2S 3S 7H 7D 7C 7S 9D 10D JD"));
  assert.equal(gin.points, 0);
  assert.deepEqual(gin.deadwood, []);
  // The 7♠ goes in the four-set, not the run it can't make.
  assert.deepEqual(names(gin.melds), ["AS 2S 3S", "7S 7H 7D 7C", "9D 10D JD"]);
  const long = bestMelds(H("3C 4C 5C 6C 7C 8C 9C 10C KH KS"));
  assert.deepEqual([names(long.melds), N(long.deadwood), long.points], [["3C 4C 5C 6C 7C 8C 9C 10C"], "KS KH", 20]);
  const none = bestMelds(H("AS 3H 5D 7C 9S JH KD 2C 4S 6H"));
  assert.equal(none.points, 1 + 3 + 5 + 7 + 9 + 10 + 10 + 2 + 4 + 6);
  assert.deepEqual(none.melds, []);
  assert.deepEqual(bestMelds([]), { melds: [], deadwood: [], points: 0 });
});

test("a card that could go in a set or a run goes where it leaves the least", () => {
  // 7♠ in the run 5-6-7♠ and the other three 7s as a set: no deadwood at all.
  const both = bestMelds(H("5S 6S 7S 7H 7D 7C KH"));
  assert.deepEqual([names(both.melds), N(both.deadwood)], [["5S 6S 7S", "7H 7D 7C"], "KH"]);
  // With only two other 7s, the run keeps it: 7♥ and 7♦ are cheaper deadwood than 8♠ and 9♠.
  const run = bestMelds(H("7S 8S 9S 7H 7D"));
  assert.deepEqual([names(run.melds), run.points], [["7S 8S 9S"], 14]);
  // And the set takes it when the run's other cards are cheaper to leave.
  const set = bestMelds(H("5S 6S 7S 7H 7D"));
  assert.deepEqual([names(set.melds), set.points], [["7S 7H 7D"], 11]);
  // 4♦ holds the run together: the set of 4s would strand 2♦ 3♦ and 5♦ 6♦.
  const middle = bestMelds(H("2D 3D 4D 5D 6D 4S 4H"));
  assert.deepEqual([names(middle.melds), N(middle.deadwood)], [["2D 3D 4D 5D 6D"], "4S 4H"]);
});

test("the arrangement doesn't depend on the order the cards come in", () => {
  // J-Q-K♠ or three queens leave 20 either way: the same one is chosen every time.
  const hand = H("JS QS KS QH QD 4C");
  const first = bestMelds(hand);
  const rng = rngFromSeed("orders");
  for (let i = 0; i < 50; i++) {
    const shuffled = hand.slice().sort(() => rng() - 0.5);
    assert.deepEqual(bestMelds(shuffled), first);
    assert.deepEqual(bestDefence(shuffled, [H("9S 10S 8S")]), bestDefence(hand, [H("9S 10S 8S")]));
  }
});

test("the best arrangement beats biggest-meld-first, and matches an exhaustive search on 3000 random hands", () => {
  // Greedy takes the four 7s and strands 5♠ 6♠; the run 5-6-7♠ and three 7s leave less.
  const trap = H("5S 6S 7S 7H 7D 7C 2C 2D KH QH");
  assert.equal(greedy(trap), 5 + 6 + 2 + 2 + 10 + 10);
  assert.equal(bestMelds(trap).points, 2 + 2 + 10 + 10);
  const rng = rngFromSeed("melds vs slow");
  let beat = 0;
  for (let i = 0; i < 3000; i++) {
    const hand = deal(rng, i % 2 ? 10 : 11);
    const best = bestMelds(hand);
    assert.equal(best.points, slowBest(hand), N(hand));
    // What it returns adds up: real melds, disjoint, and the rest is the deadwood counted.
    assert.ok(best.melds.every(isMeld));
    const used = [...best.melds.flat(), ...best.deadwood];
    assert.deepEqual(used.slice().sort((a, b) => a - b), hand.slice().sort((a, b) => a - b));
    assert.equal(best.deadwood.reduce((n, f) => n + cardPoints(f), 0), best.points);
    if (best.points < greedy(hand)) beat++;
  }
  assert.ok(beat > 0, "greedy loses somewhere");
});

test("crowded hands: every rank's set crossing every run", () => {
  // Three suits of A-2-3-4 minus one: sets and runs overlap everywhere.
  for (const hand of [H("AS 2S 3S 4S AH 2H 3H 4H AD 2D 3D"), H("AS AH AD 2S 2H 2D 3S 3H 3D 4S 4H"), H("8S 9S 10S JS 8H 9H 10H JH 8D 9D 10D")]) {
    assert.equal(bestMelds(hand).points, slowBest(hand), N(hand));
    assert.equal(bestMelds(hand).points, 0);
  }
});

test("fits: the fourth card of a set, either end of a run", () => {
  assert.equal(fits(F("7C"), H("7S 7H 7D")), "set");
  assert.equal(fits(F("7C"), H("7S 7H 7D 7C")), null);
  assert.equal(fits(F("7S"), H("7S 7H 7D")), null, "already in it");
  assert.equal(fits(F("4H"), H("5H 6H 7H")), "low");
  assert.equal(fits(F("8H"), H("7H 5H 6H")), "high");
  assert.equal(fits(F("9H"), H("5H 6H 7H")), null);
  assert.equal(fits(F("8S"), H("5H 6H 7H")), null);
  assert.equal(fits(F("KH"), H("AH 2H 3H")), null, "aces are low");
  assert.equal(fits(F("AH"), H("JH QH KH")), null);
  assert.equal(fits(F("AH"), H("2H 3H 4H")), "low");
});

test("lay-offs: a run takes the next card in turn, and a card that fits a set and a run goes where more can follow", () => {
  const chain = bestLayoffs(H("8C 6C 7C"), [H("3C 4C 5C"), H("7S 7H 7D")]);
  // 7♣ could complete the 7s, but on the run it lets 8♣ follow.
  assert.equal(chain.points, 6 + 7 + 8);
  assert.deepEqual(chain.layoffs.map(([f, j]) => [N([f]), j]), [["6C", 0], ["7C", 0], ["8C", 0]]);
  // Both ends of a run, and the fourth of a set.
  const ends = bestLayoffs(H("4H 8H 9C KD"), [H("5H 6H 7H"), H("9S 9H 9D")]);
  assert.equal(ends.points, 4 + 8 + 9);
  const none = bestLayoffs(H("KD QC"), [H("5H 6H 7H")]);
  assert.deepEqual(none, { points: 0, layoffs: [] });
  // Laid in order, every card fits the meld as it stands then.
  const melds = [H("3C 4C 5C"), H("7S 7H 7D")];
  for (const [f, j] of chain.layoffs) {
    assert.ok(fits(f, melds[j]));
    melds[j].push(f);
  }
});

test("the defence: its own melds, then lay-offs, even breaking up a meld to lay off more", () => {
  const knocker = [H("4H 5H 6H"), H("JS QS KS")];
  // Alone, the four 7s are the best melds (8♥ and K♣ left: 18). Against 4-5-6♥, three 7s
  // and 7♥ 8♥ laid off on the run leave only K♣.
  const hand = H("7H 7S 7D 7C 8H KC");
  assert.equal(bestMelds(hand).points, 18);
  const d = bestDefence(hand, knocker);
  assert.deepEqual([names(d.melds), d.layoffs.map(([f, j]) => [N([f]), j]), N(d.deadwood), d.points], [["7S 7D 7C"], [["7H", 0], ["8H", 0]], "KC", 10]);
  // The fourth card of a set, and both ends of a run.
  const ends = bestDefence(H("3H 7H QS 2C"), [H("4H 5H 6H"), H("QH QD QC")]);
  assert.deepEqual([ends.layoffs.length, N(ends.deadwood)], [3, "2C"]);
  // After gin there are no lay-offs: only the defender's own melds count.
  const gin = bestDefence(H("7H 8H 2C"), knocker, { layoff: false });
  assert.deepEqual([gin.layoffs, gin.points], [[], 7 + 8 + 2]);
});

// Every arrangement and every order of lay-offs, the slow way.
function slowDefence(faces, theirs) {
  let best = Infinity;
  const value = (f) => Math.min((f % 13) + 1, 10);
  const n = faces.length;
  const melds = [];
  for (let m = 1; m < 1 << n; m++) if (isMeld(faces.filter((_, i) => m & (1 << i)))) melds.push(m);
  function layoffs(left, now) {
    let most = 0;
    for (const f of left) for (const [j, m] of now.entries()) if (fits(f, m)) most = Math.max(most, value(f) + layoffs(left.filter((x) => x !== f), now.map((x, k) => (k === j ? [...x, f] : x))));
    return most;
  }
  (function go(used, k) {
    const dead = faces.filter((_, i) => !(used & (1 << i)));
    best = Math.min(best, dead.reduce((s, f) => s + value(f), 0) - layoffs(dead, theirs));
    for (let j = k; j < melds.length; j++) if (!(melds[j] & used)) go(used | melds[j], j + 1);
  })(0, 0);
  return best;
}

test("the defence matches an exhaustive search on random knocks", () => {
  const rng = rngFromSeed("defence vs slow");
  let laid = 0;
  for (let i = 0; i < 400; i++) {
    const cards = deal(rng, 18);
    const knock = bestMelds(cards.slice(0, 10));
    const hand = cards.slice(10, 17);
    const d = bestDefence(hand, knock.melds);
    assert.equal(d.points, slowDefence(hand, knock.melds), `${N(hand)} onto ${names(knock.melds)}`);
    // The lay-offs, laid in order onto the knocker's melds, all fit.
    const melds = knock.melds.map((m) => m.slice());
    for (const [f, j] of d.layoffs) {
      assert.ok(fits(f, melds[j]), `${N([f])} onto ${N(melds[j])}`);
      melds[j].push(f);
    }
    const used = [...d.melds.flat(), ...d.layoffs.map(([f]) => f), ...d.deadwood];
    assert.deepEqual(used.slice().sort((a, b) => a - b), hand.slice().sort((a, b) => a - b));
    if (d.layoffs.length) laid++;
  }
  assert.ok(laid > 20, `${laid} defences laid off`);
});

test("speed: the worst hands take well under 10 ms", () => {
  const worst = [
    H("AS 2S 3S 4S 5S 6S 7S 8S 9S 10S JS"), // one long run: 45 stretches
    H("AS 2S 3S 4S AH 2H 3H 4H AD 2D 3D"), // sets crossing runs
    H("5S 6S 7S 8S 5H 6H 7H 8H 5D 6D 7D"),
    H("AS AH AD AC 2S 2H 2D 2C 3S 3H 3D"),
  ];
  // The fastest of 20 runs: what the code costs, without whatever else the machine is doing.
  const time = (fn) => {
    fn(); // warm up
    let best = Infinity;
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      fn();
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  for (const hand of worst) {
    const ms = time(() => bestMelds(hand));
    assert.ok(ms < 2, `${N(hand)}: ${ms.toFixed(2)} ms`);
  }
  // A defence that can lay off almost everything, and one with a crowded hand of its own.
  const cases = [
    [H("AS 2S 3S 7S 8S 9S 10S JS QS KS"), [H("4S 5S 6S"), H("AH AD AC")]],
    [H("5S 6S 7S 8S 5H 6H 7H 8H 5D 6D"), [H("4S 4H 4D"), H("9S 9H 9D"), H("9C 10C JC")]],
    [H("2C 3C 4C 5C 6C 7C 8C 9C 10C JC"), [H("AC AS AH"), H("QC QH QD")]],
  ];
  for (const [hand, theirs] of cases) {
    const ms = time(() => bestDefence(hand, theirs));
    assert.ok(ms < 5, `${N(hand)}: ${ms.toFixed(2)} ms`);
  }
});
