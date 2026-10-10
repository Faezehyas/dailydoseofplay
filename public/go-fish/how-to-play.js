// Go Fish's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Collect the most **books**: four cards of one rank.",
  players: [
    "Two to four, with a standard 52-card deck.",
    "To play friends, create a room and send the invite link to up to three of them, then press **Start game**.",
    "Against robots, pick 1, 2 or 3 robots and their level: Easy, Medium or Hard.",
  ],
  setup: "With two or three players everyone gets 7 cards; with four, 5 each. The rest of the deck is the pond. Books you were dealt go down before the first ask.",
  turn: [
    "Ask one player for a **rank** you hold at least one of: \"Got any 7s?\" If they have any, they hand over every one of them and you ask again.",
    "If they have none, they say **\"Go fish!\"** and you draw from the pond. If you catch the rank you asked for, you show it and go again; otherwise the turn passes to the next player.",
    "Four cards of one rank make a book, laid face up in front of you as soon as you have it.",
    "If your hand runs out, you draw one card from the pond and carry on; with the pond empty too, you sit out. If nobody else has cards to ask for, you draw one and your turn ends (with **Sit out**, the last player with cards takes the whole pond).",
    "Tap a card to ask for its rank, then tap a player, then **Ask** (or the other way round). Answering, laying books and showing a lucky fish are done for you, truthfully.",
  ],
  winning: "When every book is down (13, or 26 pairs), the most books wins. Players level on books share the win.",
  settings: [
    "Cards dealt: the classic 7 (5 with four players), 5 each or 7 each.",
    "Drawing the rank you asked for: show it and go again, or the turn passes anyway.",
    "Out of cards: draw one, or sit out.",
    "Books: four of a kind, or **pairs** (easier for young players: 26 pairs).",
    "Who goes first: a coin toss, you, or the next player.",
    "Time to ask: when it runs out, an ask is made for you.",
    "**Four colours** shows diamonds blue and clubs green, on this device only.",
    "With friends, the settings of whoever creates the room apply to everyone, except card colours.",
  ],
  fairPlay: "There's no dealer: every browser shuffles the deck in turn and proves it did so honestly, and a card can only be read with every player's key, so nobody can peek at another hand or stack the deck. Cards change hands only face up. (The one gap: with three or more players, a room creator running a tampered browser could read a hand.) When the game ends, everyone reveals their key and each browser replays the whole game with every card known, so a player who asked for a rank they didn't hold, said \"Go fish\" while holding it, kept some back or hid a book or a lucky fish is caught: you see \"Fair play verified\" or what didn't add up.",
  keyboard: "Tab to your hand, use the arrow keys and Enter to pick a card, Tab to the players, and press A or Enter on Ask. Esc clears.",
};
