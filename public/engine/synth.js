// Building blocks for synthesized sounds: notes and filtered noise with a
// quick attack and an exponential fade, and a pentatonic scale. Each takes
// the audio context `a`, the node to play into `o` and the start time `t`,
// so a sound can play live or render offline the same way.

const noiseBufs = { white: new WeakMap(), brown: new WeakMap() };

// Three seconds of noise per context: white, or brown (integrated, a deep rumble).
export function noiseBuf(a, kind = "white") {
  let buf = noiseBufs[kind].get(a);
  if (!buf) {
    buf = a.createBuffer(1, Math.round(a.sampleRate * 3), a.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === "brown") {
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = white;
    }
    noiseBufs[kind].set(a, buf);
  }
  return buf;
}

// A gain that rises to `peak` in `attack` seconds, then fades out by `dur`.
export function decay(a, o, t, peak, dur, attack = 0.003) {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(o);
  return g;
}

// A note, gliding from `freq` to `to` when they differ.
export function tone(a, o, t, { freq, to = freq, type = "sine", dur = 0.15, gain = 0.1, attack = 0.003 }) {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  osc.connect(decay(a, o, t, gain, dur, attack));
  osc.start(t);
  osc.stop(t + dur + 0.02);
  return osc;
}

// Filtered noise, its filter sweeping from `freq` to `to` when they differ.
export function noise(a, o, t, { kind = "white", dur = 0.05, gain = 0.1, type = "bandpass", freq = 1500, to = freq, q = 1, attack = 0.002 }) {
  const src = a.createBufferSource();
  src.buffer = noiseBuf(a, kind);
  src.loop = true;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to !== freq) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  src.connect(f).connect(decay(a, o, t, gain, dur, attack));
  src.start(t, Math.random() * 2);
  src.stop(t + dur + 0.02);
}

// The major pentatonic scale up from `base` Hz: step 0 is the base, step 5 an
// octave up. Any run of its notes sounds bright.
const PENTA = [0, 2, 4, 7, 9];
export const pentatonic = (base) => (step) => base * 2 ** ((12 * Math.floor(step / 5) + PENTA[((step % 5) + 5) % 5]) / 12);
