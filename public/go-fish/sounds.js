// Go Fish sounds. The card games' shared set (engine/cards/card-sounds.js)
// handles the cards (a riffle, a deal flick, a slide for a card drawn or
// handed over, a fan for taking the pond) and plays your turn, a refusal and
// the timer. Synthesized here: a question for an ask, a bloop and splash for
// "Go fish!", a sparkle for a lucky catch, a little fanfare for a book, and
// sitting out. A win or a loss plays the result chimes (engine/chimes.js).
import { defineSounds } from "../engine/sound.js";
import { tone, noise } from "../engine/synth.js";
import { cardSounds, tableSounds, note, bell } from "../engine/cards/card-sounds.js";

// The handling Go Fish uses: no card is played onto a pile.
const { shuffle, deal, draw, gather } = cardSounds;

// A drop into water: a sine that leaps up in pitch.
function bloop(a, o, t, freq, gain = 0.12) {
  tone(a, o, t, { freq, to: freq * 2.6, dur: 0.09, gain, attack: 0.004 });
}

const SYNTH = {
  // "Got any 7s?": two soft notes, rising like a question.
  ask: (a, o, t) => {
    tone(a, o, t, { freq: note(7), dur: 0.14, gain: 0.06, type: "triangle" });
    tone(a, o, t + 0.12, { freq: note(9), dur: 0.26, gain: 0.06, type: "triangle" });
  },
  // "Go fish!": two bloops and a splash.
  fish: (a, o, t) => {
    bloop(a, o, t, 260, 0.06);
    bloop(a, o, t + 0.11, 330, 0.05);
    noise(a, o, t + 0.16, { dur: 0.42, gain: 0.1, freq: 1600, to: 500, q: 0.5, attack: 0.03 });
  },
  // A lucky catch: a quick climb of bright notes over a shimmer.
  lucky: (a, o, t) => {
    [12, 14, 15, 17, 19].forEach((n, i) => tone(a, o, t + i * 0.05, { freq: note(n), dur: 0.22, gain: 0.04 }));
    bell(a, o, t + 0.26, note(20), 0.04, 0.7);
    noise(a, o, t, { dur: 0.45, gain: 0.025, type: "highpass", freq: 7000, attack: 0.05 });
  },
  // A book: a short rising fanfare that lands on a bell.
  book: (a, o, t) => {
    [7, 9, 10].forEach((n, i) => tone(a, o, t + i * 0.09, { freq: note(n), dur: 0.16, gain: 0.05, type: "triangle" }));
    tone(a, o, t + 0.27, { freq: note(12), dur: 0.5, gain: 0.05, type: "triangle", attack: 0.01 });
    bell(a, o, t + 0.27, note(17), 0.035, 0.8);
  },
  // Out of cards with nothing to draw: two notes falling gently.
  out: (a, o, t) => {
    tone(a, o, t, { freq: note(7), dur: 0.16, gain: 0.06, type: "triangle" });
    tone(a, o, t + 0.15, { freq: note(4), dur: 0.3, gain: 0.06, type: "triangle" });
  },
};

export const sounds = defineSounds({
  shuffle,
  deal,
  draw,
  gather,
  ...tableSounds,
  ask: { role: "ui", synth: SYNTH.ask, trim: 7.3 },
  fish: { role: "highlight", synth: SYNTH.fish, trim: 14.7 },
  lucky: { role: "highlight", synth: SYNTH.lucky, trim: 9.6 },
  book: { role: "highlight", synth: SYNTH.book, trim: 8.8 },
  out: { role: "ui", synth: SYNTH.out, trim: 7.2 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
