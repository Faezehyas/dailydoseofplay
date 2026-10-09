// Chess sounds: real recordings (CC0, see sounds/LICENSE.txt) of a piece set
// down on a wooden board, and for captures a sharper wooden clack. They play
// through the engine (engine/sound.js), which sets their loudness.
import { defineSounds } from "../engine/sound.js";

const rec = (name) => new URL(`./sounds/${name}.mp3`, import.meta.url).href;

export const sounds = defineSounds({
  move: { role: "action", samples: [1, 2, 3, 4].map((k) => rec(`move-${k}`)) },
  capture: { role: "highlight", samples: [1, 2].map((k) => rec(`capture-${k}`)) },
  // Castling's second knock, the rook: softer and a little higher.
  rook: { role: "action", offset: -3, samples: [1, 2, 3, 4].map((k) => rec(`move-${k}`)), rate: 1.08 },
});

// A piece lands: a capture clacks; castling knocks twice, the king then the rook.
export function playMove(moved) {
  if (moved.captured) sounds.play("capture");
  else if (moved.san.startsWith("O-O")) {
    sounds.play("move");
    sounds.play("rook", {}, 0.12);
  } else sounds.play("move");
}
