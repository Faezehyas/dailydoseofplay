// Sound effects: synthesized with WebAudio, plus short recorded samples a
// game can preload. Muting is a per-device setting shared by every game.
const KEY = "ddp-sound";
let ctx = null;
let bus = null;

export function soundOn() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSound(on) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
}

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // A compressor keeps stacked blasts loud without clipping.
    bus = ctx.createDynamicsCompressor();
    bus.threshold.value = -18;
    bus.ratio.value = 6;
    const master = ctx.createGain();
    master.gain.value = 0.8;
    bus.connect(master).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

const buffers = {};
function noiseBuffer(a, kind) {
  if (buffers[kind]) return buffers[kind];
  const len = a.sampleRate * 3;
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === "brown") {
      last = (last + 0.02 * white) / 1.02; // integrated noise: deep rumble
      d[i] = last * 3.5;
    } else d[i] = white;
  }
  return (buffers[kind] = buf);
}

function env(a, t, { attack = 0.005, peak, dur }) {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

function tone(a, { freq, to = freq, type = "sine", at = 0, dur = 0.15, gain = 0.15, attack = 0.005 }) {
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  osc.connect(env(a, t, { attack, peak: gain, dur })).connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return osc;
}

function noise(a, { kind = "white", at = 0, dur = 0.3, gain = 0.2, attack = 0.005, type = "lowpass", from = 2000, to = from, q = 0.7 }) {
  const t = a.currentTime + at;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a, kind);
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  src.connect(f).connect(env(a, t, { attack, peak: gain, dur })).connect(bus);
  src.start(t, Math.random() * 2);
  src.stop(t + dur + 0.05);
}

// A shell coming in: a muffled launch boom, then rushing air that swells
// as it nears and cuts off at impact (no cartoon whistle).
function incoming(a, { at = 0, dur = 0.45, from = 2600, to = 500, gain = 0.32, launch = 0.16 }) {
  if (launch) noise(a, { at, dur: 0.14, gain: launch, from: 520, to: 110 });
  noise(a, { at: at + 0.03, dur, gain, type: "bandpass", from, to, q: 1.4, attack: dur * 0.85 });
  noise(a, { kind: "brown", at: at + 0.03, dur, gain: gain * 0.7, from: 380, to: 120, attack: dur * 0.85 });
}

// Water: a hollow plop, a spray of hiss, then a few rising bubbles.
function splash(a, at = 0, size = 1) {
  tone(a, { freq: 220, to: 70, at, dur: 0.14, gain: 0.4 * size });
  noise(a, { at, dur: 0.7 * size, gain: 0.5 * size, type: "bandpass", from: 1800, to: 700, q: 0.8, attack: 0.01 });
  noise(a, { at: at + 0.02, dur: 0.45, gain: 0.18 * size, type: "highpass", from: 5000, to: 3000 });
  for (let k = 0; k < 4; k++) {
    tone(a, { freq: 380 + Math.random() * 200, to: 900 + Math.random() * 300, at: at + 0.15 + Math.random() * 0.45, dur: 0.035, gain: 0.06 });
  }
}

// A hit: sharp crack, burning body, low thump.
function blast(a, at = 0, size = 1) {
  noise(a, { at, dur: 0.06, gain: 0.35 * size, type: "highpass", from: 1500 });
  noise(a, { at, dur: 0.7 * size, gain: 0.4 * size, from: 1400, to: 90 });
  tone(a, { freq: 95, to: 32, at, dur: 0.5 * size, gain: 0.45 * size });
}

