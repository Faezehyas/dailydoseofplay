// A card game's robot seat that paces itself like a person: like
// startCardRobot() (engine/card-match.js), but it asks the view how long to
// pause before each move, so
// robots wait while your screen replays, think longer over real choices,
// hardly wait in a hidden tab and wait less with reduced motion. Every pause
// goes through robotPause(), so tests can run a whole game at the deck's speed.
import { matchRouter } from "../session.js";
import { robotPause } from "../robot-pace.js";
import { CardMatch } from "../card-match.js";

// A robot's pause in a view: -1 while busy() (the screen is still replaying),
// a blink in a hidden tab, else think() ms, less with reduced motion.
export function humanPause(busy, think) {
  if (busy()) return -1;
  if (document.hidden) return 40;
  const k = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.4 : 1;
  return think() * k;
}

// delay() returns ms or -1 (wait for the screen); key(state) names a decision; fallback() replaces a refused move.
export function startPacedRobot(session, { rules, choose, delay, key, fallback, rng = Math.random }) {
  const router = matchRouter(session);
  let match = null;
  let timer = null;
  let destroyed = false;
  let waiting = false; // for the screen, rather than thinking
  let planned = null; // the move chosen for this decision, kept while waiting
  let refused = ""; // a decision whose chosen move was refused: play the fallback instead
  const keyOf = () => `${match.m}:${key(match.state)}`;
  function schedule() {
    if (destroyed || timer || !match.canMove()) return;
    const face = (slot) => match.face(slot);
    const k = keyOf();
    if (planned?.key !== k) planned = { key: k, move: refused === k ? fallback(match.state, match.me, face) : choose(match.state, match.me, rng, face) };
    const ms = delay(match.state, match.me, planned.move, face);
    waiting = ms < 0;
    timer = setTimeout(() => {
      timer = null;
      if (destroyed || !match.canMove()) return;
      if (waiting) return schedule();
      const { move } = planned;
      planned = null;
      match.play(move);
    }, robotPause(waiting ? 40 : ms));
  }
  function newMatch(m) {
    match = new CardMatch({ send: (msg) => session.send(msg), me: session.index, players: session.players.length, rules, m });
    match.on("update", schedule);
    match.on("invalid", () => {
      refused = keyOf();
      planned = null;
    });
    router.start(match);
  }
  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    // The screen has caught up: stop waiting for it now rather than at the next check.
    poke() {
      if (!timer || !waiting) return;
      clearTimeout(timer);
      timer = null;
      schedule();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
