// Ludo sounds. The die is a real recording (CC0, see sounds/LICENSE.txt);
// everything else is synthesized: a wooden tap and a marimba note per hop
// that climbs as the token goes, a pop for leaving the yard, a shimmer into
// the home column, a bell on a safe square, a bonk for a capture, a slide
// whistle for being captured and a fanfare home. The result chimes are the
// engine's (engine/chimes.js). They play through the engine
// (engine/sound.js), which sets their loudness.
import { defineSounds } from "../engine/sound.js";
import { tone, noise, decay, pentatonic } from "../engine/synth.js";

// G major pentatonic from G3 up: runs of hops always sound bright.
const note = pentatonic(196);

// A soft mallet on wood: the note, its bright fourth harmonic, a tap.
function marimba(a, o, t, freq, gain = 0.16, dur = 0.3) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 3.9, dur: 0.05, gain: gain * 0.22 });
  noise(a, o, t, { dur: 0.016, gain: gain * 0.45, freq: 2400, q: 1.2 });
}

// A small bell: inharmonic partials that ring a while.
function bell(a, o, t, freq, gain = 0.08, dur = 0.9) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 2.76, dur: dur * 0.5, gain: gain * 0.35 });
  tone(a, o, t, { freq: freq * 5.4, dur: dur * 0.25, gain: gain * 0.15 });
}

function sparkle(a, o, t, gain = 0.05) {
  [15, 17, 19, 20, 22].forEach((n, i) => tone(a, o, t + i * 0.045, { freq: note(n), dur: 0.22, gain }));
  noise(a, o, t, { dur: 0.35, gain: gain * 0.6, type: "highpass", freq: 7000, attack: 0.04 });
}

const SYNTH = {
  // A synthesized rattle, until the recording has loaded.
  dice: (a, o, t) => {
    for (let i = 0; i < 7; i++) {
      const at = t + i * 0.055 + Math.random() * 0.03;
      noise(a, o, at, { dur: 0.03, gain: 0.25 * (1 - i / 9), freq: 1800 + Math.random() * 1600, q: 3 });
      tone(a, o, at, { freq: 700 + Math.random() * 600, dur: 0.02, gain: 0.04, type: "triangle" });
    }
  },
  // Hop number k: a pawn tapping down plus a note that climbs with each square.
  hop: (a, o, t, { k = 0, mine = true } = {}) => {
    noise(a, o, t, { dur: 0.028, gain: 0.16, freq: 650, q: 1.3 });
    tone(a, o, t, { freq: 180, to: 110, dur: 0.05, gain: 0.08 });
    marimba(a, o, t + 0.004, note((k % 10) + (mine ? 5 : 3)), 0.12, 0.24);
  },
  // Leaving the yard: a cork pop and a quick rise.
  out: (a, o, t) => {
    tone(a, o, t, { freq: 260, to: 1100, dur: 0.09, gain: 0.16, type: "triangle" });
    noise(a, o, t, { dur: 0.05, gain: 0.18, freq: 1400, q: 1.5 });
    marimba(a, o, t + 0.09, note(10), 0.12);
    marimba(a, o, t + 0.17, note(12), 0.12);
  },
  // Into the home column: a rising shimmer.
  stretch: (a, o, t) => {
    tone(a, o, t, { freq: note(10), to: note(20), dur: 0.5, gain: 0.04, type: "triangle", attack: 0.05 });
    sparkle(a, o, t + 0.12, 0.04);
  },
  // Stopping on a star or start square.
  safe: (a, o, t) => {
    bell(a, o, t, note(17), 0.07);
    bell(a, o, t + 0.09, note(19), 0.05);
  },
  // You (or someone) knocked a token home: a bonk and a cheeky lift.
  capture: (a, o, t) => {
    tone(a, o, t, { freq: 620, to: 160, dur: 0.16, gain: 0.22, type: "triangle" });
    noise(a, o, t, { dur: 0.07, gain: 0.25, freq: 1100, q: 0.9 });
    tone(a, o, t, { freq: 90, to: 50, dur: 0.18, gain: 0.25 });
    marimba(a, o, t + 0.16, note(12), 0.12);
    marimba(a, o, t + 0.24, note(15), 0.13);
  },
  // Your token was knocked home: a slide whistle down and a sad wobble.
  captured: (a, o, t) => {
    const osc = a.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1100, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.65);
    const lfo = a.createOscillator();
    lfo.frequency.value = 9;
    const depth = a.createGain();
    depth.gain.value = 14;
    lfo.connect(depth).connect(osc.frequency);
    osc.connect(decay(a, o, t, 0.1, 0.7, 0.03));
    for (const n of [osc, lfo]) {
      n.start(t);
      n.stop(t + 0.75);
    }
    tone(a, o, t + 0.68, { freq: note(4), to: note(3), dur: 0.35, gain: 0.08, type: "triangle" });
  },
  // A token reaches the centre.
  home: (a, o, t) => {
    [10, 12, 14, 15].forEach((n, i) => marimba(a, o, t + i * 0.08, note(n), 0.11));
    for (const n of [15, 17, 19]) tone(a, o, t + 0.32, { freq: note(n), type: "triangle", dur: 0.6, gain: 0.035, attack: 0.02 });
    sparkle(a, o, t + 0.34, 0.04);
  },
  // A 6 (or a capture) means another roll.
  again: (a, o, t) => {
    [12, 14, 17].forEach((n, i) => tone(a, o, t + i * 0.06, { freq: note(n), dur: 0.14, gain: 0.05, type: "triangle" }));
  },
  // No move, or three 6s.
  nope: (a, o, t) => {
    tone(a, o, t, { freq: note(7), dur: 0.16, gain: 0.08, type: "triangle" });
    tone(a, o, t + 0.15, { freq: note(5), dur: 0.28, gain: 0.08, type: "triangle" });
  },
  // Your turn.
  turn: (a, o, t) => {
    tone(a, o, t, { freq: note(14), dur: 0.16, gain: 0.05 });
    tone(a, o, t + 0.1, { freq: note(17), dur: 0.22, gain: 0.05 });
  },
  // The move timer's last seconds.
  tick: (a, o, t) => {
    noise(a, o, t, { dur: 0.014, gain: 0.12, type: "highpass", freq: 3000 });
    tone(a, o, t, { freq: 1500, dur: 0.02, gain: 0.03, type: "square" });
  },
};

const DICE = ["dice-1", "dice-2"].map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);

export const sounds = defineSounds({
  dice: { role: "action", samples: DICE, synth: SYNTH.dice, trim: 16 },
  hop: { role: "action", synth: SYNTH.hop, trim: 5.2 },
  out: { role: "highlight", synth: SYNTH.out, trim: 5.2 },
  stretch: { role: "ui", synth: SYNTH.stretch, trim: 2.2 },
  safe: { role: "highlight", synth: SYNTH.safe, trim: 4.6 },
  capture: { role: "highlight", synth: SYNTH.capture, trim: 3.5 },
  captured: { role: "highlight", synth: SYNTH.captured, trim: 5.7 },
  home: { role: "highlight", synth: SYNTH.home, trim: 4.6 },
  again: { role: "ui", synth: SYNTH.again, trim: 6.7 },
  nope: { role: "ui", synth: SYNTH.nope, trim: 5.2 },
  turn: { role: "ui", synth: SYNTH.turn, trim: 5.2 },
  tick: { role: "cue", synth: SYNTH.tick, trim: 5.2 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
