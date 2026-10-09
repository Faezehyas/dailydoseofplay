// Sea Battle sounds. Real recordings (CC0, see sounds/LICENSE.txt) of heavy
// objects hitting water, shells exploding on a steel hull and bigger blasts
// at the waterline; synthesized shells in the air, a nuke, a sinking hull's
// groan and the turn and gift chimes. A recording's synthesized stand-in plays until it has
// loaded. They play through the engine (engine/sound.js), which sets their
// loudness.
import { defineSounds } from "../engine/sound.js";
import { tone as baseTone, noise as baseNoise } from "../engine/synth.js";

// A note and filtered noise, `at` seconds after `t`, with this game's defaults.
const tone = (a, o, t, { at = 0, ...p }) => baseTone(a, o, t + at, { gain: 0.15, attack: 0.005, ...p });
const noise = (a, o, t, { at = 0, from = 2000, ...p }) =>
  baseNoise(a, o, t + at, { dur: 0.3, gain: 0.2, attack: 0.005, type: "lowpass", freq: from, q: 0.7, ...p });

// A shell coming in: a muffled launch boom, then rushing air that swells
// as it nears and cuts off at impact (no cartoon whistle).
function incoming(a, o, t, { at = 0, dur = 0.45, from = 2600, to = 500, gain = 0.32, launch = 0.16 }) {
  if (launch) noise(a, o, t, { at, dur: 0.14, gain: launch, from: 520, to: 110 });
  noise(a, o, t, { at: at + 0.03, dur, gain, type: "bandpass", from, to, q: 1.4, attack: dur * 0.85 });
  noise(a, o, t, { kind: "brown", at: at + 0.03, dur, gain: gain * 0.7, from: 380, to: 120, attack: dur * 0.85 });
}

// Water: a hollow plop, a spray of hiss, then a few rising bubbles.
function splash(a, o, t, at = 0, size = 1) {
  tone(a, o, t, { freq: 220, to: 70, at, dur: 0.14, gain: 0.4 * size });
  noise(a, o, t, { at, dur: 0.7 * size, gain: 0.5 * size, type: "bandpass", from: 1800, to: 700, q: 0.8, attack: 0.01 });
  noise(a, o, t, { at: at + 0.02, dur: 0.45, gain: 0.18 * size, type: "highpass", from: 5000, to: 3000 });
  for (let k = 0; k < 4; k++) {
    tone(a, o, t, { freq: 380 + Math.random() * 200, to: 900 + Math.random() * 300, at: at + 0.15 + Math.random() * 0.45, dur: 0.035, gain: 0.06 });
  }
}

// A hit: sharp crack, burning body, low thump.
function blast(a, o, t, at = 0, size = 1) {
  noise(a, o, t, { at, dur: 0.06, gain: 0.35 * size, type: "highpass", from: 1500 });
  noise(a, o, t, { at, dur: 0.7 * size, gain: 0.4 * size, from: 1400, to: 90 });
  tone(a, o, t, { freq: 95, to: 32, at, dur: 0.5 * size, gain: 0.45 * size });
}

// Hull groaning as it goes under.
function groan(a, o, t) {
  const osc = a.createOscillator();
  const f = a.createBiquadFilter();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(120, t + 0.25);
  osc.frequency.exponentialRampToValueAtTime(55, t + 1.5);
  f.type = "lowpass";
  f.frequency.value = 380;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.08, t + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
  osc.connect(f).connect(g).connect(o);
  osc.start(t + 0.25);
  osc.stop(t + 1.6);
}

const rec = (...names) => names.map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);
const SPLASH_HEAVY = rec("splash-heavy-1", "splash-heavy-2");
const SPLASH_SMALL = rec("splash-small-1", "splash-small-2");
const EXPLOSION = rec("explosion-hit-1", "explosion-hit-2");
const BLAST = rec("explosion-big-1", "explosion-big-2");

