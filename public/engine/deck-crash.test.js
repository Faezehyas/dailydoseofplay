// A malformed shuffle proof that traps the WebAssembly instead of failing
// cleanly. Its own file, so the trap can't touch the module other tests use.
import test from "node:test";
import assert from "node:assert/strict";
import { loadDeckCrypto } from "./deck-crypto.js";
import { DeckError } from "./deck-service.js";

// In a 10-card shuffle message, this byte is part of a length the proof
// checker trusts: 255 there traps the module.
const TRAP = 2268;

test("a trap is a DeckError marked crashed, not the error freeing the trapped objects throws", async () => {
  const deck = await loadDeckCrypto();
  const ctx = (s) => `crash/${s}`;
  const keys = [0, 1].map((s) => deck.keygen(ctx(s)));
  const { joint } = deck.joinKeys(keys.map((k, s) => ({ hello: k.hello, context: ctx(s) })));
  const cards = deck.newDeck(10);
  const { proof } = deck.shuffle(joint, keys[0].secret, cards);
  proof[TRAP] = 255;
  assert.throws(() => deck.verifyShuffle(joint, 0, cards, proof), (err) => err instanceof DeckError && err.crashed && /crypto crashed/.test(err.message));
});
