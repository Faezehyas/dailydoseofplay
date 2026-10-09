// Chutes and Ladders sounds, synthesized: spinner clicks that slow down
// with the pointer, a marimba note per hop that counts up the scale, a
// xylophone run up a ladder, a slide whistle down a chute, a spring for
// bouncing back off 100, and little tunes for winning and losing. They play
// through the engine (engine/sound.js), which sets their loudness.
import { defineSounds } from "../engine/sound.js";
import { tone, noise, decay, pentatonic } from "../engine/synth.js";

// C major pentatonic from C4 up, so any run of hops or rungs sounds sunny.
const note = pentatonic(261.63);

// A soft mallet on wood: the note, its bright fourth harmonic, a tap.
function marimba(a, o, t, freq, gain = 0.16) {
  tone(a, o, t, { freq, dur: 0.32, gain });
  tone(a, o, t, { freq: freq * 3.9, dur: 0.06, gain: gain * 0.25 });
  noise(a, o, t, { dur: 0.018, gain: gain * 0.5, freq: 2400, q: 1.2 });
}

// Brighter and shorter, for ladder rungs.
function xylo(a, o, t, freq, gain = 0.12) {
  tone(a, o, t, { freq, type: "triangle", dur: 0.2, gain });
  tone(a, o, t, { freq: freq * 3, dur: 0.05, gain: gain * 0.3 });
  noise(a, o, t, { dur: 0.012, gain: gain * 0.6, freq: 4000, q: 1.5 });
}

