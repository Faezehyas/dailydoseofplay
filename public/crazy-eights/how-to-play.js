// Crazy Eights's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Be the first to empty your hand.",
  players: [
    "Two to four, with a standard 52-card deck.",
    "To play friends, create a room and send the invite link to up to three of them, then press **Start game**.",
    "Against robots, pick 1, 2 or 3 robots and their level: Easy, Medium or Hard.",
  ],
  setup: "With two players everyone gets 7 cards; with three or four, 5 each. The next card is turned up to start the discard pile (an 8 goes to the bottom of the stock instead).",
  turn: [
    "Play one card that matches the top card's **suit** or its **rank**. Cards you can play glow: tap one to play it.",
    "8s are wild: play one on anything and name the suit the next player must follow.",
    "If you can't play, tap the stock and draw until you can, then play. When drawing is the only thing you can do, it's done for you.",
    "When the stock runs out, the discard pile (all but its top card) is shuffled into a new one. With nothing left to draw, you pass.",
  ],
  winning: [
    "The first player to empty their hand wins.",
    "With three or four players, the others are ranked by the penalty points left in their hands: 8s 50, kings, queens and jacks 10, aces 1, others their number.",
    "If nobody can move, or a game goes round in circles for very long, the fewest cards win.",
  ],
  settings: [
    "When you can't play: draw until you can, or **Draw one, then pass**: draw a single card, then play or pass.",
    "Drawing: only when you can't play (the default; since nobody can see your hand, that's checked when the game ends), or any time.",
    "Action cards (off by default): a 2 makes the next player take two and miss their turn, a queen skips the next player, and an ace reverses the direction; with two players an ace gives you another turn.",
    "Who goes first: a coin toss, you, or the next player.",
    "Time to move: when it runs out, a move is made for you.",
    "**Four colours** shows diamonds blue and clubs green, on this device only.",
    "With friends, the settings of whoever creates the room apply to everyone, except card colours.",
  ],
  fairPlay: "There's no dealer: every browser shuffles the deck in turn and proves it did so honestly, and a card can only be read with every player's key, so nobody can peek at another hand or stack the deck. (The one gap: with three or more players, a room creator running a tampered browser could read a hand.) When the game ends, everyone reveals their key and each browser replays the whole game with every card known: you see \"Fair play verified\" or what didn't add up.",
  keyboard: "Tab to your hand, use the arrow keys and press Enter to play. D draws and P passes. After an 8, pick a suit with the arrow keys and Enter.",
};
