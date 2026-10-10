// Crazy Eights rules for CardMatch (engine/card-match.js), for two to four
// players with a standard 52-card deck. Two players get 7 cards, three or
// four get 5. The top of the stock starts the discard pile (an 8 there goes
// to the bottom of the stock). On your turn, play a card of the current suit
// or the top card's rank, or an 8 and name a suit; else draw. When the stock
// runs out, the discard pile under its top card is shuffled into a new one.
// The first player to empty their hand wins.
//
// A card's face is 0–51, the standard deck of engine/cards/faces.js.
// Pure: the deck API is the only way to see a card.
import { RuleError } from "../engine/turn-match.js";
import { DECK, SUIT_SIGNS, RANK_NAMES, suitOf, rankOf, cardName } from "../engine/cards/faces.js";

export { DECK, SUIT_SIGNS, RANK_NAMES, suitOf, rankOf, cardName };
export const MAX_PLAYERS = 4;
export const ACE = 0;
export const TWO = 1;
export const EIGHT = 7;
export const QUEEN = 11;
// A game this many turns long is going round in circles (see ARCHITECTURE.md).
export const MAX_TURNS = 1200;

// Penalty points for a card left in hand: 8 is 50, a court card 10, an ace 1, others their pip value.
export const points = (face) => (rankOf(face) === EIGHT ? 50 : rankOf(face) >= 10 ? 10 : rankOf(face) + 1);
export const handSize = (players) => (players === 2 ? 7 : 5);
// What follows the pile, in words: "a ♥, a 7 or an 8" (just "a ♥ or an 8" on an 8).
export function toFollow(state) {
  const r = rankOf(state.top);
  const rank = r === EIGHT ? "" : `, ${r === ACE ? "an" : "a"} ${RANK_NAMES[r]}`;
  return `a ${SUIT_SIGNS[state.suit]}${rank} or an 8`;
}

export const DRAWS = ["until", "one"];
export const FIRST = ["random", "host", "guest"];
export const MOVE_SECONDS = [0, 15, 30, 60];
export const LEVELS = ["easy", "medium", "hard"];
export const ROBOTS = [1, 2, 3];
// level, robots and fourColor are per device; the rules ignore them.
export const DEFAULT_CONFIG = {
  draw: "until",
  strict: true,
  actions: false,
  first: "random",
  moveSeconds: 0,
  level: "easy",
  robots: 3,
  fourColor: false,
};

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const bool = (k) => pick(c[k], [true, false], DEFAULT_CONFIG[k]);
  return {
    draw: pick(c.draw, DRAWS, DEFAULT_CONFIG.draw),
    strict: bool("strict"),
    actions: bool("actions"),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
    robots: pick(c.robots, ROBOTS, DEFAULT_CONFIG.robots),
    fourColor: bool("fourColor"),
  };
}

// ---------- what a player may do (public facts only) ----------
export const isEight = (face) => rankOf(face) === EIGHT;
// A known face that may go on the pile now.
export const follows = (state, face) => face !== null && (isEight(face) || suitOf(face) === state.suit || rankOf(face) === rankOf(state.top));
export const pilesLeft = (state) => state.stock.length > 0 || state.discard.length > 1;
export const canDraw = (state) => !state.starter && (state.draw === "until" || state.drew === 0) && pilesLeft(state);
// Pass after the one draw, or when there is nothing left to draw.
export const canPass = (state) => !state.starter && ((state.draw === "one" && state.drew > 0) || !pilesLeft(state));
export const next = (state, p) => (p + state.dir + state.players) % state.players;
// The cards of a hand that play, of those whose faces face() knows.
export const playable = (state, player, face) => state.hands[player].filter((slot) => follows(state, face(slot)));