const SOUNDS = {
  launch: (a) => incoming(a, {}),
  "launch-big": (a) => incoming(a, { dur: 0.55, from: 2000, to: 350, gain: 0.4, launch: 0.22 }),
  "launch-rain": (a) => {
    for (let k = 0; k < 5; k++) incoming(a, { at: k * 0.06, dur: 0.52, from: 2400 + k * 200, to: 600, gain: 0.12, launch: k === 0 ? 0.14 : 0 });
  },
  "launch-nuke": (a) => {
    // A heavy bomb falling: a deep, long roar of air building to impact.
    incoming(a, { dur: 1.0, from: 1400, to: 160, gain: 0.45, launch: 0.25 });
    noise(a, { kind: "brown", dur: 1.0, gain: 0.3, from: 200, to: 60, attack: 0.9 });
  },
  miss: (a) => splash(a),
  hit: (a) => blast(a),
  "hit-big": (a) => {
    blast(a, 0, 1.4);
    blast(a, 0.12, 0.8);
  },
  sink: (a) => {
    blast(a, 0, 1.3);
    SOUNDS.groan(a);
    splash(a, 0.5, 0.7);
  },
  // Hull groaning as it goes under.
  groan: (a) => {
    const t = a.currentTime;
    const groan = a.createOscillator();
    const f = a.createBiquadFilter();
    groan.type = "sawtooth";
    groan.frequency.setValueAtTime(120, t + 0.25);
    groan.frequency.exponentialRampToValueAtTime(55, t + 1.5);
    f.type = "lowpass";
    f.frequency.value = 380;
    groan.connect(f).connect(env(a, t + 0.25, { attack: 0.2, peak: 0.08, dur: 1.3 })).connect(bus);
    groan.start(t + 0.25);
    groan.stop(t + 1.6);
  },
  "rain-hit": (a) => blast(a, 0, 0.6),
  "rain-miss": (a) => splash(a, 0, 0.6),
  nuke: (a) => {
    // Detonation: blinding crack, deep blast, sub-bass shock, rolling thunder, debris.
    noise(a, { dur: 0.12, gain: 0.6, type: "highpass", from: 2500 });
    noise(a, { kind: "brown", dur: 3.2, gain: 0.9, attack: 0.02, from: 900, to: 60 });
    tone(a, { freq: 60, to: 22, dur: 2.6, gain: 0.6, attack: 0.03 });
    tone(a, { freq: 38, to: 18, at: 0.05, dur: 2.2, gain: 0.4, type: "triangle", attack: 0.05 });
    for (const [at, g] of [[0.45, 0.35], [0.95, 0.25], [1.6, 0.18], [2.3, 0.1]]) {
      noise(a, { kind: "brown", at, dur: 1.1, gain: g, attack: 0.15, from: 260, to: 70 });
    }
    noise(a, { at: 0.3, dur: 2.0, gain: 0.07, type: "bandpass", from: 900, to: 250, q: 0.9, attack: 0.3 });
  },
  gift: (a) => [523, 659, 784, 1047].forEach((f, k) => tone(a, { freq: f, type: "triangle", at: k * 0.07, dur: 0.14, gain: 0.1 })),
  turn: (a) => [660, 880].forEach((f, k) => tone(a, { freq: f, at: k * 0.1, dur: 0.12, gain: 0.07 })),
  tick: (a) => tone(a, { freq: 1200, dur: 0.04, gain: 0.05, type: "square" }),
  win: (a) => [523, 659, 784, 1047].forEach((f, k) => tone(a, { freq: f, type: "triangle", at: k * 0.12, dur: 0.22, gain: 0.12 })),
  lose: (a) => [392, 330, 262].forEach((f, k) => tone(a, { freq: f, type: "triangle", at: k * 0.16, dur: 0.28, gain: 0.1 })),
};

// ---------- recorded samples ----------
// Decoded with an OfflineAudioContext so preloading needs no user gesture;
// AudioBuffers can be played by any context.
const decoded = new Map();
const loading = new Map();

export function preload(urls) {
  return Promise.all(
    urls.map((url) => {
      if (!loading.has(url)) {
        const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
        loading.set(
          url,
          !Offline
            ? Promise.resolve(null)
            : fetch(url)
                .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
                .then((bytes) => new Offline(1, 1, 44100).decodeAudioData(bytes))
                .then((buf) => (decoded.set(url, buf), buf))
                .catch(() => null),
        );
      }
      return loading.get(url);
    }),
  );
}

// Play one of `urls` (picked at random, pitch nudged for variety; `rate` below
// 1 plays it slower and deeper). Falls back to the synthesized `fallback` sound
// until the sample is decoded. Returns whether the recording played.
export function playSample(urls, { gain = 0.6, rate = 1, jitter = 0.06, fallback } = {}) {
  if (!soundOn()) return false;
  const list = Array.isArray(urls) ? urls : [urls];
  const url = list[Math.floor(Math.random() * list.length)];
  const buf = decoded.get(url);
  if (!buf) {
    preload(list);
    if (fallback) play(fallback);
    return false;
  }
  try {
    const a = audio();
    if (!a) return false;
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(g).connect(bus);
    src.start();
    return true;
  } catch {
    return false;
  }
}

export function play(name) {
  if (!soundOn() || !SOUNDS[name]) return;
  try {
    const a = audio();
    if (a) SOUNDS[name](a);
  } catch {}
}
