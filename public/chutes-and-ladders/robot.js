// Chutes and Ladders has no choices: the robot spins when it is its turn.
// The view's pacing (spinner, hops, ladders and chutes) sets the rhythm.
export function chooseMove() {
  return { type: "spin" };
}
