// Gin Rummy rules for CardMatch (engine/card-match.js): two players, a
// 52-card deck, ten cards each. One match is a whole game: hand after hand
// to 100 points (or a single hand), the deck shuffled again by both browsers
// between hands. Each step is a move by whoever makes it, in phases upcard,
// draw, discard, lay (the knocker's melds), defend (the defender's melds and
// lay-offs) and result. A knock shows the knocker's hand and the defence the
// defender's, so every meld and score is checked live. See "Gin Rummy in
// depth" in ARCHITECTURE.md.
import { RuleError } from "../engine/turn-match.js";
import { DECK } from "../engine/cards/faces.js";
import { cardPoints, isMeld, fits, bestMelds, bestDefence } from "../engine/cards/melds.js";

export { cardPoints };
export const HAND = 10;
export const KNOCK_LIMIT = 10;
export const GIN_BONUS = 25;
export const BIG_GIN_BONUS = 31;
export const UNDERCUT_BONUS = 25;
export const GAME_BONUS = 100;
export const LINE_BONUS = 25; // a game's end: per hand won
export const DEAD_STOCK = 2; // a discard that leaves this many in the stock without a knock ends the hand

export const TARGETS = [100, 0]; // points to win a game; 0: one hand per game
export const KNOCKS = ["classic", "oklahoma"];
export const DEALERS = ["random", "host", "guest"];
export const MOVE_SECONDS = [0, 15, 30, 60];
export const LEVELS = ["easy", "medium", "hard"];
// level and fourColor are per device; the rules ignore them.
export const DEFAULT_CONFIG = { target: 100, knock: "classic", bigGin: false, dealer: "random", moveSeconds: 0, level: "easy", fourColor: false };

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    target: pick(c.target, TARGETS, DEFAULT_CONFIG.target),
    knock: pick(c.knock, KNOCKS, DEFAULT_CONFIG.knock),
    bigGin: pick(c.bigGin, [true, false], DEFAULT_CONFIG.bigGin),
    dealer: pick(c.dealer, DEALERS, DEFAULT_CONFIG.dealer),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
    fourColor: pick(c.fourColor, [true, false], DEFAULT_CONFIG.fourColor),
  };
}

const other = (p) => 1 - p;
const isSlots = (v) => Array.isArray(v) && v.every(Number.isInteger) && new Set(v).size === v.length;

// The knocker's melds as faces, with any cards laid off onto them so far.
export function knockerMelds(state, face) {
  const k = state.knock?.p;
  if (k === undefined || !state.laid[k]) return [];
  const melds = state.laid[k].melds.map((m) => m.map(face));
  for (const [slot, j] of state.layoffs) melds[j].push(face(slot));
  return melds;
}

// The best arrangement of `slots` as slots: { melds, deadwood, points }; null if a face is unknown.
export function arrange(slots, face) {
  const faces = slots.map(face);
  if (faces.some((f) => f === null)) return null;
  const slotOf = new Map(slots.map((s, i) => [faces[i], s]));
  const best = bestMelds(faces);
  return { melds: best.melds.map((m) => m.map((f) => slotOf.get(f))), deadwood: best.deadwood.map((f) => slotOf.get(f)), points: best.points };
}

// The least deadwood p's best legal discard leaves: { points, discard }, or null.
export function bestKnock(state, p, face) {
  const hand = state.hands[p];
  if (hand.length !== HAND + 1 || hand.some((s) => face(s) === null)) return null;
  let best = null;
  for (const slot of hand) {
    if (slot === state.taken) continue;
    const a = arrange(hand.filter((s) => s !== slot), face);
    // Equal deadwood: throw the higher card.
    if (!best || a.points < best.points || (a.points === best.points && cardPoints(face(slot)) > cardPoints(face(best.discard)))) best = { points: a.points, discard: slot };
  }
  return best;
}

// The honest move nobody chooses (laying down melds, the defence); null for a real choice.
export function forcedMove(state, me, face) {
  if (state.winner !== -1 || state.turn !== me) return null;
  if (state.phase === "lay") {
    const a = arrange(state.hands[me], face);
    return a && { melds: a.melds };
  }
  if (state.phase === "defend") {
    const hand = state.hands[me];
    const faces = hand.map(face);
    if (faces.some((f) => f === null)) return null;
    const slotOf = new Map(hand.map((s, i) => [faces[i], s]));
    const d = bestDefence(faces, knockerMelds(state, face), { layoff: !state.knock.gin });
    return { melds: d.melds.map((m) => m.map((f) => slotOf.get(f))), layoffs: d.layoffs.map(([f, j]) => [slotOf.get(f), j]) };
  }
  return null;
}

