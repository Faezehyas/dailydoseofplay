// Tic Tac Toe's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Be the first to line up your marks across, down or corner to corner.",
  players: "Two: play a friend, or play the robot.",
  setup: "The grid starts empty. One player is X, the other O, and X always moves first.",
  turn: "Mark one empty square.",
  winning: [
    "On the **3 × 3** board three in a row wins; on **5 × 5** you need four.",
    "A full board with no line is a draw.",
    "**Rematch** starts another round with the same settings. The score counts your wins, draws and losses while you both stay.",
  ],
  settings: [
    "Board: 3 × 3 or 5 × 5.",
    "First move: a coin toss drawn by both browsers, you, or your opponent.",
    "Clocks (optional): a limit for each move, and a total for each player's whole game. Whoever runs out of time loses the round.",
    "In a friend game, the settings of whoever creates the room apply to both players.",
  ],
  fairPlay: "Both browsers check every move with the same rules, so a move that breaks them stops the match. Each browser keeps its own player's clock.",
  keyboard: "Move between squares with the arrow keys; press Enter or Space to play.",
};
