import test from "node:test";
import assert from "node:assert/strict";
import { sounds, chime, MELODY, OFFSET, GAP, TIMBRES } from "./chimes.js";
import { pentatonic } from "./synth.js";

const OUTCOMES = ["win", "loss", "draw", "over"];
const FLAVOURS = ["wood", "paper", "plastic", "bell", "water"];
const note = pentatonic(523.25);

// Just enough of an audio context to hear which notes a synth starts, and when.
function listen(name) {
  const heard = [];
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect: (n) => n, gain: param(), frequency: param(), Q: param(), start() {}, stop() {} });
  const a = {
    sampleRate: 8000,
    createGain: node,
    createBiquadFilter: node,
    createBufferSource: node,
    createBuffer: (_, length) => ({ getChannelData: () => new Float32Array(length) }),
    createOscillator() {
      const osc = node();
      osc.frequency.setValueAtTime = (f) => (osc.f = f);
      osc.start = (t) => heard.push({ t, f: osc.f });
      return osc;
    },
  };
  sounds.defs[name].synth(a, node(), 0);
  return heard;
}

test("every outcome in every flavour has a chime of its own, at the fanfare level", () => {
  const names = new Set();
  for (const outcome of OUTCOMES) {
    for (const flavour of FLAVOURS) {
      const name = chime(outcome, flavour);
      assert.equal(name, `${outcome}-${flavour}`);
      assert.equal(sounds.defs[name].role, "fanfare", name);
      assert.equal(sounds.defs[name].offset, OFFSET[outcome], name);
      names.add(name);
    }
  }
  assert.equal(names.size, OUTCOMES.length * FLAVOURS.length);
  assert.deepEqual(Object.keys(TIMBRES).sort(), [...FLAVOURS].sort());
  assert.equal(sounds.names.length, names.size, "no other sounds");
});

test("a win rises over three notes, a loss falls over two, a draw stays, and 'over' is a softer win", () => {
  const [w, l, d, o] = OUTCOMES.map((k) => MELODY[k].map(note));
  assert.equal(w.length, 3);
  assert.ok(w[0] < w[1] && w[1] < w[2], "win rises");
  assert.equal(l.length, 2);
  assert.ok(l[0] > l[1], "loss falls");
  assert.deepEqual([d.length, d[0]], [2, d[1]], "draw holds one note");
  assert.deepEqual(o, w.slice(0, o.length), "over opens like a win");
  assert.ok(OFFSET.over < OFFSET.loss && OFFSET.loss < OFFSET.win, "over is the softest, a win the loudest");
});

test("every flavour plays the same melody, one note per step, in about 1.5 s", () => {
  for (const outcome of OUTCOMES) {
    for (const flavour of FLAVOURS) {
      const heard = listen(chime(outcome, flavour));
      MELODY[outcome].forEach((step, k) => {
        const at = heard.filter((h) => h.t >= k * GAP && h.t < (k + 1) * GAP);
        assert.ok(at.some((h) => Math.abs(h.f - note(step)) < 0.01), `${outcome}-${flavour}: note ${k + 1} is ${note(step).toFixed(0)} Hz`);
      });
      assert.ok(Math.max(...heard.map((h) => h.t)) < 1, `${outcome}-${flavour} has its last note in the first second`);
    }
  }
});
