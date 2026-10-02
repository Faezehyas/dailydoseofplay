// Deterministic PRNG (sfc32). Both peers feed it the same agreed seed, so
// they compute the same "random" outcome without trusting each other.

export function sfc32(a, b, c, d) {
  return function next() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

// Seed from at least 16 bytes (e.g. a SHA-256 digest).
export function rngFromBytes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const next = sfc32(view.getUint32(0, true), view.getUint32(4, true), view.getUint32(8, true), view.getUint32(12, true));
  for (let i = 0; i < 12; i++) next();
  return next;
}

// Convenience for tests and local-only randomness.
export function rngFromSeed(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  const words = [];
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ (s.charCodeAt(i) + k), 16777619) >>> 0;
    words.push(h);
  }
  const next = sfc32(...words);
  for (let i = 0; i < 12; i++) next();
  return next;
}

export const randInt = (rng, n) => Math.floor(rng() * n);

export function pick(rng, list) {
  return list[randInt(rng, list.length)];
}

// Pick from [{ value, weight }].
export function pickWeighted(rng, entries) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  let x = rng() * total;
  for (const e of entries) {
    x -= e.weight;
    if (x < 0) return e.value;
  }
  return entries[entries.length - 1].value;
}

// k distinct items from list (partial Fisher-Yates on a copy).
export function sample(rng, list, k) {
  const a = list.slice();
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + randInt(rng, a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

export const mathRandom = () => Math.random();
