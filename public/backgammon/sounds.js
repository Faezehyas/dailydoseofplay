// Backgammon sounds: real recordings (CC0, see sounds/LICENSE.txt) of a
// checker set down on a wooden board, and dice. They play through the engine
// (engine/sound.js), which sets their loudness.
import { defineSounds } from "../engine/sound.js";

const rec = (...names) => names.map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);
const CHECKER = rec("checker-1", "checker-2", "checker-3");

export const sounds = defineSounds({
  dice: { role: "action", samples: rec("dice-1", "dice-2") },
  // A checker set down.
  place: { role: "action", samples: CHECKER },
  // Landing on a blot: heavier and deeper.
  hit: { role: "highlight", samples: CHECKER, rate: 0.88 },
  // A checker going back: to the bar, or undone to where it came from.
  bar: { role: "action", offset: -4, samples: CHECKER, rate: 1.08 },
  // Bearing off: lighter.
  off: { role: "action", offset: -3, samples: CHECKER, rate: 1.2 },
});

export const play = sounds.play;
