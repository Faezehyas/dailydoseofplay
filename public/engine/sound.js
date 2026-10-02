// Small synthesized sound effects (WebAudio, no audio files). Muting is a
// per-device setting shared by every game.
const KEY = "ddp-sound";
let ctx = null;

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
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

function tone(a, { freq, to = freq, type = "sine", at = 0, dur = 0.15, gain = 0.15 }) {
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(a, { at = 0, dur = 0.3, gain = 0.2, from = 2000, to = 200 }) {
  const t = a.currentTime + at;
  const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

const SOUNDS = {
  miss: (a) => noise(a, { dur: 0.35, gain: 0.12, from: 1800, to: 300 }),
  hit: (a) => {
    noise(a, { dur: 0.45, gain: 0.25, from: 1200, to: 80 });
    tone(a, { freq: 120, to: 40, dur: 0.35, gain: 0.25 });
  },
  sink: (a) => {
    noise(a, { dur: 0.8, gain: 0.3, from: 900, to: 50 });
    tone(a, { freq: 220, to: 55, type: "triangle", dur: 0.7, gain: 0.15 });
  },
  gift: (a) => [523, 659, 784].forEach((f, k) => tone(a, { freq: f, type: "triangle", at: k * 0.08, dur: 0.12, gain: 0.12 })),
  turn: (a) => [660, 880].forEach((f, k) => tone(a, { freq: f, at: k * 0.1, dur: 0.12, gain: 0.08 })),
  tick: (a) => tone(a, { freq: 1200, dur: 0.04, gain: 0.05, type: "square" }),
  win: (a) => [523, 659, 784, 1047].forEach((f, k) => tone(a, { freq: f, type: "triangle", at: k * 0.12, dur: 0.2, gain: 0.14 })),
  lose: (a) => [392, 330, 262].forEach((f, k) => tone(a, { freq: f, type: "triangle", at: k * 0.16, dur: 0.25, gain: 0.12 })),
};

export function play(name) {
  if (!soundOn() || !SOUNDS[name]) return;
  try {
    const a = audio();
    if (a) SOUNDS[name](a);
  } catch {}
}
