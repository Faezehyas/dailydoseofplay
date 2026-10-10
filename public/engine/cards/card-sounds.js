// Sounds every card game lists in its defineSounds() (see "Sound levels" in
// ARCHITECTURE.md). cardSounds, the handling, is recorded (CC0, see
// sounds/LICENSE.txt), each with a synthesized stand-in until it loads: a
// riffle, a deal flick, a card played, a card drawn, cards gathered.
// tableSounds are synthesized: your turn, a refusal, the timer's tick.
import { tone, noise, pentatonic } from "../synth.js";

// C major pentatonic from C4.
export const note = pentatonic(261.63);

// A struck bell: a note with two quieter partials.
export function bell(a, o, t, freq, gain = 0.06, dur = 0.8) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.3 });
  tone(a, o, t, { freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.12 });
}

// A card flicked across felt: a short burst of filtered noise.
function flick(a, o, t, { gain = 0.2, freq = 2600, dur = 0.06 } = {}) {
  noise(a, o, t, { dur, gain, freq, to: freq * 0.6, q: 0.9 });
}

const SYNTH = {
  shuffle: (a, o, t) => {
    for (let i = 0; i < 22; i++) flick(a, o, t + i * 0.035 + Math.random() * 0.01, { gain: 0.12 + Math.random() * 0.06, freq: 2200 + Math.random() * 1400, dur: 0.03 });
    flick(a, o, t + 0.85, { gain: 0.2, freq: 1400, dur: 0.12 });
  },
  deal: (a, o, t) => flick(a, o, t, { gain: 0.18, freq: 3000, dur: 0.05 }),
  play: (a, o, t) => {
    flick(a, o, t, { gain: 0.16, freq: 1800, dur: 0.04 });
    noise(a, o, t + 0.035, { dur: 0.03, gain: 0.3, freq: 1200, q: 1.4 });
    tone(a, o, t + 0.035, { freq: 190, to: 120, dur: 0.05, gain: 0.08 });
  },
  draw: (a, o, t) => noise(a, o, t, { dur: 0.32, gain: 0.12, freq: 1500, to: 3200, q: 0.7, attack: 0.06 }),
  gather: (a, o, t) => {
    for (let i = 0; i < 12; i++) flick(a, o, t + i * 0.04, { gain: 0.1, freq: 1800 + i * 90, dur: 0.04 });
  },
};

const rec = (...names) => names.map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);

export const tableSounds = {
  nope: {
    role: "ui",
    trim: 5.5,
    synth: (a, o, t) => {
      tone(a, o, t, { freq: 220, dur: 0.09, gain: 0.08, type: "square" });
      tone(a, o, t + 0.1, { freq: 196, dur: 0.12, gain: 0.08, type: "square" });
    },
  },
  turn: {
    role: "ui",
    trim: 5.1,
    synth: (a, o, t) => {
      tone(a, o, t, { freq: note(12), dur: 0.16, gain: 0.05 });
      tone(a, o, t + 0.1, { freq: note(15), dur: 0.22, gain: 0.05 });
    },
  },
  tick: {
    role: "cue",
    trim: 5.2,
    synth: (a, o, t) => {
      noise(a, o, t, { dur: 0.014, gain: 0.12, type: "highpass", freq: 3000 });
      tone(a, o, t, { freq: 1500, dur: 0.02, gain: 0.03, type: "square" });
    },
  },
};

export const cardSounds = {
  shuffle: { role: "action", samples: rec("shuffle-1", "shuffle-2"), synth: SYNTH.shuffle, trim: 12.9 },
  deal: { role: "action", offset: -6, samples: rec("deal-1", "deal-2", "deal-3"), synth: SYNTH.deal, trim: 14.9 },
  play: { role: "action", samples: rec("play-1", "play-2", "play-3"), synth: SYNTH.play, trim: 13.3 },
  draw: { role: "action", offset: -3, samples: rec("draw-1", "draw-2"), synth: SYNTH.draw, trim: 11.3 },
  gather: { role: "action", samples: rec("gather"), synth: SYNTH.gather, trim: 16.3 },
};
