// Checkers's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Take all of your opponent's pieces, or leave them none that can move.",
  players: "Two: play a friend, or play the robot (Easy, Medium or Hard).",
  setup: "Each player starts with 12 pieces on the dark squares of an 8 × 8 board, in the three rows nearest to them. Pieces only ever stand on dark squares.",
  turn: [
    "Move one piece diagonally forward to a free square next to it.",
    "Capture by hopping over an opponent's piece next to yours onto the free square just behind it. If you can capture, you must. If, after a hop, the same piece can hop again, it must keep going in the same turn. When several captures are possible, you choose which.",
    "A piece that reaches the far row becomes a king (it gets a crown), and its turn ends there. Kings move and capture diagonally backwards as well as forwards, one square at a time.",
    "Tap one of your pieces, then the square to land on. For a multi-hop, tap each landing square in turn, or just the last one. Pieces that can move are marked when it's your turn.",
    "Sounds: a wooden clack when a piece lands, a knock for each piece captured, and a chime for a new king. The speaker button at the top mutes them on this device.",
  ],
  winning: [
    "You win when your opponent has no pieces left, or none that can move.",
    "After 40 turns in a row with no capture and no new king, the game is a draw.",
    "**Rematch** starts another round with the same settings. The score counts your wins, draws and losses while you both stay.",
  ],
  settings: [
    "First move: a coin toss drawn by both browsers, you, or your opponent.",
    "Clocks (optional): a limit for each move, and a total for each player's whole game. Whoever runs out of time loses the round.",
    "Robot level: Easy, Medium or Hard.",
    "In a friend game, the settings of whoever creates the room apply to both players.",
  ],
  fairPlay: "Both browsers check every move with the same rules, so a move that breaks them stops the match. Each browser keeps its own player's clock.",
  keyboard: "Move between dark squares with the arrow keys, press Enter or Space to pick a piece or a square, and Escape to put the piece back.",
};
