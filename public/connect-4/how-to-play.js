// Connect 4's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Be the first to line up **four** discs of your colour across, up and down, or on a slant.",
  players: "Two: play a friend, or play the robot (Easy, Medium or Hard).",
  setup: "The board stands upright and starts empty. Coral always moves first.",
  turn: "Pick a column and drop one disc. It slides down to the lowest empty spot in that column.",
  winning: [
    "Four in a row wins, whatever the board size.",
    "If every column fills up first, it's a draw.",
    "**Rematch** starts another round with the same settings. The score counts your wins, draws and losses while you both stay.",
  ],
  settings: [
    "Board: the classic **7 × 6**, or a roomier 8 × 7, 8 × 8, 9 × 7 or 9 × 9.",
    "First move (plays coral): a coin toss drawn by both browsers, you, or your opponent.",
    "Clocks (optional): a limit for each move, and a total for each player's whole game. Whoever runs out of time loses the round.",
    "Robot level: Easy, Medium or Hard.",
    "In a friend game, the settings of whoever creates the room apply to both players.",
  ],
  fairPlay: "Both browsers check every move with the same rules, so a move that breaks them stops the match. Each browser keeps its own player's clock.",
  keyboard: "Move between columns with the arrow keys; press Enter or Space to drop.",
};
