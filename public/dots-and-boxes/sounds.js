// Dots and Boxes sounds, synthesized: a pencil scratching a line on paper,
// a pop and a note for every box (the notes climb through a chain), a
// flourish when a long chain is swept up and a turn chime. The result
// chimes are the engine's (engine/chimes.js). They play through the engine
// (engine/sound.js), which sets their loudness.
import { defineSounds } from "../engine/sound.js";
import { tone, noise, pentatonic } from "../engine/synth.js";

// D major pentatonic from D4 up: any run of boxes sounds bright.
const note = pentatonic(293.66);

// A soft mallet: the note, its bright fourth harmonic, a tap.
function mallet(a, o, t, freq, gain = 0.16, dur = 0.34) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 3.98, dur: 0.07, gain: gain * 0.22 });
  noise(a, o, t, { dur: 0.016, gain: gain * 0.45, freq: 2600, q: 1.2 });
}

const SYNTH = {
  // Graphite dragged across paper: a hiss in short grains that follow the
  // pencil's grip, a darker rub under it, and a tap where the line ends.
  line: (a, o, t, { dur = 0.22, mine = true } = {}) => {
    const grains = Math.max(4, Math.round(dur / 0.028));
    const centre = mine ? 4200 : 3600;
    for (let i = 0; i < grains; i++) {
      const at = t + (i / grains) * dur + Math.random() * 0.008;
      const swell = Math.sin(Math.PI * ((i + 0.5) / grains)) ** 0.6;
      noise(a, o, at, { dur: 0.03 + Math.random() * 0.02, gain: (0.05 + Math.random() * 0.05) * swell, freq: centre * (0.8 + Math.random() * 0.45), q: 0.9, attack: 0.004 });
    }
    noise(a, o, t, { dur: dur + 0.03, gain: 0.04, freq: 1400, to: 1100, q: 0.6, attack: dur * 0.3 });
    noise(a, o, t + dur, { dur: 0.025, gain: 0.07, type: "lowpass", freq: 1800 });
  },
  // Box `k` of this turn's run: a pop, then a note one step up the scale each time.
  box: (a, o, t, { k = 0, mine = true } = {}) => {
    tone(a, o, t, { freq: 900, to: 280, dur: 0.07, gain: 0.12, type: "triangle" });
    noise(a, o, t, { dur: 0.03, gain: 0.08, freq: 1200, q: 1.5 });
    mallet(a, o, t + 0.02, note(Math.min(k, 12) + (mine ? 5 : 3)), 0.14);
  },
  // A run of three boxes or more, swept up: a quick climbing sparkle.
  chain: (a, o, t, { n = 3, mine = true } = {}) => {
    const top = Math.min(n, 8);
    for (let i = 0; i < 4; i++) tone(a, o, t + i * 0.045, { freq: note(top + (mine ? 8 : 6) + i), dur: 0.22, gain: 0.05 });
    noise(a, o, t, { dur: 0.35, gain: 0.025, type: "highpass", freq: 7000, attack: 0.04 });
  },
  // A tap on a line that can't be drawn.
  nope: (a, o, t) => {
    tone(a, o, t, { freq: 190, to: 120, dur: 0.12, gain: 0.12, type: "triangle" });
    noise(a, o, t, { dur: 0.04, gain: 0.05, type: "lowpass", freq: 700 });
  },
  // Your turn.
  turn: (a, o, t) => {
    tone(a, o, t, { freq: note(10), dur: 0.16, gain: 0.05 });
    tone(a, o, t + 0.1, { freq: note(12), dur: 0.24, gain: 0.05 });
  },
};

export const sounds = defineSounds({
  line: { role: "action", synth: SYNTH.line, trim: 15.4 },
  box: { role: "highlight", synth: SYNTH.box, trim: 5.5 },
  chain: { role: "highlight", synth: SYNTH.chain, trim: 9.5 },
  nope: { role: "ui", synth: SYNTH.nope, trim: 5.7 },
  turn: { role: "ui", synth: SYNTH.turn, trim: 5.9 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
