// Crazy Eights sounds. The card handling is recorded (CC0, see
// sounds/LICENSE.txt): a riffle for the shuffle, a soft flick per card
// dealt, a snap for a card played, a slide for a card drawn, and a fan of
// cards gathered for a reshuffle. The rest is synthesized: a little magic
// for an 8 (its arpeggio depends on the suit named), the action cards, your
// turn, a pass, the last card, the timer, and tunes for a win and a loss.
// Each recording has a synthesized stand-in until it has loaded.
import { defineSounds } from "../engine/sound.js";
import { tone, noise, pentatonic } from "../engine/synth.js";

// C major pentatonic from C4.
const note = pentatonic(261.63);

function bell(a, o, t, freq, gain = 0.06, dur = 0.8) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 2.76, dur: dur * 0.45, gain: gain * 0.3 });
  tone(a, o, t, { freq: freq * 5.4, dur: dur * 0.2, gain: gain * 0.12 });
}

function sparkle(a, o, t, gain = 0.04, from = 15) {
  [0, 2, 4, 5, 7].forEach((n, i) => tone(a, o, t + i * 0.04, { freq: note(from + n), dur: 0.2, gain }));
  noise(a, o, t, { dur: 0.4, gain: gain * 0.6, type: "highpass", freq: 7000, attack: 0.05 });
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
  nope: (a, o, t) => {
    tone(a, o, t, { freq: 220, dur: 0.09, gain: 0.08, type: "square" });
    tone(a, o, t + 0.1, { freq: 196, dur: 0.12, gain: 0.08, type: "square" });
  },
  turn: (a, o, t) => {
    tone(a, o, t, { freq: note(12), dur: 0.16, gain: 0.05 });
    tone(a, o, t + 0.1, { freq: note(15), dur: 0.22, gain: 0.05 });
  },
  tick: (a, o, t) => {
    noise(a, o, t, { dur: 0.014, gain: 0.12, type: "highpass", freq: 3000 });
    tone(a, o, t, { freq: 1500, dur: 0.02, gain: 0.03, type: "square" });
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

const rec = (...names) => names.map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);

export const sounds = defineSounds({
  shuffle: { role: "action", samples: rec("shuffle-1", "shuffle-2"), synth: SYNTH.shuffle, trim: 12.9 },
  deal: { role: "action", offset: -6, samples: rec("deal-1", "deal-2", "deal-3"), synth: SYNTH.deal, trim: 14.9 },
  play: { role: "action", samples: rec("play-1", "play-2", "play-3"), synth: SYNTH.play, trim: 13.3 },
  draw: { role: "action", offset: -3, samples: rec("draw-1", "draw-2"), synth: SYNTH.draw, trim: 11.3 },
  gather: { role: "action", samples: rec("gather"), synth: SYNTH.gather, trim: 16.3 },
  eight: { role: "highlight", synth: SYNTH.eight, trim: 5.9 },
  two: { role: "highlight", synth: SYNTH.two, trim: 14.5 },
  skip: { role: "highlight", synth: SYNTH.skip, trim: 16.3 },
  reverse: { role: "highlight", synth: SYNTH.reverse, trim: 16.1 },
  last: { role: "highlight", synth: SYNTH.last, trim: 6.7 },
  pass: { role: "ui", synth: SYNTH.pass, trim: 6.9 },
  nope: { role: "ui", synth: SYNTH.nope, trim: 5.5 },
  turn: { role: "ui", synth: SYNTH.turn, trim: 5.1 },
  tick: { role: "cue", synth: SYNTH.tick, trim: 5.2 },
  win: { role: "fanfare", synth: SYNTH.win, trim: 5.8 },
  lose: { role: "fanfare", synth: SYNTH.lose, trim: 12.0 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
