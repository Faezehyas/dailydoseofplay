// Checkers sounds, synthesized: a wooden clack when a piece lands, a knock
// for each piece taken, and a short chime for a new king. They play through
// the engine (engine/sound.js), which sets their loudness.
import { defineSounds } from "../engine/sound.js";
import { tone, noise } from "../engine/synth.js";

// Wood on wood: a bright click from filtered noise, plus a short low body.
function knock(a, o, t, { click = 1800, body = 220, gain = 0.35 } = {}) {
  noise(a, o, t, { dur: 0.045, gain, freq: click, q: 4, attack: 0.0005 });
  tone(a, o, t, { freq: body, to: body * 0.7, dur: 0.09, gain: gain * 0.6, attack: 0.0005 });
}

function chime(a, o, t, freq) {
  tone(a, o, t, { freq, type: "triangle", dur: 0.25, gain: 0.16, attack: 0.0005 });
}

export const sounds = defineSounds({
  // A piece lands; hop `k` of a multi-jump clicks a little higher.
  land: { role: "action", trim: 5.5, synth: (a, o, t, { pitch = 1, k = 0 } = {}) => knock(a, o, t, { click: 1800 * pitch * (1 + k * 0.06), body: 220 * pitch }) },
  // A piece taken: a lower knock just after the landing.
  take: { role: "action", offset: -4, trim: 10.6, synth: (a, o, t, { pitch = 1 } = {}) => knock(a, o, t, { click: 900 * pitch, body: 140 * pitch, gain: 0.2 }) },
  // A new king: a bright knock and two chimes.
  crown: {
    role: "highlight",
    trim: 5,
    synth: (a, o, t, { pitch = 1 } = {}) => {
      knock(a, o, t, { click: 2600 * pitch, body: 320 * pitch, gain: 0.25 });
      chime(a, o, t + 0.06, 784);
      chime(a, o, t + 0.14, 1175);
    },
  },
});

const HOP_GAP = 0.11; // seconds between the hops of a multi-jump

// `moved` is the rules' "moved" event. The opponent's pieces sound a little lower.
export function playMove({ captured, crowned }, mine) {
  const pitch = (mine ? 1 : 0.88) * (0.96 + Math.random() * 0.08);
  const hops = captured.length || 1;
  for (let k = 0; k < hops; k++) {
    sounds.play("land", { pitch, k }, k * HOP_GAP);
    if (captured.length) sounds.play("take", { pitch }, k * HOP_GAP + 0.045);
  }
  if (crowned) sounds.play("crown", { pitch }, hops * HOP_GAP);
}