export function makeRules(config = DEFAULT_CONFIG) {
  const c = normalizeConfig(config);

  // Deals a new hand from `slots` (52, top first): ten each from the non-dealer, then the upcard.
  function deal(state, deck, slots) {
    const first = other(state.dealer);
    state.cards = slots.slice();
    state.stock = slots.slice();
    state.hands = [[], []];
    for (let r = 0; r < HAND; r++) {
      for (let k = 0; k < 2; k++) {
        const p = (first + k) % 2;
        const slot = state.stock.shift();
        deck.deal(slot, p);
        state.hands[p].push(slot);
      }
    }
    const up = state.stock.shift();
    deck.open(up);
    Object.assign(state, { since: state.log.length, discard: [up], upcard: up, limit: null, passes: 0, taken: null, knock: null, laid: [null, null], layoffs: [], result: null, ready: 0, phase: "upcard", turn: first });
  }

  // The stock's top card to p, hidden from the other player.
  function drawStock(state, deck, p, events) {
    const slot = state.stock.shift();
    deck.deal(slot, p);
    state.hands[p].push(slot);
    state.taken = null;
    state.log.push({ t: "draw", p });
    events.push({ type: "draw", p, slot });
  }

  function takePile(state, deck, p, events, from) {
    const slot = state.discard.pop();
    deck.deal(slot, p);
    state.hands[p].push(slot);
    state.taken = slot;
    state.log.push({ t: "take", p, slot });
    events.push({ type: "take", p, slot, from });
  }

  // Melds named in a move: real melds of p's own cards, none twice; returns the deadwood left among `hand`.
  function checkMelds(deck, hand, melds) {
    if (!Array.isArray(melds) || !melds.every(isSlots)) throw new RuleError("lay down melds of your own cards");
    const used = melds.flat();
    if (new Set(used).size !== used.length || !used.every((s) => hand.includes(s))) throw new RuleError("lay down melds of your own cards");
    for (const m of melds) {
      const faces = m.map((s) => deck.face(s));
      if (faces.some((f) => f === null)) throw new RuleError("show your hand to lay it down");
      if (!isMeld(faces)) throw new RuleError("that isn't a set or a run");
    }
    return hand.filter((s) => !used.includes(s));
  }

  const points = (deck, slots) => slots.reduce((n, s) => n + cardPoints(deck.face(s)), 0);

  function discardMove(state, p, move, deck, events) {
    const hand = state.hands[p];
    const knock = move.knock === true;
    const slot = move.discard;
    if (slot === undefined && knock) return bigGin(state, p, deck, events);
    if (!hand.includes(slot)) throw new RuleError("discard a card from your hand");
    if (slot === state.taken) throw new RuleError("you can't discard the card you just took from the pile");
    if (knock) {
      if (state.limit === null) throw new RuleError("the upcard isn't turned yet");
      const rest = hand.filter((s) => s !== slot);
      if (rest.some((s) => deck.face(s) === null)) throw new RuleError("show your hand to knock");
      const dead = bestMelds(rest.map((s) => deck.face(s))).points;
      if (dead > state.limit) throw new RuleError(`you can knock with ${state.limit} points of deadwood at most, not ${dead}`);
      state.knock = { p, discard: slot, gin: dead === 0 ? 1 : 0 };
    }
    state.hands[p] = hand.filter((s) => s !== slot);
    state.discard.push(slot);
    state.taken = null;
    state.log.push({ t: "discard", p, slot });
    events.push({ type: "discard", p, slot, knock });
    if (knock) {
      events.push({ type: "knock", p, gin: state.knock.gin });
      state.phase = "lay";
      return;
    }
    if (state.stock.length <= DEAD_STOCK) return endHand(state, { kind: "draw", winner: -1, points: 0 }, events);
    state.turn = other(p);
    state.phase = "draw";
  }

  // Going out with all eleven cards melded, no discard.
  function bigGin(state, p, deck, events) {
    if (!c.bigGin) throw new RuleError("Big Gin is off in this game: discard a card");
    const hand = state.hands[p];
    if (hand.some((s) => deck.face(s) === null)) throw new RuleError("show your hand to knock");
    if (bestMelds(hand.map((s) => deck.face(s))).points) throw new RuleError("Big Gin needs all eleven cards in melds");
    state.knock = { p, discard: null, gin: 2 };
    state.taken = null;
    state.log.push({ t: "knock", p });
    events.push({ type: "knock", p, gin: 2 });
    state.phase = "lay";
  }

  function lay(state, p, move, deck, events) {
    const hand = state.hands[p];
    const deadwood = checkMelds(deck, hand, move.melds);
    const dead = points(deck, deadwood);
    if (state.knock.gin && dead) throw new RuleError("gin lays every card in melds");
    if (dead > state.limit) throw new RuleError(`a knock leaves ${state.limit} points of deadwood at most`);
    state.laid[p] = { melds: move.melds.map((m) => m.slice()), deadwood, points: dead };
    events.push({ type: "lay", p, melds: state.laid[p].melds, deadwood, points: dead });
    state.phase = "defend";
    state.turn = other(p);
  }

  function defend(state, p, move, deck, events) {
    const hand = state.hands[p];
    const left = checkMelds(deck, hand, move.melds);
    const offs = move.layoffs ?? [];
    if (!Array.isArray(offs) || !offs.every((o) => Array.isArray(o) && o.length === 2 && o.every(Number.isInteger))) throw new RuleError("bad lay-offs");
    if (offs.length && state.knock.gin) throw new RuleError("nothing can be laid off on gin");
    const melds = knockerMelds(state, (s) => deck.face(s));
    const laid = [];
    for (const [slot, j] of offs) {
      if (!left.includes(slot) || laid.includes(slot)) throw new RuleError("lay off cards from your deadwood");
      if (!melds[j] || !fits(deck.face(slot), melds[j])) throw new RuleError("that card doesn't fit that meld");
      melds[j].push(deck.face(slot));
      laid.push(slot);
    }
    const deadwood = left.filter((s) => !laid.includes(s));
    const dead = points(deck, deadwood);
    state.laid[p] = { melds: move.melds.map((m) => m.slice()), deadwood, points: dead };
    state.layoffs = offs.map((o) => o.slice());
    events.push({ type: "defend", p, melds: state.laid[p].melds, layoffs: state.layoffs, deadwood, points: dead });
    const k = state.knock.p;
    const mine = state.laid[k].points;
    if (state.knock.gin) endHand(state, { kind: state.knock.gin === 2 ? "big" : "gin", winner: k, points: (state.knock.gin === 2 ? BIG_GIN_BONUS : GIN_BONUS) + dead }, events);
    else if (dead <= mine) endHand(state, { kind: "undercut", winner: p, points: mine - dead + UNDERCUT_BONUS }, events);
    else endHand(state, { kind: "knock", winner: k, points: dead - mine }, events);
  }

  function endHand(state, result, events) {
    state.result = result;
    if (result.winner >= 0) {
      state.scores[result.winner] += result.points;
      state.wins[result.winner]++;
    }
    state.history.push({ hand: state.hand, dealer: state.dealer, ...result });
    events.push({ type: "score", ...result, scores: state.scores.slice() });
    state.ready = 0;
    if (c.target === 0) return finish(state, result.winner === -1 ? 2 : result.winner, events);
    if (result.winner >= 0 && state.scores[result.winner] >= c.target) return finish(state, result.winner, events);
    state.phase = "result";
    state.turn = other(state.dealer);
  }

  // The game is over: in a game to 100, the bonuses go on (100 to the winner, 25 a hand to each).
  function finish(state, winner, events) {
    state.phase = "over";
    state.winner = winner;
    const totals = state.scores.map((s, p) => (c.target ? s + LINE_BONUS * state.wins[p] + (p === winner ? GAME_BONUS : 0) : s));
    state.final = { totals, game: c.target ? GAME_BONUS : 0, line: c.target ? LINE_BONUS : 0 };
    events.push({ type: "over", winner, totals });
  }

  function next(state, p, deck, events) {
    state.ready++;
    events.push({ type: "ready", p });
    if (state.ready < 2) {
      state.turn = other(p);
      return;
    }
    const slots = deck.shuffle(state.cards);
    state.hand++;
    state.dealer = other(state.dealer);
    events.push({ type: "gather", hand: state.hand, dealer: state.dealer });
    deal(state, deck, slots);
    events.push({ type: "deal", hand: state.hand, dealer: state.dealer, hands: state.hands.map((h) => h.slice()), upcard: state.upcard });
  }

  return {
    deckSize: DECK,

    newState(first, players, deck) {
      if (players !== 2) throw new RuleError("Gin Rummy is for two players");
      const dealer = c.dealer === "host" ? 0 : c.dealer === "guest" ? 1 : first;
      const state = {
        turn: other(dealer),
        winner: -1,
        players,
        target: c.target,
        knockRule: c.knock,
        bigGin: c.bigGin,
        first: dealer, // the first hand's dealer
        hand: 1,
        dealer,
        phase: "upcard",
        cards: [], // this hand's 52 slots
        stock: [],
        discard: [], // top last
        hands: [[], []],
        upcard: null,
        limit: null, // the knock limit, once the upcard is turned
        passes: 0,
        taken: null, // the card just taken from the pile: it can't go straight back
        knock: null, // { p, discard, gin: 0 knock, 1 gin, 2 Big Gin }
        laid: [null, null], // { melds: [[slots]], deadwood: [slots], points } once laid down
        layoffs: [], // [slot, meld index] onto the knocker's melds, in order
        result: null, // { kind: "knock" | "undercut" | "gin" | "big" | "draw", winner, points }
        ready: 0, // players ready for the next hand
        scores: [0, 0],
        wins: [0, 0], // hands won
        history: [],
        final: null, // { totals, game, line } when the game ends
        log: [], // public: takes, passes, draws, discards; for the robots
        since: 0, // where this hand's entries start in the log
        moves: 0,
      };
      deal(state, deck, deck.cards);
      return state;
    },

    // Turns the upcard: the knock limit comes from it in Oklahoma.
    settle(state, deck) {
      if (state.limit !== null || state.upcard === null || state.phase === "over") return [];
      const face = deck.face(state.upcard);
      state.limit = c.knock === "oklahoma" ? cardPoints(face) : KNOCK_LIMIT;
      return [{ type: "upcard", slot: state.upcard, limit: state.limit }];
    },

    reveals(state, player, move) {
      if (state.phase === "discard" && move?.knock === true) return state.hands[player];
      if (state.phase === "discard" && Number.isInteger(move?.discard)) return [move.discard];
      if (state.phase === "defend" && move?.melds) return state.hands[player];
      return [];
    },

    applyMove(state, player, move, deck) {
      if (state.winner !== -1) throw new RuleError("the game is over");
      if (state.turn !== player) throw new RuleError("not your turn");
      if (!move || typeof move !== "object") throw new RuleError("bad move");
      const events = [];
      const ph = state.phase;
      if (ph === "upcard" && move.take === true) {
        takePile(state, deck, player, events, "upcard");
        state.phase = "discard";
      } else if (ph === "upcard" && move.pass === true) {
        state.passes++;
        state.log.push({ t: "pass", p: player, slot: state.upcard });
        events.push({ type: "pass", p: player });
        state.turn = other(player);
        if (state.passes === 2) {
          drawStock(state, deck, state.turn, events);
          state.phase = "discard";
        }
      } else if (ph === "draw" && move.draw === "stock") {
        drawStock(state, deck, player, events);
        state.phase = "discard";
      } else if (ph === "draw" && move.draw === "pile") {
        if (!state.discard.length) throw new RuleError("the discard pile is empty");
        takePile(state, deck, player, events, "pile");
        state.phase = "discard";
      } else if (ph === "discard" && (move.discard !== undefined || move.knock === true)) discardMove(state, player, move, deck, events);
      else if (ph === "lay" && move.melds !== undefined) lay(state, player, move, deck, events);
      else if (ph === "defend" && move.melds !== undefined) defend(state, player, move, deck, events);
      else if (ph === "result" && move.next === true) next(state, player, deck, events);
      else throw new RuleError(`that move doesn't fit now (${ph})`);
      state.moves++;
      return events;
    },
  };
}
