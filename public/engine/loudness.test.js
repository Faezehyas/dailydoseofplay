import test from "node:test";
import assert from "node:assert/strict";
import { loudness, fromDb, toDb } from "./loudness.js";

const sine = (freq, amp, seconds, sr) => Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr));
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual.toFixed(2)} vs ${expected}`);

test("a 1 kHz sine at -20 dBFS measures -23 LUFS, at any sample rate (BS.1770 calibration)", () => {
  for (const sr of [44100, 48000]) near(loudness(sine(1000, 0.1, 1, sr), sr), -23, 0.1, `${sr} Hz`);
});

test("loudness follows level: 6 dB more gain reads 6 dB louder", () => {
  const sr = 48000;
  near(loudness(sine(500, 0.2, 1, sr), sr) - loudness(sine(500, 0.1, 1, sr), sr), 6.02, 0.05, "doubling");
});

test("the ear's weighting: deep bass counts for less than the mids", () => {
  const sr = 48000;
  assert.ok(loudness(sine(40, 0.1, 1, sr), sr) < loudness(sine(1000, 0.1, 1, sr), sr) - 1);
});

test("a sound shorter than the window counts the silence after it", () => {
  const sr = 48000;
  const burst = new Float32Array(sr); // 50 ms of tone in a second of silence
  burst.set(sine(1000, 0.1, 0.05, sr), 1000);
  near(loudness(burst, sr), -23 - 3.01, 0.1, "half the 100 ms window");
});

test("silence has no loudness; dB and gain convert both ways", () => {
  assert.equal(loudness(new Float32Array(4800), 48000), -Infinity);
  near(toDb(fromDb(-7.5)), -7.5, 1e-9, "round trip");
  near(fromDb(6.0206), 2, 1e-4, "6 dB is twice the amplitude");
});
