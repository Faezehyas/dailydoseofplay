// Every sound on the site plays through here: one audio context, one output
// and one loudness scale. A game lists its sounds with defineSounds(), and
// each sound has a role. Every role has one loudness for the whole site, so
// a die rolled in Ludo is as loud as a piece set down in Chess, and a win
// tune as loud in every game. Recordings are measured as they load and set
// to their role. A synthesized sound carries a `trim` that brings it there,
// which the sound-levels browser test checks for every sound of every game.
// Muting and the volume are per-device settings (prefs.js) shared by every
// game; the volume is a master gain after the output.
import { loudness, fromDb } from "./loudness.js";
import { getPrefs, onPrefsChange } from "./prefs.js";

const soundOn = () => getPrefs().sound;

// The volume (0 to 100) as a gain, squared so each step sounds about as big.
const gainOf = (volume) => (volume / 100) ** 2;

// Each role's loudness in LUFS over 100 ms (see loudness.js).
export const ROLES = {
  cue: -34, // a background signal: a timer tick, a shell in the air
  ui: -29, // your turn, another roll, a move that can't be made
  action: -24, // the routine move: a die, a piece set down, a hop, a line
  highlight: -21, // something happened: a capture, a box, a hit, a ladder
  fanfare: -19, // the big moments: a win, a loss, a sunk ship, a nuke
};

// How far a sound may land from its role (and the most a sound may set
// itself apart from its role with `offset`), in dB.
export const TOLERANCE = 1.5;
export const MAX_OFFSET = 6;

// The site's output: a soft clipper. Below -1 dBFS it passes sound through
// untouched; above, when sounds stack, it rounds peaks off rather than let
// them crack. (A DynamicsCompressor would also turn down sounds that never
// reach its threshold, which would undo the levels.)
const HEADROOM = 4; // the clipper takes up to 4x full scale (+12 dB)
let clipCurve = null;
function curve() {
  if (!clipCurve) {
    const knee = 10 ** (-1 / 20);
    clipCurve = new Float32Array(8193);
    for (let i = 0; i < clipCurve.length; i++) {
      const x = ((i / (clipCurve.length - 1)) * 2 - 1) * HEADROOM;
      const m = Math.abs(x);
      clipCurve[i] = Math.sign(x) * (m <= knee ? m : knee + (1 - knee) * Math.tanh((m - knee) / (1 - knee)));
    }
  }
  return clipCurve;
}

export function output(a, dest = a.destination) {
  const pre = a.createGain();
  pre.gain.value = 1 / HEADROOM;
  const clip = a.createWaveShaper();
  clip.curve = curve();
  pre.connect(clip).connect(dest);
  return pre;
}

let ctx = null;
let out = null;

function audio() {
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = gainOf(getPrefs().volume);
    master.connect(ctx.destination);
    out = output(ctx, master);
    onPrefsChange(({ volume }) => master.gain.setTargetAtTime(gainOf(volume), ctx.currentTime, 0.02));
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only start audio after a click or key press: get it ready on the
// first one, on pages that have sounds.
let listening = false;
let gestured = false;
function startOnGesture() {
  if (listening) return;
  listening = true;
  const ready = () => {
    gestured = true;
    if (soundOn()) audio();
  };
  for (const type of ["pointerdown", "keydown"]) globalThis.addEventListener?.(type, ready, { once: true, capture: true });
}

// ---------- recordings ----------
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

// How loud a recording is at `rate` (played faster, it is higher and shorter).
const measured = new Map();
function sampleLoudness(buf, rate) {
  const key = `${rate}`;
  let byRate = measured.get(buf);
  if (!byRate) measured.set(buf, (byRate = new Map()));
  if (!byRate.has(key)) byRate.set(key, loudness(buf.getChannelData(0), buf.sampleRate * rate));
  return byRate.get(key);
}

// ---------- a game's sounds ----------
// `defs` maps each sound's name to:
//   role     one of ROLES
//   offset   dB from the role, for a softer layer or a bigger take of a
//            sound (at most MAX_OFFSET either way); default 0
//   samples  recording URLs, one picked at random each time. They play at
//            `rate` (default 1), nudged by up to `jitter` (default 0.06).
//   synth    (a, out, t, opts) => plays the sound into `out` at time `t`.
//            With `samples` it is the stand-in until they have loaded.
//   trim     dB that brings `synth` to its role; the sound-levels test
//            prints how far off it is.
// play(name, opts, at) plays a sound now or `at` seconds from now. `opts`
// goes to `synth`, and `opts.offset` makes one play softer or louder. It
// returns whether a recording played. render() is for tests.
export function defineSounds(defs) {
  for (const [name, def] of Object.entries(defs)) {
    if (!(def.role in ROLES)) throw new Error(`sound ${name}: unknown role ${def.role}`);
  }
  const urls = Object.values(defs).flatMap((d) => d.samples ?? []);
  preload(urls);
  startOnGesture();

  // Plays `name` into `dest` at `t`; `variant` picks a recording (an index) or "synth".
  function start(a, dest, name, opts, t, variant) {
    const def = defs[name];
    const db = ROLES[def.role] + (def.offset ?? 0) + (opts.offset ?? 0);
    const list = def.samples ?? [];
    const url = variant === "synth" ? null : list[variant ?? Math.floor(Math.random() * list.length)];
    const buf = url && decoded.get(url);
    const g = a.createGain();
    g.connect(dest);
    if (buf) {
      const rate = def.rate ?? 1;
      const src = a.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate * (1 + (variant === undefined ? (Math.random() * 2 - 1) * (def.jitter ?? 0.06) : 0));
      g.gain.value = fromDb(db - sampleLoudness(buf, rate));
      src.connect(g);
      src.start(t);
      return "recording";
    }
    if (url) preload(list);
    if (!def.synth) return null;
    g.gain.value = fromDb(db - ROLES[def.role] + (def.trim ?? 0));
    def.synth(a, g, t, opts);
    return "synth";
  }

  return {
    names: Object.keys(defs),
    defs,
    play(name, opts = {}, at = 0) {
      if (!soundOn() || !defs[name]) return false;
      globalThis.ddpSounds?.push(name); // browser tests count what played
      try {
        // No click or key press on this page yet: skip, rather than queue
        // sounds that would all play at once after the first one. After it,
        // play even while the audio device is still starting up (it can take
        // a moment): the sound is heard as soon as it has.
        if (!gestured) return false;
        const a = audio();
        if (!a) return false;
        return start(a, out, name, opts, a.currentTime + 0.005 + at) === "recording";
      } catch {
        return false;
      }
    },
    // Renders one sound offline through the site's output, for checking
    // levels: a recording by index, or "synth". Returns mono samples.
    async render(name, { variant = "synth", opts = {}, seconds } = {}) {
      const def = defs[name];
      if (variant !== "synth") await preload(def.samples);
      const buf = variant !== "synth" && decoded.get(def.samples[variant]);
      const sampleRate = 48000;
      const len = seconds ?? (buf ? buf.duration / (def.rate ?? 1) + 0.3 : 4);
      const a = new OfflineAudioContext(1, Math.round(sampleRate * len), sampleRate);
      if (start(a, output(a), name, opts, 0.01, variant) !== (variant === "synth" ? "synth" : "recording")) throw new Error(`${name}: nothing to render`);
      return { samples: (await a.startRendering()).getChannelData(0), sampleRate };
    },
  };
}