const SYNTH = {
  // The spinner's pointer flicking past a peg.
  tick: (a, o, t, { pitch = 1 } = {}) => {
    noise(a, o, t, { dur: 0.016, gain: 0.16, type: "highpass", freq: 2800 * pitch });
    tone(a, o, t, { freq: 1900 * pitch, dur: 0.02, gain: 0.05, type: "square" });
  },
  // A finger flicks the pointer.
  flick: (a, o, t) => {
    noise(a, o, t, { dur: 0.09, gain: 0.12, freq: 900, to: 3200, q: 2 });
    tone(a, o, t, { freq: 300, to: 700, dur: 0.08, gain: 0.04, type: "triangle" });
  },
  // The pointer settles on a number.
  settle: (a, o, t) => {
    noise(a, o, t, { dur: 0.04, gain: 0.18, freq: 1300, q: 2 });
    tone(a, o, t, { freq: 620, to: 470, dur: 0.07, gain: 0.08, type: "triangle" });
  },
  // Hop number `k` of a move: a pawn tap plus a note that climbs with each hop.
  hop: (a, o, t, { k = 0, mine = true } = {}) => {
    noise(a, o, t, { dur: 0.03, gain: 0.14, freq: 700, q: 1.4 });
    marimba(a, o, t + 0.005, note((k % 8) + (mine ? 5 : 3)), 0.13);
  },
  // Rung `k` of `n`: a xylophone climbing nearly two octaves whatever the ladder's length.
  rung: (a, o, t, { k = 0, n = 6 } = {}) => xylo(a, o, t, note(6 + Math.round((k / Math.max(1, n - 1)) * 9))),
  // Reaching the top of a ladder: a shimmer.
  sparkle: (a, o, t) => {
    [15, 17, 19, 20, 22].forEach((s, i) => tone(a, o, t + i * 0.05, { freq: note(s), dur: 0.25, gain: 0.05 }));
    noise(a, o, t, { dur: 0.4, gain: 0.03, type: "highpass", freq: 7000, attack: 0.05 });
  },
  // Down a chute: a slide whistle with a little wobble, over rushing air.
  slide: (a, o, t, { dur = 1.2 } = {}) => {
    const osc = a.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(1250, t + dur * 0.15);
    osc.frequency.exponentialRampToValueAtTime(260, t + dur);
    const lfo = a.createOscillator();
    lfo.frequency.value = 7;
    const depth = a.createGain();
    depth.gain.setValueAtTime(18, t);
    depth.gain.linearRampToValueAtTime(5, t + dur);
    lfo.connect(depth).connect(osc.frequency);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.06);
    g.gain.setValueAtTime(0.11, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    osc.connect(g).connect(o);
    for (const n of [osc, lfo]) {
      n.start(t);
      n.stop(t + dur + 0.1);
    }
    noise(a, o, t, { dur, gain: 0.08, freq: 2600, to: 380, q: 0.8, attack: dur * 0.6 });
  },
  // Landing at the bottom of a chute.
  bump: (a, o, t) => {
    tone(a, o, t, { freq: 150, to: 55, dur: 0.22, gain: 0.3 });
    noise(a, o, t, { dur: 0.12, gain: 0.14, type: "lowpass", freq: 900, to: 200 });
  },
  // Bouncing back off square 100: a spring.
  boing: (a, o, t) => {
    const osc = a.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(240, t + 0.5);
    const lfo = a.createOscillator();
    lfo.frequency.value = 16;
    const depth = a.createGain();
    depth.gain.setValueAtTime(90, t);
    depth.gain.exponentialRampToValueAtTime(1, t + 0.5);
    lfo.connect(depth).connect(osc.frequency);
    osc.connect(decay(a, o, t, 0.16, 0.55, 0.01));
    for (const n of [osc, lfo]) {
      n.start(t);
      n.stop(t + 0.6);
    }
  },
  // Overshooting with the exact-spin rule: the pawn stays put.
  stay: (a, o, t) => {
    tone(a, o, t, { freq: note(7), dur: 0.18, gain: 0.08, type: "triangle" });
    tone(a, o, t + 0.16, { freq: note(5), dur: 0.3, gain: 0.08, type: "triangle" });
  },
  // Your turn.
  turn: (a, o, t) => {
    tone(a, o, t, { freq: note(12), dur: 0.16, gain: 0.05 });
    tone(a, o, t + 0.1, { freq: note(14), dur: 0.22, gain: 0.05 });
  },
  win: (a, o, t) => {
    [10, 12, 13, 15].forEach((s, i) => marimba(a, o, t + i * 0.11, note(s), 0.12));
    for (const s of [15, 17, 18, 20]) tone(a, o, t + 0.46, { freq: note(s), type: "triangle", dur: 0.9, gain: 0.045, attack: 0.02 });
    SYNTH.sparkle(a, o, t + 0.5);
  },
  lose: (a, o, t) => {
    [12, 11, 10].forEach((s, i) => tone(a, o, t + i * 0.2, { freq: note(s), type: "triangle", dur: 0.3, gain: 0.08 }));
    tone(a, o, t + 0.6, { freq: note(8), to: note(7), type: "triangle", dur: 0.6, gain: 0.08 });
  },
};

export const sounds = defineSounds({
  tick: { role: "cue", synth: SYNTH.tick, trim: 2.1 },
  flick: { role: "action", synth: SYNTH.flick, trim: 19.7 },
  settle: { role: "action", synth: SYNTH.settle, trim: 15.3 },
  hop: { role: "action", synth: SYNTH.hop, trim: 3.8 },
  rung: { role: "action", synth: SYNTH.rung, trim: 7.6 },
  sparkle: { role: "highlight", synth: SYNTH.sparkle, trim: 8.2 },
  slide: { role: "highlight", synth: SYNTH.slide, trim: 0.4 },
  bump: { role: "action", synth: SYNTH.bump, trim: -0.7 },
  boing: { role: "highlight", synth: SYNTH.boing, trim: 5.1 },
  stay: { role: "ui", synth: SYNTH.stay, trim: 4.8 },
  turn: { role: "ui", synth: SYNTH.turn, trim: 5.6 },
  win: { role: "fanfare", synth: SYNTH.win, trim: 4.8 },
  lose: { role: "fanfare", synth: SYNTH.lose, trim: 12 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
