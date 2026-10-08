// How long a robot pauses before it moves. Browser tests set
// globalThis.ddpRobotPace (say 0.1) to speed every robot up; it is read at
// each pause, so a test can change it mid-game. Players get the full pause.
export function robotPause(ms) {
  return ms * (globalThis.ddpRobotPace ?? 1);
}
