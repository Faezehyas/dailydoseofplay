// The result chimes (see celebrate.js): one short melody for the whole site,
// a part of it for each outcome, played in a timbre that fits the game's
// pieces. Synthesized, so there is nothing to download.
import { defineSounds } from "./sound.js";
import { tone, noise, pentatonic } from "./synth.js";

const note = pentatonic(523.25); // C5 up

// The site's jingle, as scale steps: a win rises, a loss falls, a draw stays.
// "over" is for everyone but the winner when more than two play: the win's
// opening, softer, rather than a loss.
export const MELODY = {
  win: [0, 2, 5],
  loss: [3, 1],
  draw: [2, 2],
  over: [0, 2],
};
export const GAP = 0.18; // seconds between notes
// dB from the fanfare role: a loss, a draw and "over" are gentler than a win.
export const OFFSET = { win: 0, loss: -2, draw: -2, over: -4 };

// One note at `f` Hz in each timbre.
export const TIMBRES = {
  wood: (a, o, t, f) => {
    noise(a, o, t, { dur: 0.02, gain: 0.05, freq: 1800, q: 2 });
    tone(a, o, t, { freq: f, dur: 0.4, gain: 0.12 });
    tone(a, o, t, { freq: f * 4, dur: 0.06, gain: 0.03 });
  },
  paper: (a, o, t, f) => {
    noise(a, o, t, { dur: 0.04, gain: 0.04, type: "highpass", freq: 4000 });
    tone(a, o, t, { freq: f, type: "triangle", dur: 0.45, gain: 0.08, attack: 0.01 });
  },
  plastic: (a, o, t, f) => {
    noise(a, o, t, { dur: 0.025, gain: 0.06, freq: 3200, q: 3 });
    tone(a, o, t, { freq: f, type: "triangle", dur: 0.3, gain: 0.09 });
    tone(a, o, t, { freq: f * 2, dur: 0.12, gain: 0.03 });
  },
  bell: (a, o, t, f) => {
    tone(a, o, t, { freq: f, dur: 1.1, gain: 0.08 });
    tone(a, o, t, { freq: f * 2.76, dur: 0.45, gain: 0.025 });
    tone(a, o, t, { freq: f * 5.4, dur: 0.2, gain: 0.012 });
  },
  water: (a, o, t, f) => {
    tone(a, o, t, { freq: f / 2, to: f, dur: 0.08, gain: 0.04 });
    noise(a, o, t, { dur: 0.15, gain: 0.02, type: "lowpass", freq: 900 });
    TIMBRES.bell(a, o, t + 0.04, f);
  },
};

// dB that brings each timbre's chimes to their level, as
// test/browser/sound-levels.test.js measures them.
const TRIM = { wood: 8.1, paper: 12.6, plastic: 12.9, bell: 7.7, water: 7.7 };

// The sound for an outcome in a game's flavour, e.g. "win-wood".
export const chime = (outcome, flavour) => `${outcome}-${flavour}`;

const defs = {};
for (const flavour of Object.keys(TIMBRES)) {
  for (const [outcome, steps] of Object.entries(MELODY)) {
    defs[chime(outcome, flavour)] = {
      role: "fanfare",
      offset: OFFSET[outcome],
      trim: TRIM[flavour],
      synth: (a, o, t) => steps.forEach((s, k) => TIMBRES[flavour](a, o, t + k * GAP, note(s))),
    };
  }
}
export const sounds = defineSounds(defs);
