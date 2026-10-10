// Sea Battle's "How to play", in the sections every game uses (see engine/how-to-play.js).
export const howToPlay = {
  goal: "Sink your opponent's whole fleet before they sink yours.",
  players: "Two: play a friend, or play the robot.",
  setup: [
    "Each player hides a fleet of 5 ships (sizes 5, 4, 3, 3 and 2) on their own 10 × 10 grid. Ships can't touch side by side; touching at the corners is fine.",
    "Your ships start in random places. Press **Shuffle** for a new layout, drag a ship to move it, or tap a ship to rotate it. Then press **Ready**.",
  ],
  turn: [
    "Fire at a square of the enemy waters. Fire marks a hit, a splash marks a miss.",
    "A hit lets you fire again; a miss, or a hit that sinks a ship, passes the turn.",
    "A ship hit on every square sinks and is revealed, and the water beside it is marked as clear.",
    "Every few moves a mystery gift (?) pops up in the enemy waters. Your opponent gets one in yours, which you don't see. Aim at a gift's own square to win the weapon inside; a blast or rain that hits it from another square destroys it. A gift on water cleared beside a sunk ship disappears.",
    "Weapons: **Big missile** (a 5-square plus), **Missile rain** (7 random squares; select it, then press Launch rain), **Nuclear missile** (a 14-square blast) and **Carpet bomb** (a whole row or column; press R or the Row/Column button to switch).",
  ],
  winning: "Sink every enemy ship to win.",
  settings: [
    "Time per shot: if it runs out, a random shot is fired for you.",
    "Time for each player: if your clock runs out, you lose.",
    "In a friend game, the settings of whoever creates the room apply to both players. Against the robot, only your clock runs.",
  ],
  fairPlay: "Your fleet never leaves your browser until the game ends. Both sides lock in their fleet with a cryptographic commitment and check each other's answers afterwards. Every random event (who starts, gifts, missile rain) is drawn jointly by both browsers.",
  keyboard: [
    "While placing, Tab to a ship: the arrow keys move it and R rotates it. While dragging a ship, R rotates it too.",
    "With the carpet bomb selected, R switches between a row and a column.",
  ],
};
