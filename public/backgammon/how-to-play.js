// Backgammon's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Be the first to bear off all fifteen of your checkers.",
  players: "Two: play a friend, or play the robot (Easy, Medium or Hard).",
  setup: "You each have fifteen checkers on a track of twenty-four points. You race them the opposite way to your opponent's, into your home board at the bottom right, then off the board. There is no doubling cube.",
  turn: [
    "Your dice roll by themselves when your turn starts. Move one checker by each die, or one checker by both. A double lets you move that number four times.",
    "You may not land on a point where your opponent has two or more checkers. Land on a point with just one, and that checker goes to the bar in the middle.",
    "With a checker on the bar, bring it back in first, into your opponent's home board at the top right, before you move anything else.",
    "Play both dice if you can. If only one can be played, play the bigger one. With no legal move at all, your turn passes by itself.",
    "When all fifteen of your checkers are in your home board, start bearing them off: a 4 takes one off your 4 point, and a die bigger than your farthest checker bears that one off.",
    "Tap a checker, then the point it should go to, or drag it there. A dashed circle shows where it would land. **Undo** takes a step back; **Confirm** ends your turn. The number by each name is that player's pip count: how far they still have to go.",
    "When there's only one way to play your roll, the game plays it for you and ends your turn. If only part of it is forced, say bringing a checker in from the bar, the game plays that part and leaves the rest to you.",
    "After your opponent moves, a ring marks each checker that just arrived, and a faint outline shows where it left from.",
    "Once nobody can be hit any more, it's a pure race home, and the game offers to move your checkers for you. Say no if you'd rather move yourself; the button under the board turns it on or off at any time. Against the robot, it then keeps the same quick pace, and in a race it always plays its best.",
  ],
  winning: [
    "The first to bear off all fifteen checkers wins.",
    "Whoever runs out of time loses.",
  ],
  settings: [
    "A time limit for each turn, and a clock for each player's whole game.",
    "First move: a coin toss drawn by both browsers, you, or your opponent.",
    "Robot level: Easy, Medium or Hard.",
    "In a friend game, the settings of whoever creates the room apply to both players.",
  ],
  fairPlay: "Both browsers check every move with the same rules, and the dice are drawn by both browsers together, so neither can load them.",
  keyboard: "Move around the board with the arrow keys and press Enter or Space to pick a checker or a point. Escape lets go of a checker.",
};
