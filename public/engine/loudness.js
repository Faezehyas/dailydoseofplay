// How loud a sound is to the ear, in LUFS: K-weighted as in ITU-R BS.1770
// (a high shelf for the head, a high-pass for the lows the ear barely
// hears), then the loudest 100 ms. The ear sums sound over about that long,
// so a short knock and a long note at the same value sound about as loud,
// which comparing peaks gets badly wrong. No DOM or WebAudio: it runs in
// node too.

export const WINDOW = 0.1; // seconds

// The two BS.1770 filters for any sample rate (coefficients as in libebur128).
function filters(sr) {
  let K = Math.tan((Math.PI * 1681.974450955533) / sr);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  let Q = 0.7071752369554196;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  K = Math.tan((Math.PI * 38.13547087602444) / sr);
  Q = 0.5003270373238773;
  a0 = 1 + K / Q + K * K;
  const highpass = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highpass];
}

function biquad(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = y[i] = v;
  }
  return y;
}

// The loudest `window` seconds of mono samples `x`, in LUFS (-Infinity for silence).
export function loudness(x, sampleRate, window = WINDOW) {
  const [shelf, highpass] = filters(sampleRate);
  const k = biquad(biquad(x, shelf), highpass);
  const w = Math.max(1, Math.round(window * sampleRate));
  let sum = 0;
  let best = 0;
  for (let i = 0; i < k.length; i++) {
    sum += k[i] * k[i];
    if (i >= w) sum -= k[i - w] * k[i - w];
    if (sum > best) best = sum;
  }
  // A sound shorter than the window counts the silence after it, as the ear does.
  return best > 1e-12 ? -0.691 + 10 * Math.log10(best / w) : -Infinity;
}

// Decibels to a gain factor and back.
export const fromDb = (db) => 10 ** (db / 20);
export const toDb = (gain) => 20 * Math.log10(gain);
