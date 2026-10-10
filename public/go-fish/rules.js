// Go Fish rules for CardMatch (engine/card-match.js): two to four players, a
// 52-card deck, books of four (or pairs). Each step of a turn is a move by
// whoever makes it, in phases open, ask, answer and drawn; rules that need a
// hidden face only throw, in the audit. See "Go Fish in depth" in ARCHITECTURE.md.
import { RuleError } from "../engine/turn-match.js";
import { DECK, rankOf, RANK_NAMES } from "../engine/cards/faces.js";

export { rankOf };
export const MAX_PLAYERS = 4;
export const RANKS = 13;

export const HANDS = ["classic", 5, 7];
export const LUCKY = ["again", "pass"];
export const EMPTY = ["draw", "out"];
export const BOOKS = [4, 2];
export const FIRST = ["random", "host", "guest"];
export const MOVE_SECONDS = [0, 15, 30, 60];
export const LEVELS = ["easy", "medium", "hard"];
export const ROBOTS = [1, 2, 3];
// level, robots and fourColor are per device; the rules ignore them.
export const DEFAULT_CONFIG = {
  hand: "classic",
  lucky: "again",
  empty: "draw",
  books: 4,
  first: "random",
  moveSeconds: 0,
  level: "easy",
  robots: 3,
  fourColor: false,
};

export function normalizeConfig(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  return {
    hand: pick(c.hand, HANDS, DEFAULT_CONFIG.hand),
    lucky: pick(c.lucky, LUCKY, DEFAULT_CONFIG.lucky),
    empty: pick(c.empty, EMPTY, DEFAULT_CONFIG.empty),
    books: pick(c.books, BOOKS, DEFAULT_CONFIG.books),
    first: pick(c.first, FIRST, DEFAULT_CONFIG.first),
    moveSeconds: pick(c.moveSeconds, MOVE_SECONDS, DEFAULT_CONFIG.moveSeconds),
    level: pick(c.level, LEVELS, DEFAULT_CONFIG.level),
    robots: pick(c.robots, ROBOTS, DEFAULT_CONFIG.robots),
    fourColor: pick(c.fourColor, [true, false], DEFAULT_CONFIG.fourColor),
  };
}

export const handSize = (players, hand = "classic") => (hand === "classic" ? (players === 4 ? 5 : 7) : hand);
// "7s", "Aces", "Kings": what you ask for.
const PLURAL = ["Aces", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "Jacks", "Queens", "Kings"];
export const rankWords = (r) => PLURAL[r];
export const rankName = (r) => RANK_NAMES[r];
// The ranks a hand holds, by what face() knows.
export const ranksIn = (slots, face) => [...new Set(slots.map(face).filter((f) => f !== null).map(rankOf))].sort((a, b) => a - b);
export const totalBooks = (state) => DECK / state.bookSize;
export const booksDown = (state) => state.books.reduce((n, b) => n + b.length, 0);
// Players other than p who hold cards: the ones p may ask.
export const askable = (state, p) => state.hands.flatMap((h, q) => (q !== p && h.length ? [q] : []));

// The honest move nobody chooses (an answer, book, lucky fish or end of turn); null for an ask.
export function forcedMove(state, me, face) {
  if (state.winner !== -1 || state.turn !== me) return null;
  const hand = state.hands[me];
  if (state.phase === "answer") {
    const give = hand.filter((slot) => face(slot) !== null && rankOf(face(slot)) === state.ask.rank);
    return give.length ? { give } : { fish: true };
  }
  if (state.phase === "drawn" && state.lucky === "again" && state.drawn !== null && state.ask && face(state.drawn) !== null && rankOf(face(state.drawn)) === state.ask.rank) return { show: state.drawn };
  const book = bookIn(hand, face, state.bookSize);
  if (book) return { book };
  if (state.phase === "open" || state.phase === "drawn") return { done: true };
  return null;
}

// A full book among `slots` (the first rank that has one), or null.
export function bookIn(slots, face, size) {
  const by = new Map();
  for (const slot of slots) {
    const f = face(slot);
    if (f === null) continue;
    const r = rankOf(f);
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(slot);
    if (by.get(r).length === size) return by.get(r);
  }
  return null;
}

