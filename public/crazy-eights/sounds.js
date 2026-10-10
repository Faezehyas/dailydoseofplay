// Crazy Eights sounds. The card games' shared set (engine/cards/card-sounds.js)
// handles the cards (a riffle, a deal flick, a card played, a card drawn, a
// reshuffle's gather) and plays your turn, a refusal and the timer. The rest
// is synthesized here: a little magic for an 8 (its arpeggio depends on the
// suit named), the action cards, a pass, the last card, a win and a loss.
import { defineSounds } from "../engine/sound.js";
import { tone, noise } from "../engine/synth.js";
import { cardSounds, tableSounds, note, bell } from "../engine/cards/card-sounds.js";

function sparkle(a, o, t, gain = 0.04, from = 15) {
  [0, 2, 4, 5, 7].forEach((n, i) => tone(a, o, t + i * 0.04, { freq: note(from + n), dur: 0.2, gain }));
  noise(a, o, t, { dur: 0.4, gain: gain * 0.6, type: "highpass", freq: 7000, attack: 0.05 });
}

const SYNTH = {
  // An 8: a rising arpeggio that ends on a note of the named suit, and a sparkle.
  eight: (a, o, t, { suit = 0 } = {}) => {
    [5, 7, 9, 10 + suit].forEach((n, i) => tone(a, o, t + i * 0.06, { freq: note(n), dur: 0.35, gain: 0.05, type: "triangle" }));
    bell(a, o, t + 0.26, note(15 + suit), 0.05, 1);
    sparkle(a, o, t + 0.22, 0.035, 12 + suit);
  },
  // Take two: two low knocks and a falling pair of notes.
  two: (a, o, t) => {
    for (const d of [0, 0.12]) noise(a, o, t + d, { dur: 0.05, gain: 0.25, freq: 600, q: 1.2 });
    tone(a, o, t + 0.24, { freq: note(7), dur: 0.16, gain: 0.07, type: "triangle" });
    tone(a, o, t + 0.36, { freq: note(5), dur: 0.26, gain: 0.07, type: "triangle" });
  },
  // Skip: a quick whoosh past.
  skip: (a, o, t) => {
    noise(a, o, t, { dur: 0.3, gain: 0.16, freq: 600, to: 4000, q: 1.6, attack: 0.08 });
    tone(a, o, t + 0.05, { freq: note(9), to: note(14), dur: 0.2, gain: 0.04, type: "triangle" });
  },
  // Reverse: a swoop down and back up.
  reverse: (a, o, t) => {
    tone(a, o, t, { freq: 880, to: 330, dur: 0.22, gain: 0.06, type: "triangle" });
    tone(a, o, t + 0.2, { freq: 330, to: 880, dur: 0.22, gain: 0.06, type: "triangle" });
  },
  // Down to one card: a bright two-note call.
  last: (a, o, t) => {
    bell(a, o, t, note(12), 0.06, 0.6);
    bell(a, o, t + 0.14, note(14), 0.06, 0.9);
  },
  pass: (a, o, t) => {
    tone(a, o, t, { freq: note(7), dur: 0.14, gain: 0.07, type: "triangle" });
    tone(a, o, t + 0.13, { freq: note(5), dur: 0.24, gain: 0.07, type: "triangle" });
  },
  win: (a, o, t) => {
    [10, 12, 14, 15].forEach((n, i) => bell(a, o, t + i * 0.11, note(n), 0.05, 0.5));
    for (const n of [15, 17, 19, 20]) tone(a, o, t + 0.46, { freq: note(n), type: "triangle", dur: 0.9, gain: 0.04, attack: 0.02 });
    sparkle(a, o, t + 0.5);
  },
  lose: (a, o, t) => {
    [12, 11, 10].forEach((n, i) => tone(a, o, t + i * 0.2, { freq: note(n), type: "triangle", dur: 0.3, gain: 0.08 }));
    tone(a, o, t + 0.6, { freq: note(8), to: note(7), type: "triangle", dur: 0.6, gain: 0.08 });
  },
};

export const sounds = defineSounds({
  ...cardSounds,
  ...tableSounds,
  eight: { role: "highlight", synth: SYNTH.eight, trim: 5.9 },
  two: { role: "highlight", synth: SYNTH.two, trim: 14.5 },
  skip: { role: "highlight", synth: SYNTH.skip, trim: 16.3 },
  reverse: { role: "highlight", synth: SYNTH.reverse, trim: 16.1 },
  last: { role: "highlight", synth: SYNTH.last, trim: 6.7 },
  pass: { role: "ui", synth: SYNTH.pass, trim: 6.9 },
  win: { role: "fanfare", synth: SYNTH.win, trim: 5.8 },
  lose: { role: "fanfare", synth: SYNTH.lose, trim: 12.0 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