export function makeRules(config = DEFAULT_CONFIG) {
  const c = normalizeConfig(config);

  // A hidden face is null during play, so this only bites in the audit.
  const holdsPlay = (state, player, deck) => state.hands[player].some((slot) => follows(state, deck.face(slot)));

  // Shuffles the discard pile under its top card into a new stock; how many cards went.
  function reshuffle(state, deck) {
    const under = state.discard.splice(0, state.discard.length - 1);
    state.stock = deck.shuffle(under);
    state.reshuffles++;
    state.history.push({ t: "reshuffle" });
    return under.length;
  }

  // Deals up to n cards from the stock to player, reshuffling when it runs out.
  function give(state, deck, player, n) {
    const slots = [];
    let shuffled = 0;
    for (let i = 0; i < n; i++) {
      if (!state.stock.length && state.discard.length > 1) shuffled += reshuffle(state, deck);
      if (!state.stock.length) break;
      const slot = state.stock.shift();
      deck.deal(slot, player);
      state.hands[player].push(slot);
      slots.push(slot);
    }
    return { slots, shuffled };
  }

  // Blocked, or too long: the fewest cards win, ties to the first in turn order from the player on turn.
  function block(state, why = "blocked") {
    const fewest = Math.min(...state.hands.map((h) => h.length));
    let p = state.turn;
    while (state.hands[p].length !== fewest) p = next(state, p);
    state.winner = p;
    state.ended = why;
  }

  function endTurn(state, to) {
    state.turn = to;
    state.drew = 0;
    state.moves++;
    if (++state.turns >= MAX_TURNS && state.winner === -1) block(state, "long");
  }

  function play(state, player, move, deck) {
    const hand = state.hands[player];
    const i = hand.indexOf(move.play);
    if (i === -1) throw new RuleError("that card isn't in your hand");
    const face = deck.face(move.play);
    if (face === null) throw new RuleError("that card wasn't shown");
    if (!follows(state, face)) throw new RuleError(`play ${toFollow(state)}`);
    const eight = isEight(face);
    if (eight && !(Number.isInteger(move.suit) && move.suit >= 0 && move.suit < 4)) throw new RuleError("an 8 needs a suit");
    if (!eight && move.suit !== undefined) throw new RuleError("only an 8 names a suit");
    hand.splice(i, 1);
    state.discard.push(move.play);
    state.top = face;
    state.suit = eight ? move.suit : suitOf(face);
    state.named = eight;
    state.idle = 0;
    state.plays[player]++;
    state.history.push({ t: "play", p: player, face, suit: state.suit });
    const ev = { type: "play", player, slot: move.play, face, suit: state.suit, eight };
    if (!hand.length) {
      state.winner = player;
      state.ended = "out";
      state.moves++;
      return [ev];
    }
    let to = next(state, player);
    const rank = rankOf(face);
    if (c.actions && rank === TWO) {
      const { slots, shuffled } = give(state, deck, to, 2);
      Object.assign(ev, { action: "two", victim: to, dealt: slots, shuffled });
      state.history.push({ t: "take", p: to, n: slots.length });
      to = next(state, to);
    } else if (c.actions && rank === QUEEN) {
      Object.assign(ev, { action: "skip", victim: to });
      to = next(state, to);
    } else if (c.actions && rank === ACE) {
      state.dir = -state.dir;
      // With two players a reverse brings the turn straight back, like a skip.
      Object.assign(ev, { action: "reverse", dir: state.dir });
      to = state.players === 2 ? player : next(state, player);
    }
    endTurn(state, to);
    return [ev];
  }

  function draw(state, player, deck) {
    if (!pilesLeft(state)) throw new RuleError("there's nothing left to draw");
    if (!canDraw(state)) throw new RuleError("you've drawn your card this turn");
    if (c.strict && holdsPlay(state, player, deck)) throw new RuleError("drew while holding a card that plays");
    state.history.push({ t: "draw", p: player, suit: state.suit, rank: rankOf(state.top) });
    const { slots, shuffled } = give(state, deck, player, 1);
    state.drew++;
    state.idle = 0;
    state.draws[player]++;
    state.moves++;
    return [{ type: "draw", player, slot: slots[0], shuffled }];
  }

  function pass(state, player, deck) {
    if (!canPass(state)) throw new RuleError(state.drew ? "play a card or draw again" : "draw a card first");
    const afterDraw = state.draw === "one" && state.drew > 0;
    // Passing instead of drawing from empty piles is a draw you couldn't make.
    if (c.strict && !afterDraw && holdsPlay(state, player, deck)) throw new RuleError("passed while holding a card that plays");
    state.history.push({ t: "pass", p: player, suit: state.suit, rank: rankOf(state.top), afterDraw });
    if (!afterDraw) state.idle++;
    const ev = { type: "pass", player, afterDraw };
    endTurn(state, next(state, player));
    if (state.idle >= state.players && state.winner === -1) block(state);
    return [ev];
  }

  return {
    deckSize: DECK,

    newState(first, players, deck) {
      const turn = c.first === "host" ? 0 : c.first === "guest" ? 1 : first;
      const stock = deck.cards.slice();
      const hands = Array.from({ length: players }, () => []);
      for (let r = 0; r < handSize(players); r++) {
        for (let k = 0; k < players; k++) {
          const p = (turn + k) % players; // the player who starts gets the first card
          const slot = stock.shift();
          deck.deal(slot, p);
          hands[p].push(slot);
        }
      }
      return {
        turn,
        winner: -1,
        first: turn,
        players,
        draw: c.draw,
        strict: c.strict,
        actions: c.actions,
        stock,
        discard: [],
        hands,
        top: -1, // the face on the discard pile
        suit: -1, // the suit to follow: the top card's, or the one an 8 named
        named: false,
        dir: 1,
        drew: 0, // cards drawn this turn
        idle: 0, // passes in a row with nothing drawn
        moves: 0,
        turns: 0,
        starter: true, // the starter hasn't been turned yet
        reshuffles: 0,
        ended: null, // "out", "blocked" or "long"
        plays: Array(players).fill(0),
        draws: Array(players).fill(0),
        history: [], // public: every play, draw, pass and reshuffle, for the robots
      };
    },

    // Turns the starter; an 8 goes to the bottom of the stock and the next card is turned.
    settle(state, deck) {
      if (!state.starter) return [];
      if (!state.discard.length) {
        const slot = state.stock.shift();
        deck.open(slot);
        state.discard.push(slot);
        return [{ type: "flip", slot }];
      }
      const slot = state.discard.at(-1);
      const face = deck.face(slot);
      if (isEight(face)) {
        state.discard.pop();
        state.stock.push(slot);
        const turn = state.stock.shift();
        deck.open(turn);
        state.discard.push(turn);
        return [{ type: "bury", slot, face }, { type: "flip", slot: turn }];
      }
      state.top = face;
      state.suit = suitOf(face);
      state.starter = false;
      state.history.push({ t: "starter", face });
      return [{ type: "starter", slot, face }];
    },

    reveals: (state, player, move) => (Number.isInteger(move?.play) ? [move.play] : []),

    applyMove(state, player, move, deck) {
      if (state.winner !== -1) throw new RuleError("the game is over");
      if (state.turn !== player) throw new RuleError("not your turn");
      if (state.starter) throw new RuleError("the starter isn't turned yet");
      if (!move || typeof move !== "object") throw new RuleError("bad move");
      if (Number.isInteger(move.play)) return play(state, player, move, deck);
      if (move.draw === true) return draw(state, player, deck);
      if (move.pass === true) return pass(state, player, deck);
      throw new RuleError("bad move");
    },
  };
}
