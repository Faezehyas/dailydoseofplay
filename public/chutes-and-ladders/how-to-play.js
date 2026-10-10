// Chutes and Ladders's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Be the first to get your pawn to square 100.",
  players: [
    "Two to four, each with a pawn.",
    "To play friends, create a room and send the invite link to up to three of them. Press **Start game** when everyone is in; a full room of four starts by itself.",
    "Against the robot, pick 1, 2 or 3 robots in the settings.",
  ],
  setup: "Every pawn starts on the lawn below square 1. The track runs along the rows: left to right, up a row, right to left, and so on up to 100 at the top left.",
  turn: [
    "Press **Spin** or tap the spinner, and hop forward that many squares.",
    "Stop at the foot of a ladder and you climb straight up to its top. Stop at the top of a chute and you slide all the way down it. Only the square you stop on counts, not the ones you hop over.",
    "Pawns can share a square; nobody gets bumped.",
  ],
  winning: "The first to reach square 100 wins. In the classic game you need the exact number: if your spin would take you past 100, you stay where you are.",
  settings: [
    "Reaching 100: the classic exact spin, **Bounce back** (walk back from 100 by the steps left over), or **Any spin** (any spin that reaches 100 wins).",
    "Spin a 6: your turn ends, or you spin again.",
    "First spin: a coin toss, you, or the next player.",
    "Your spinner: tap to spin, or pick **Spins by itself** to sit back and watch. Each player picks their own.",
    "Play vs robot: 1, 2 or 3 robots.",
    "With friends, the settings of whoever creates the room apply to everyone, except the spinner.",
  ],
  fairPlay: "Every spin is drawn by all the players' browsers together, so nobody can choose or predict it, and every browser checks every move with the same rules.",
  keyboard: "Tab to the Spin button and press Enter or Space.",
};
