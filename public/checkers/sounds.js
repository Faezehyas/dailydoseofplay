// Checkers sounds, synthesized with WebAudio: a wooden clack when a piece
// lands, a knock for each piece taken, and a short chime for a new king.
// They follow the site-wide mute button and never throw.
import { soundOn } from "../engine/sound.js";

let ctx = null;
let out = null;
let noise = null;

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.1), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only start audio after a click or key press: get it ready on the first one.
for (const type of ["pointerdown", "keydown"]) {
  globalThis.addEventListener?.(type, () => soundOn() && audio(), { once: true, capture: true });
}

function decay(a, t, peak, dur) {
  const g = a.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  return g;
}

// Wood on wood: a bright click from filtered noise, plus a short low body.
function knock(a, t, { click = 1800, body = 220, gain = 0.35 } = {}) {
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = click;
  f.Q.value = 4;
  src.connect(f).connect(decay(a, t, gain, 0.045));
  src.start(t);
  src.stop(t + 0.06);
  const o = a.createOscillator();
  o.frequency.setValueAtTime(body, t);
  o.frequency.exponentialRampToValueAtTime(body * 0.7, t + 0.08);
  o.connect(decay(a, t, gain * 0.6, 0.09));
  o.start(t);
  o.stop(t + 0.1);
}

function chime(a, t, freq) {
  const o = a.createOscillator();
  o.type = "triangle";
  o.frequency.value = freq;
  o.connect(decay(a, t, 0.16, 0.25));
  o.start(t);
  o.stop(t + 0.3);
}

const HOP_GAP = 0.11; // seconds between the hops of a multi-jump

// `moved` is the rules' "moved" event. The opponent's pieces sound a little lower.
export function playMove({ captured, crowned }, mine) {
  if (!soundOn()) return;
  try {
    const a = audio();
    // Not started yet (no click on this page so far): skip, rather than queue
    // sounds that would all play at once later.
    if (!a || a.state !== "running") return;
    const t = a.currentTime + 0.01;
    const pitch = (mine ? 1 : 0.88) * (0.96 + Math.random() * 0.08);
    const hops = captured.length || 1;
    for (let k = 0; k < hops; k++) {
      knock(a, t + k * HOP_GAP, { click: 1800 * pitch * (1 + k * 0.06), body: 220 * pitch });
      if (captured.length) knock(a, t + k * HOP_GAP + 0.045, { click: 900 * pitch, body: 140 * pitch, gain: 0.2 });
    }
    if (crowned) {
      const end = t + hops * HOP_GAP;
      knock(a, end, { click: 2600 * pitch, body: 320 * pitch, gain: 0.25 });
      chime(a, end + 0.06, 784);
      chime(a, end + 0.14, 1175);
    }
  } catch {}
}
