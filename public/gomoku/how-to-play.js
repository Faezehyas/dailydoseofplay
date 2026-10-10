// Gomoku's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Be the first to get five of your stones in an unbroken line across, down or diagonally.",
  players: "Two: play a friend, or play the robot.",
  setup: "The 15 × 15 grid starts empty. The first player's stones are solid; the second player's have a ring.",
  turn: [
    "Place one stone on any empty point. The first stone can go anywhere. Stones never move and are never taken.",
    "Tip: block an open three (three in a row with both ends free) at once, or it becomes an open four that can't be stopped.",
  ],
  winning: [
    "Five in a row wins. Six or more in a row counts too.",
    "If every point fills up and nobody has five, the round is a draw.",
    "**Rematch** starts another round with the same settings. The score counts your wins, draws and losses while you both stay.",
  ],
  settings: [
    "First move: a coin toss drawn by both browsers, you, or your opponent. Moving first is a small edge, so take turns over a few rounds.",
    "Clocks (optional): a limit for each move, and a total for each player's whole game. Whoever runs out of time loses the round.",
    "In a friend game, the settings of whoever creates the room apply to both players.",
  ],
  fairPlay: "Both browsers check every move with the same rules, so a move that breaks them stops the match. Each browser keeps its own player's clock.",
  keyboard: "Tab to the board, move between points with the arrow keys, and press Enter or Space to play.",
};
