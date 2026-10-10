// A small card game that exercises every part of CardMatch
// (public/engine/card-match.js); it only exists for tests.
//
// A card's suit is its face % 3. Everyone is dealt `hand` cards; then settle()
// turns the top of the draw pile face up to start the discard pile. On your
// turn, play a card of the top card's suit (the move shows it), or draw.
// You may only draw when nothing in your hand plays; nobody can see that
// during play, so the audit checks it. When the draw pile runs out, the
// discard pile under its top card is shuffled into a new one. The first
// player with an empty hand wins; after maxTurns the fewest cards win
// (the lowest seat on a tie).
import { RuleError } from "../../public/engine/turn-match.js";

export const suit = (face) => face % 3;

export function makeRules({ deckSize = 20, hand = 3, maxTurns = 200 } = {}) {
  return {
    deckSize,

    newState(first, players, deck) {
      const draw = deck.cards.slice();
      const hands = Array.from({ length: players }, () => []);
      for (let r = 0; r < hand; r++) {
        for (let p = 0; p < players; p++) {
          const slot = draw.shift();
          deck.deal(slot, p);
          hands[p].push(slot);
        }
      }
      return { turn: first, winner: -1, players, draw, discard: [], hands, turns: 0, reshuffles: 0, log: [] };
    },

    settle(state, deck) {
      if (state.discard.length || !state.draw.length) return [];
      const top = state.draw.shift();
      deck.open(top);
      state.discard.push(top);
      return [{ type: "flipped" }];
    },

    reveals: (state, player, move) => (Number.isInteger(move?.play) ? [move.play] : []),

    applyMove(state, player, move, deck) {
      if (state.winner !== -1) throw new RuleError("game over");
      if (state.turn !== player) throw new RuleError("not your turn");
      const hand = state.hands[player];
      const top = deck.face(state.discard.at(-1));
      if (Number.isInteger(move?.play)) {
        const i = hand.indexOf(move.play);
        if (i === -1) throw new RuleError("not in your hand");
        const face = deck.face(move.play);
        if (suit(face) !== suit(top)) throw new RuleError("wrong suit");
        hand.splice(i, 1);
        state.discard.push(move.play);
        state.log.push([player, "play", face]);
        if (!hand.length) state.winner = player;
      } else if (move?.draw === true) {
        // Hidden during play (face() is null), checked in the audit.
        if (hand.some((slot) => deck.face(slot) !== null && suit(deck.face(slot)) === suit(top))) throw new RuleError("drew while holding a card that plays");
        if (!state.draw.length && state.discard.length > 1) {
          state.draw = deck.shuffle(state.discard.splice(0, state.discard.length - 1));
          state.reshuffles++;
        }
        if (state.draw.length) {
          const slot = state.draw.shift();
          deck.deal(slot, player);
          hand.push(slot);
          state.log.push([player, "draw"]);
        } else {
          state.log.push([player, "pass"]);
        }
      } else {
        throw new RuleError("bad move");
      }
      state.turns++;
      if (state.winner === -1 && state.turns >= maxTurns) {
        const sizes = state.hands.map((h) => h.length);
        state.winner = sizes.indexOf(Math.min(...sizes));
      }
      if (state.winner === -1) state.turn = (player + 1) % state.players;
      return [{ type: Number.isInteger(move.play) ? "played" : "drew", player }];
    },
  };
}

// Plays a matching card if it has one, else draws. face(slot) is what it knows.
export function chooseMove(state, me, rng, face) {
  const top = suit(face(state.discard.at(-1)));
  const plays = state.hands[me].filter((slot) => suit(face(slot)) === top);
  return plays.length ? { play: plays[Math.floor(rng() * plays.length)] } : { draw: true };
}

// Draws instead of playing whenever it holds a card that plays, so the audit
// has something to catch. cheats() counts the times it did.
export function cheater() {
  let n = 0;
  const choose = (state, me, rng, face) => {
    const move = chooseMove(state, me, rng, face);
    if (move.play === undefined || !(state.draw.length || state.discard.length > 1)) return move;
    n++;
    return { draw: true };
  };
  return { choose, cheats: () => n };
}
