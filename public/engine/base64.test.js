import test from "node:test";
import assert from "node:assert/strict";
import { toBase64, fromBase64 } from "./base64.js";

test("base64: round trips, and refuses anything but canonical base64", () => {
  for (const n of [0, 1, 2, 3, 131, 70_000]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37) & 255);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  }
  for (const bad of ["AB==", "A", "AAA", "A===", "AA=A", "AA AA", "AA-_", 42, null]) assert.throws(() => fromBase64(bad), TypeError, String(bad));
});