export function makeRules(config = DEFAULT_CONFIG) {
  const c = normalizeConfig(config);
  const size = c.books;

  const isSlots = (v) => Array.isArray(v) && v.length > 0 && v.every(Number.isInteger) && new Set(v).size === v.length;

  // Audit-only checks: a hidden face is null during play, so these bite only when every face is known.
  function mustHold(state, p, rank, deck) {
    const faces = state.hands[p].map((slot) => deck.face(slot));
    if (faces.every((f) => f !== null) && !faces.some((f) => rankOf(f) === rank)) throw new RuleError(`asked for ${rankWords(rank)} without holding one`);
  }
  function mustLack(state, p, rank, deck, what) {
    if (state.hands[p].some((slot) => deck.face(slot) !== null && rankOf(deck.face(slot)) === rank)) throw new RuleError(`${what} while holding ${rankWords(rank)}`);
  }
  function noBooks(state, p, deck) {
    const book = bookIn(state.hands[p], (slot) => deck.face(slot), size);
    if (book) throw new RuleError(`kept a ${size === 2 ? "pair" : "book"} of ${rankWords(rankOf(deck.face(book[0])))} in hand`);
  }

  const log = (state, entry) => state.log.push(entry);

  // Deals the stock's top card to p; its slot.
  function draw(state, deck, p, why) {
    const slot = state.stock.shift();
    deck.deal(slot, p);
    state.hands[p].push(slot);
    log(state, { t: "draw", p, why });
    return slot;
  }

  function finish(state, events) {
    const counts = state.books.map((b) => b.length);
    const best = Math.max(...counts);
    state.winners = counts.flatMap((n, p) => (n === best ? [p] : []));
    state.winner = state.winners[0];
    state.phase = "over";
    state.ask = null;
    state.drawn = null;
    events.push({ type: "over", winners: state.winners });
  }

  // Can p take a turn: cards in hand, or an empty hand that may draw.
  const canPlay = (state, p) => state.hands[p].length > 0 || (c.empty === "draw" && state.stock.length > 0);

  // p is to ask, now or again; empty hands and nobody to ask: see ARCHITECTURE.md.
  function enterAsk(state, deck, p, events) {
    markOut(state, events);
    state.turn = p;
    state.ask = null;
    state.drawn = null;
    let drew = false;
    if (!state.hands[p].length) {
      if (c.empty === "draw" && state.stock.length) {
        events.push({ type: "draw", p, slot: draw(state, deck, p, "empty"), why: "empty" });
        drew = true;
      } else return passTurn(state, deck, p, events);
    }
    if (askable(state, p).length) {
      state.phase = "ask";
      return;
    }
    if (state.stock.length && c.empty === "out") {
      const slots = [];
      while (state.stock.length) slots.push(draw(state, deck, p, "take"));
      events.push({ type: "take", p, slots });
      state.phase = "ask";
    } else if (state.stock.length) {
      if (!drew) events.push({ type: "draw", p, slot: draw(state, deck, p, "alone"), why: "alone" });
      state.phase = "drawn";
    } else state.phase = "ask"; // everything left is in p's hand: books only
  }

  // Announces, once, each player with no cards who can't draw: out for the rest of the game.
  function markOut(state, events) {
    for (let p = 0; p < state.players; p++) {
      if (state.out[p] || canPlay(state, p)) continue;
      state.out[p] = true;
      log(state, { t: "out", p });
      events.push({ type: "out", p });
    }
  }

  // The turn goes to the next player after `from` who can play.
  function passTurn(state, deck, from, events) {
    state.turns++;
    for (let i = 1; i <= state.players; i++) {
      const p = (from + i) % state.players;
      if (canPlay(state, p)) return enterAsk(state, deck, p, events);
    }
    finish(state, events);
  }

  function book(state, player, move, deck, events) {
    if (!isSlots(move.book) || move.book.length !== size) throw new RuleError(`a ${size === 2 ? "pair" : "book"} is ${size} cards of one rank`);
    const hand = state.hands[player];
    if (!move.book.every((slot) => hand.includes(slot))) throw new RuleError("those cards aren't all in your hand");
    const faces = move.book.map((slot) => deck.face(slot));
    if (faces.some((f) => f === null)) throw new RuleError("that book wasn't shown");
    const rank = rankOf(faces[0]);
    if (faces.some((f) => rankOf(f) !== rank)) throw new RuleError(`a ${size === 2 ? "pair" : "book"} is ${size} cards of one rank`);
    state.hands[player] = hand.filter((slot) => !move.book.includes(slot));
    state.books[player].push({ rank, slots: move.book.slice() });
    // The card drawn after a "Go fish", laid in a book of the rank asked for, is a lucky fish shown.
    const lucky = state.phase === "drawn" && state.drawn !== null && move.book.includes(state.drawn) && state.ask && rank === state.ask.rank && c.lucky === "again";
    if (lucky) log(state, { t: "lucky", p: player, rank });
    log(state, { t: "book", p: player, rank });
    events.push({ type: "book", p: player, rank, slots: move.book.slice() });
    if (booksDown(state) === totalBooks(state)) return finish(state, events);
    if (lucky) {
      events.push({ type: "lucky", p: player, slot: state.drawn, rank });
      return enterAsk(state, deck, player, events);
    }
    if (state.phase === "ask" && !state.hands[player].length) enterAsk(state, deck, player, events);
  }

  function done(state, player, deck, events) {
    noBooks(state, player, deck);
    if (state.phase === "open") {
      events.push({ type: "ready", p: player });
      state.opened++;
      if (state.opened < state.players) {
        state.turn = (state.turn + 1) % state.players;
        return;
      }
      return enterAsk(state, deck, state.first, events);
    }
    if (c.lucky === "again" && state.drawn !== null && state.ask && deck.face(state.drawn) !== null && rankOf(deck.face(state.drawn)) === state.ask.rank) throw new RuleError(`didn't show a lucky ${rankName(state.ask.rank)}`);
    events.push({ type: "pass", p: player });
    passTurn(state, deck, player, events);
  }

  function ask(state, player, move, deck, events) {
    const rank = move.ask;
    const from = move.from;
    if (!(Number.isInteger(rank) && rank >= 0 && rank < RANKS)) throw new RuleError("ask for a rank");
    if (!askable(state, player).includes(from)) throw new RuleError("ask a player who has cards");
    noBooks(state, player, deck);
    mustHold(state, player, rank, deck);
    state.ask = { from: player, to: from, rank };
    state.phase = "answer";
    state.turn = from;
    log(state, { t: "ask", p: player, to: from, rank });
    events.push({ type: "ask", p: player, to: from, rank });
  }

  function give(state, player, move, deck, events) {
    const { from: asker, rank } = state.ask;
    if (!isSlots(move.give)) throw new RuleError("hand over the cards asked for");
    const hand = state.hands[player];
    if (!move.give.every((slot) => hand.includes(slot))) throw new RuleError("those cards aren't in your hand");
    if (move.give.some((slot) => deck.face(slot) === null || rankOf(deck.face(slot)) !== rank)) throw new RuleError(`hand over only ${rankWords(rank)}`);
    const rest = hand.filter((slot) => !move.give.includes(slot));
    if (rest.some((slot) => deck.face(slot) !== null && rankOf(deck.face(slot)) === rank)) throw new RuleError(`handed over only some ${rankWords(rank)}`);
    state.hands[player] = rest;
    for (const slot of move.give) {
      deck.deal(slot, asker);
      state.hands[asker].push(slot);
    }
    log(state, { t: "give", p: player, to: asker, rank, n: move.give.length });
    events.push({ type: "give", p: player, to: asker, rank, slots: move.give.slice() });
    enterAsk(state, deck, asker, events);
  }

  function fish(state, player, deck, events) {
    const { from: asker, rank } = state.ask;
    mustLack(state, player, rank, deck, 'said "Go fish"');
    log(state, { t: "fish", p: player, to: asker, rank });
    events.push({ type: "fish", p: player, to: asker, rank });
    if (!state.stock.length) {
      state.ask = null;
      return passTurn(state, deck, asker, events);
    }
    state.turn = asker;
    state.phase = "drawn";
    state.drawn = draw(state, deck, asker, "fish");
    events.push({ type: "draw", p: asker, slot: state.drawn, why: "fish" });
  }

  function show(state, player, move, deck, events) {
    if (c.lucky !== "again") throw new RuleError("a lucky fish doesn't go again in this game");
    if (move.show !== state.drawn || state.drawn === null) throw new RuleError("show the card you drew");
    const face = deck.face(move.show);
    if (face === null || rankOf(face) !== state.ask.rank) throw new RuleError(`that isn't ${rankWords(state.ask.rank)}`);
    log(state, { t: "lucky", p: player, rank: state.ask.rank });
    events.push({ type: "lucky", p: player, slot: move.show, rank: state.ask.rank });
    enterAsk(state, deck, player, events);
  }

  return {
    deckSize: DECK,

    newState(first, players, deck) {
      const turn = c.first === "host" ? 0 : c.first === "guest" ? 1 : first;
      const stock = deck.cards.slice();
      const hands = Array.from({ length: players }, () => []);
      for (let r = 0; r < handSize(players, c.hand); r++) {
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
        winners: [],
        first: turn,
        players,
        bookSize: size,
        lucky: c.lucky,
        phase: "open",
        opened: 0, // players who have laid their dealt books
        stock,
        hands,
        books: Array.from({ length: players }, () => []), // { rank, slots } in the order laid
        out: Array(players).fill(false), // sat out: no cards and nothing to draw
        ask: null, // { from, to, rank } while an ask is being answered, and after a "Go fish"
        drawn: null, // the card drawn after a "Go fish", until the turn ends
        moves: 0,
        turns: 0,
        log: [], // public: every ask, answer, draw, book and lucky fish, for the robots and the view
      };
    },

    reveals(state, player, move) {
      if (Array.isArray(move?.book)) return move.book;
      if (Array.isArray(move?.give)) return move.give;
      if (Number.isInteger(move?.show)) return [move.show];
      return [];
    },

    applyMove(state, player, move, deck) {
      if (state.winner !== -1) throw new RuleError("the game is over");
      if (state.turn !== player) throw new RuleError("not your turn");
      if (!move || typeof move !== "object") throw new RuleError("bad move");
      const events = [];
      const ph = state.phase;
      if (move.book !== undefined && (ph === "open" || ph === "ask" || ph === "drawn")) book(state, player, move, deck, events);
      else if (move.done === true && (ph === "open" || ph === "drawn")) done(state, player, deck, events);
      else if (move.ask !== undefined && ph === "ask") ask(state, player, move, deck, events);
      else if (move.give !== undefined && ph === "answer") give(state, player, move, deck, events);
      else if (move.fish === true && ph === "answer") fish(state, player, deck, events);
      else if (move.show !== undefined && ph === "drawn") show(state, player, move, deck, events);
      else throw new RuleError(`that move doesn't fit now (${ph})`);
      if (state.winner === -1) markOut(state, events);
      state.moves++;
      return events;
    },
  };
}
