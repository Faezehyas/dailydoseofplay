// Ludo's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Be the first to bring all four of your tokens home to the centre.",
  players: [
    "Two to four.",
    "To play friends, create a room and send the invite link to up to three of them. Press **Start game** when everyone is in; a full room of four starts by itself.",
    "Against robots, pick 1, 2 or 3 robots and their level: Easy, Medium or Hard.",
  ],
  setup: "Each player has four tokens of one colour, waiting in their yard. Your yard is always the one at the bottom left of your screen. Every colour has its own mark too (circle, triangle, square, diamond), shown on its tokens.",
  turn: [
    "Tap the die or press **Roll**, then move a token that many squares clockwise round the board: tap a glowing token or the spot where it would land. Your token's path ends in your own coloured column, leading to the centre.",
    "You need a 6 to bring a token out of the yard onto your start square. A 6 also earns another roll.",
    "Stop on a square with a rival's token and you send it back to its yard. Start squares and star squares are safe: tokens of any colour can share them.",
    "You need the exact number to reach the centre. If no token can move, the turn passes by itself; if only one move is possible, it's played for you.",
  ],
  winning: "The first to bring all four tokens home wins. With three or four players the others play on for second and third place, unless the room picked **Game ends**.",
  settings: [
    "House rules: three 6s in a row can lose your turn (on by default), two tokens of one colour on a square can **block the way** so no rival can pass or land there, and a capture can earn another roll.",
    "When someone finishes: play on for places, or the game ends.",
    "First roll: a coin toss, you, or the next player.",
    "Time to move: when it runs out, a move is made for you.",
    "Play vs robot: 1, 2 or 3 robots, Easy, Medium or Hard.",
    "With friends, the settings of whoever creates the room apply to everyone.",
  ],
  fairPlay: "Every roll is drawn by all the players' browsers together, so nobody can choose or predict it, and every browser checks every move with the same rules.",
  keyboard: "Tab to the Roll button and press Enter. Then Tab or the arrow keys pick a token, and Enter or Space moves it. Keys 1 to 4 pick your tokens too.",
};
