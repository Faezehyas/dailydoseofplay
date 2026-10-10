// Dots and Boxes's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Claim more boxes than your opponent.",
  players: "Two: play a friend, or play the robot (Easy, Medium or Hard).",
  setup: "The board starts as a grid of dots, with no lines drawn.",
  turn: [
    "Draw one line between two dots that sit side by side, across or down. Diagonals don't count. Tap or click a gap to draw there; on a computer, hovering shows the line first.",
    "Draw the fourth side of a box and it's yours: it fills with your colour and your initial. Closing a box (or two at once) means you draw again straight away, so one turn can sweep up a whole row.",
    "The trap: drawing a box's third side hands it to your opponent, and often the boxes behind it too. Draw safe lines for as long as you can.",
    "Near the end, when every line gives something away, it can pay to leave the last two boxes of a long chain: your opponent takes them but then has to open the next chain for you.",
  ],
  winning: "When every box is taken, whoever has the most wins. An even split is a draw.",
  settings: [
    "Board: 3 × 3 up to 6 × 6 boxes.",
    "Clocks (optional): a time per line, and a total for each player.",
    "First line: a coin toss drawn by both browsers, you, or your opponent.",
    "Robot level: Easy, Medium or Hard.",
    "In a friend game, the settings of whoever creates the room apply to both players.",
  ],
  fairPlay: "Both browsers check every line with the same rules, and the coin toss for who starts is drawn by both together.",
  keyboard: "Tab to the board, move with the arrow keys and press Enter or Space to draw.",
};
