// Dots and Boxes sounds, synthesized with WebAudio: a pencil scratching a
// line on paper, a pop and a note for every box (the notes climb through a
// chain), a flourish when a long chain is swept up, a turn chime, and little
// tunes for winning, losing and a draw. They follow the site-wide mute
// button and never throw.
import { soundOn } from "../engine/sound.js";

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

// A gentle compressor, so a chain's notes over a scratch never clip.
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

// D major pentatonic from D4 up: any run of boxes sounds bright.
const PENTA = [0, 2, 4, 7, 9];
const note = (step, base = 293.66) => base * 2 ** ((12 * Math.floor(step / 5) + PENTA[((step % 5) + 5) % 5]) / 12);

// A soft mallet: the note, its bright fourth harmonic, a tap.
function mallet(a, o, t, freq, gain = 0.16, dur = 0.34) {
  tone(a, o, t, { freq, dur, gain });
  tone(a, o, t, { freq: freq * 3.98, dur: 0.07, gain: gain * 0.22 });
  noise(a, o, t, { dur: 0.016, gain: gain * 0.45, freq: 2600, q: 1.2 });
}

const SOUNDS = {
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
  win: (a, o, t) => {
    [10, 12, 13, 15].forEach((s, i) => mallet(a, o, t + i * 0.11, note(s), 0.12));
    for (const s of [15, 17, 18, 20]) tone(a, o, t + 0.46, { freq: note(s), type: "triangle", dur: 0.9, gain: 0.045, attack: 0.02 });
    noise(a, o, t + 0.46, { dur: 0.5, gain: 0.03, type: "highpass", freq: 7000, attack: 0.05 });
  },
  lose: (a, o, t) => {
    [12, 11, 10].forEach((s, i) => tone(a, o, t + i * 0.2, { freq: note(s), type: "triangle", dur: 0.3, gain: 0.08 }));
    tone(a, o, t + 0.6, { freq: note(8), to: note(7), type: "triangle", dur: 0.6, gain: 0.08 });
  },
  // An even split: two answering phrases that land on the same note.
  draw: (a, o, t) => {
    [10, 12].forEach((s, i) => mallet(a, o, t + i * 0.13, note(s), 0.1));
    [12, 10].forEach((s, i) => mallet(a, o, t + 0.34 + i * 0.13, note(s) * 0.5, 0.1));
    for (const s of [10, 12]) tone(a, o, t + 0.66, { freq: note(s), type: "triangle", dur: 0.7, gain: 0.04, attack: 0.02 });
  },
};

// Each sound's level, set against the recorded samples other games play:
// lines and boxes near 0.3 peak, the turn chime softer, the tunes on top.
const LEVEL = { line: 4, box: 3.1, chain: 3.6, nope: 3, turn: 3.5, win: 2, lose: 3, draw: 2.2 };

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
