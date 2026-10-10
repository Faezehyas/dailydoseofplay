// Gin Rummy's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Sort your hand into melds and go out with as little deadwood as you can. The first to 100 points wins the game.",
  players: "Two: play a friend, or play the robot (Easy, Medium or Hard).",
  setup: [
    "A standard 52-card deck. The dealer gives ten cards each, turns the next card up to start the discard pile, and the rest is the stock. The deal alternates every hand.",
    "**Melds** are sets (three or four of a rank) and runs (three or more in a row in one suit). Aces are low: A-2-3 is a run, Q-K-A is not. Every card that isn't in a meld is **deadwood**: court cards count 10, aces 1, the rest their number. Your hand groups itself into its best melds, and your deadwood is counted beside it.",
  ],
  turn: [
    "The first card turned up: the non-dealer may take it or pass, then the dealer. If both pass, the non-dealer draws from the stock.",
    "Draw the top card of the stock or of the discard pile, then discard one card. You can't throw back the card you just took from the pile.",
    "With 10 points of deadwood or less after drawing, you may **knock**: you discard and lay your hand down as melds and deadwood. With no deadwood at all, it's **gin**.",
    "The other player then lays down their melds and, unless it was gin, lays off deadwood onto the knocker's melds. Your browser does both for you, the best way.",
    "Tap the stock or the pile to draw. Tap a card to pick it and again to discard it, or press **Knock** (it says **Gin** when it is). Drag a card to rearrange your hand, or sort it by suit or rank.",
  ],
  winning: [
    "A knock scores the difference in deadwood. If the defender's deadwood is equal or lower, it's an **undercut**: they score the difference plus 25.",
    "Gin scores 25 plus the other player's deadwood.",
    "If only two cards are left in the stock and nobody has knocked, the hand is a draw.",
    "A game goes to 100 points. The winner then gets 100 for the game, and each player 25 for every hand they won.",
  ],
  settings: [
    "Game: to 100, or a single hand a game (the scores add up across rematches).",
    "Knocking: 10 or less, or **Oklahoma**, where the first upcard's points set the knock limit.",
    "**Big Gin**: going out with all eleven cards scores 31 plus the other player's deadwood.",
    "Who deals first: a coin toss, you, or the other player.",
    "Time per move: when it runs out, a sensible move is made for you.",
    "Robot level: Easy, Medium or Hard.",
    "**Four colours** shows diamonds blue and clubs green, on this device only.",
    "In a friend game, the settings of whoever creates the room apply to both players, except card colours.",
  ],
  fairPlay: "There's no dealer: both browsers shuffle the deck in turn, before every hand, and prove they did so honestly, and a card can only be read with both players' keys, so nobody can peek at the other hand or stack the deck. A knock shows the whole hand, so every meld and score is checked as it happens. When the game ends, both keys are revealed and each browser replays the whole game with every card known: you see \"Fair play verified\" or what didn't add up.",
  keyboard: "D draws from the stock, T takes the pile, P passes, K knocks and N starts the next hand. In your hand, the arrow keys move and Enter picks; Shift with an arrow moves a card.",
};
