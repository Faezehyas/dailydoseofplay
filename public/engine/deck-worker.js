// Runs deck-crypto.js off the main thread for deck-service.js:
//   { id, op, args } -> { id, ok: true, value } | { id, ok: false, error }
import { loadDeckCrypto } from "./deck-crypto.js";
import { DeckError } from "./deck-service.js";

const ready = loadDeckCrypto();

self.onmessage = async ({ data: { id, op, args } }) => {
  try {
    const deck = await ready;
    if (typeof deck[op] !== "function") throw new Error(`unknown op ${op}`);
    self.postMessage({ id, ok: true, value: deck[op](...args) });
  } catch (err) {
    const deck = err instanceof DeckError;
    self.postMessage({ id, ok: false, error: { message: err?.message ?? String(err), deck, at: deck ? err.at : undefined, crashed: deck && err.crashed } });
  }
};
