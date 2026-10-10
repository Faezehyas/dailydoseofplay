// Gin Rummy sounds. The card games' shared set (engine/cards/card-sounds.js)
// handles the cards (a riffle, a deal flick, a slide for a card drawn, a snap
// for a discard, a fan for gathering them in) and plays your turn, a refusal
// and the timer. Recorded here (CC0, see sounds/LICENSE.txt): knuckles
// rapping the table for a knock. Synthesized: a soft click when a card joins
// a meld in your hand, a lay-off, the points counting up, a ready, a fanfare
// for gin and a sting for an undercut. A win or a loss plays the result
// chimes (engine/chimes.js).
import { defineSounds } from "../engine/sound.js";
import { tone, noise } from "../engine/synth.js";
import { cardSounds, tableSounds, note, bell } from "../engine/cards/card-sounds.js";

const rec = (...names) => names.map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);

// A knuckle on a padded table: a dull thump and a little click.
function rap(a, o, t, gain = 0.3) {
  noise(a, o, t, { dur: 0.06, gain, type: "lowpass", freq: 900, to: 300, attack: 0.001 });
  tone(a, o, t, { freq: 150, to: 95, dur: 0.08, gain: gain * 0.5 });
  noise(a, o, t, { dur: 0.012, gain: gain * 0.3, freq: 2400, q: 2 });
}

const SYNTH = {
  knock: (a, o, t) => {
    rap(a, o, t);
    rap(a, o, t + 0.13, 0.26);
  },
  // A card snaps into a meld in your hand: two quick, soft, bright ticks.
  meld: (a, o, t) => {
    tone(a, o, t, { freq: note(14), dur: 0.05, gain: 0.05, type: "triangle" });
    tone(a, o, t + 0.04, { freq: note(17), dur: 0.08, gain: 0.04, type: "triangle" });
  },
  // A card laid off on the other hand's meld: a slide that lands on a note.
  layoff: (a, o, t, { n = 0 } = {}) => {
    noise(a, o, t, { dur: 0.12, gain: 0.08, freq: 1800, to: 3000, q: 0.8, attack: 0.02 });
    tone(a, o, t + 0.09, { freq: note(9 + (n % 5)), dur: 0.18, gain: 0.05, type: "triangle" });
  },
  // A point counted: a tiny wooden tick, a little higher each time.
  count: (a, o, t, { n = 0 } = {}) => {
    tone(a, o, t, { freq: 900 + Math.min(n, 30) * 18, dur: 0.03, gain: 0.05, type: "square" });
  },
  // The other player is ready for the next hand.
  ready: (a, o, t) => {
    tone(a, o, t, { freq: note(10), dur: 0.12, gain: 0.05 });
    tone(a, o, t + 0.08, { freq: note(12), dur: 0.2, gain: 0.05 });
  },
  // Gin: a bright rising fanfare that rings out on bells.
  gin: (a, o, t) => {
    [7, 9, 10, 12].forEach((n, i) => tone(a, o, t + i * 0.08, { freq: note(n), dur: 0.2, gain: 0.05, type: "sawtooth" }));
    tone(a, o, t + 0.32, { freq: note(14), dur: 0.7, gain: 0.05, type: "triangle", attack: 0.01 });
    tone(a, o, t + 0.32, { freq: note(17), dur: 0.7, gain: 0.03, type: "triangle", attack: 0.01 });
    bell(a, o, t + 0.32, note(19), 0.04, 1);
    noise(a, o, t + 0.3, { dur: 0.6, gain: 0.02, type: "highpass", freq: 7000, attack: 0.05 });
  },
  // An undercut: the knocker caught out. A quick drop and a wry bend.
  undercut: (a, o, t) => {
    tone(a, o, t, { freq: note(12), dur: 0.12, gain: 0.07, type: "square" });
    tone(a, o, t + 0.1, { freq: note(11), to: note(4), dur: 0.42, gain: 0.07, type: "sawtooth" });
    rap(a, o, t, 0.15);
  },
};

export const sounds = defineSounds({
  ...cardSounds,
  ...tableSounds,
  knock: { role: "highlight", samples: rec("knock-1", "knock-2"), synth: SYNTH.knock, trim: 11.6, jitter: 0.04 },
  meld: { role: "ui", offset: -3, synth: SYNTH.meld, trim: 10.1 },
  layoff: { role: "action", synth: SYNTH.layoff, trim: 14.4 },
  count: { role: "cue", synth: SYNTH.count, trim: 9.1 },
  ready: { role: "ui", synth: SYNTH.ready, trim: 6.2 },
  gin: { role: "fanfare", synth: SYNTH.gin, trim: 7.9 },
  undercut: { role: "highlight", synth: SYNTH.undercut, trim: 11.4 },
});

// Plays `name` now, or `at` seconds from now.
export const play = sounds.play;
