// Ludo sounds. The die is a real recording (CC0, see sounds/LICENSE.txt);
// everything else is synthesized with WebAudio: a wooden tap and a marimba
// note per hop that climbs as the token goes, a pop for leaving the yard, a
// shimmer into the home column, a bell on a safe square, a bonk for a
// capture, a slide whistle for being captured, a fanfare home, and tunes for
// the end. They follow the site-wide mute button and never throw.
import { soundOn, playSample, preload } from "../engine/sound.js";

const DICE = ["dice-1", "dice-2"].map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);
preload(DICE);

let ctx = null;
let out = null;
const noiseBufs = new WeakMap();

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = master(ctx);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// A gentle compressor, so a chord over a run of hops never clips.
function master(a) {
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  const gain = a.createGain();
  gain.gain.value = 0.9;
  comp.connect(gain).connect(a.destination);
  return comp;
}

// Browsers only start audio after a click or key press: get it ready on the first one.
for (const type of ["pointerdown", "keydown"]) {
  globalThis.addEventListener?.(type, () => soundOn() && audio(), { once: true, capture: true });
}

function noiseBuf(a) {
  let buf = noiseBufs.get(a);
  if (!buf) {
    buf = a.createBuffer(1, Math.round(a.sampleRate * 2), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(a, buf);
  }
  return buf;
}

function decay(a, o, t, peak, dur, attack = 0.003) {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(o);
  return g;
}

function tone(a, o, t, { freq, to = freq, type = "sine", dur = 0.15, gain = 0.1, attack = 0.003 }) {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  osc.connect(decay(a, o, t, gain, dur, attack));
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return osc;
}

function noise(a, o, t, { dur = 0.05, gain = 0.1, type = "bandpass", freq = 1500, to = freq, q = 1, attack = 0.002 }) {
  const src = a.createBufferSource();
  src.buffer = noiseBuf(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to !== freq) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  src.connect(f).connect(decay(a, o, t, gain, dur, attack));
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
}

// G major pentatonic from G3 up: runs of hops always sound bright.
const PENTA = [0, 2, 4, 7, 9];
const note = (step, base = 196) => base * 2 ** ((12 * Math.floor(step / 5) + PENTA[((step % 5) + 5) % 5]) / 12);

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

const SOUNDS = {
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
  win: (a, o, t) => {
    [10, 12, 13, 15].forEach((n, i) => marimba(a, o, t + i * 0.11, note(n), 0.12));
    for (const n of [15, 17, 18, 20]) tone(a, o, t + 0.46, { freq: note(n), type: "triangle", dur: 0.9, gain: 0.045, attack: 0.02 });
    sparkle(a, o, t + 0.5);
  },
  lose: (a, o, t) => {
    [12, 11, 10].forEach((n, i) => tone(a, o, t + i * 0.2, { freq: note(n), type: "triangle", dur: 0.3, gain: 0.08 }));
    tone(a, o, t + 0.6, { freq: note(8), to: note(7), type: "triangle", dur: 0.6, gain: 0.08 });
  },
};

// Each sound's level, set against the recorded samples other games play
// (rendered offline: hops and landings near 0.3 peak, ticks lower).
const LEVEL = { dice: 5.5, hop: 4.4, out: 1.9, stretch: 2.1, safe: 2.4, capture: 1.7, captured: 3.4, home: 0.75, again: 3.2, nope: 2.2, turn: 3.4, tick: 2.8, win: 1.9, lose: 3 };
const DICE_GAIN = 0.55;

function voice(a, o, name) {
  const g = a.createGain();
  g.gain.value = LEVEL[name] ?? 1;
  g.connect(o);
  return g;
}

export const SOUND_NAMES = Object.keys(SOUNDS);

// Plays `name` now, or `at` seconds from now.
export function play(name, opts = {}, at = 0) {
  if (!soundOn() || !SOUNDS[name]) return;
  globalThis.ddpSounds?.push(name); // browser tests count what played
  try {
    if (name === "dice" && playSample(DICE, { gain: DICE_GAIN })) return;
    const a = audio();
    // Not started yet (no click on this page so far): skip, rather than
    // queue sounds that would all play at once later.
    if (!a || a.state !== "running") return;
    SOUNDS[name](a, voice(a, out, name), a.currentTime + 0.005 + at, opts);
  } catch {}
}

// Renders a sound offline and returns its samples (for checking levels).
export async function render(name, opts = {}, seconds = 2) {
  const a = new OfflineAudioContext(1, Math.round(44100 * seconds), 44100);
  SOUNDS[name](a, voice(a, master(a), name), 0.01, opts);
  return (await a.startRendering()).getChannelData(0);
}

// Peak of a recorded sample at the gain it plays at (for checking levels).
export async function samplePeak() {
  const [buf] = await preload([DICE[0]]);
  return buf ? Math.max(...buf.getChannelData(0).map(Math.abs)) * DICE_GAIN : 0;
}