export const sounds = defineSounds({
  // Shells in the air, one per weapon.
  launch: { role: "cue", trim: -1.3, synth: (a, o, t) => incoming(a, o, t, {}) },
  "launch-big": { role: "cue", trim: -3.1, synth: (a, o, t) => incoming(a, o, t, { dur: 0.55, from: 2000, to: 350, gain: 0.4, launch: 0.22 }) },
  "launch-rain": {
    role: "cue",
    trim: 2.2,
    synth: (a, o, t) => {
      for (let k = 0; k < 5; k++) incoming(a, o, t, { at: k * 0.06, dur: 0.52, from: 2400 + k * 200, to: 600, gain: 0.12, launch: k === 0 ? 0.14 : 0 });
    },
  },
  "launch-nuke": {
    role: "cue",
    trim: -4.8,
    synth: (a, o, t) => {
      // A heavy bomb falling: a deep, long roar of air building to impact.
      incoming(a, o, t, { dur: 1.0, from: 1400, to: 160, gain: 0.45, launch: 0.25 });
      noise(a, o, t, { kind: "brown", dur: 1.0, gain: 0.3, from: 200, to: 60, attack: 0.9 });
    },
  },
  miss: { role: "action", samples: SPLASH_HEAVY, trim: -6.7, synth: (a, o, t) => splash(a, o, t) },
  hit: { role: "highlight", samples: EXPLOSION, trim: -4.6, synth: (a, o, t) => blast(a, o, t) },
  // The big shot's hit.
  blast: {
    role: "highlight",
    samples: BLAST,
    trim: -8.5,
    synth: (a, o, t) => {
      blast(a, o, t, 0, 1.4);
      blast(a, o, t, 0.12, 0.8);
    },
  },
  // Missile rain and the carpet bomb: rolling booms, one per square. No pitch
  // jitter: it would pull the booms off their squares.
  rain: { role: "highlight", samples: rec("barrage"), jitter: 0 },
  carpet: { role: "highlight", samples: rec("carpet-bomb"), jitter: 0 },
  // A square of a rain or carpet volley, under the booms.
  "rain-hit": { role: "highlight", offset: -4, samples: EXPLOSION, rate: 1.15, jitter: 0.12, trim: 1.3, synth: (a, o, t) => blast(a, o, t, 0, 0.6) },
  "rain-miss": { role: "action", offset: -4, samples: SPLASH_SMALL, jitter: 0.12, trim: -1.8, synth: (a, o, t) => splash(a, o, t, 0, 0.6) },
  nuke: {
    role: "fanfare",
    trim: -8.2,
    synth: (a, o, t) => {
      // Detonation: blinding crack, deep blast, sub-bass shock, rolling thunder, debris.
      noise(a, o, t, { dur: 0.12, gain: 0.6, type: "highpass", from: 2500 });
      noise(a, o, t, { kind: "brown", dur: 3.2, gain: 0.9, attack: 0.02, from: 900, to: 60 });
      tone(a, o, t, { freq: 60, to: 22, dur: 2.6, gain: 0.6, attack: 0.03 });
      tone(a, o, t, { freq: 38, to: 18, at: 0.05, dur: 2.2, gain: 0.4, type: "triangle", attack: 0.05 });
      for (const [at, g] of [[0.45, 0.35], [0.95, 0.25], [1.6, 0.18], [2.3, 0.1]]) {
        noise(a, o, t, { kind: "brown", at, dur: 1.1, gain: g, attack: 0.15, from: 260, to: 70 });
      }
      noise(a, o, t, { at: 0.3, dur: 2.0, gain: 0.07, type: "bandpass", from: 900, to: 250, q: 0.9, attack: 0.3 });
    },
  },
  // The big blast slowed down under the nuke: a deep, real roar.
  roar: { role: "fanfare", samples: BLAST, rate: 0.5, jitter: 0.03 },
  // A ship blows apart: a second, deeper blast.
  sink: {
    role: "fanfare",
    samples: BLAST,
    rate: 0.8,
    trim: -5.6,
    synth: (a, o, t) => {
      blast(a, o, t, 0, 1.3);
      groan(a, o, t);
      splash(a, o, t, 0.5, 0.7);
    },
  },
  groan: { role: "cue", trim: -2.7, synth: groan },
  gift: { role: "ui", trim: 2.9, synth: (a, o, t) => [523, 659, 784, 1047].forEach((f, k) => tone(a, o, t, { freq: f, type: "triangle", at: k * 0.07, dur: 0.14, gain: 0.1 })) },
  turn: { role: "ui", trim: 7.7, synth: (a, o, t) => [660, 880].forEach((f, k) => tone(a, o, t, { freq: f, at: k * 0.1, dur: 0.12, gain: 0.07 })) },
  tick: { role: "cue", trim: 7.4, synth: (a, o, t) => tone(a, o, t, { freq: 1200, dur: 0.04, gain: 0.05, type: "square" }) },
});

export const play = sounds.play;
