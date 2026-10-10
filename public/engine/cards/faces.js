// The standard 52-card deck as card games see it. A face is 0–51:
// suit = Math.floor(face / 13) (spades, hearts, diamonds, clubs) and
// rank = face % 13 (ace, 2 … 10, jack, queen, king). Pure, so rules use it too.
export const DECK = 52;
export const SUIT_SIGNS = ["♠", "♥", "♦", "♣"];
export const SUIT_NAMES = ["Spades", "Hearts", "Diamonds", "Clubs"];
export const RANK_NAMES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const RANK_WORDS = ["Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"];

export const suitOf = (face) => Math.floor(face / 13);
export const rankOf = (face) => face % 13;
// "10♦"
export const cardName = (face) => `${RANK_NAMES[rankOf(face)]}${SUIT_SIGNS[suitOf(face)]}`;
// "Queen of hearts"
export const cardWords = (face) => `${RANK_WORDS[rankOf(face)]} of ${SUIT_NAMES[suitOf(face)].toLowerCase()}`;
