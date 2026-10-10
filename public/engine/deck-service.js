// deckService(): the deck cryptography (deck-crypto.js) as async calls, in one
// Web Worker per tab shared by every seat the tab plays, or in-process in Node.

export const CARD_BYTES = 66; // one ElGamal ciphertext: two compressed secp256k1 points
export const PK_BYTES = 33;
export const HELLO_BYTES = 98; // a public key and its Schnorr proof
export const SECRET_BYTES = 32;
export const SHARE_BYTES = 131; // a reveal token and its Chaum-Pedersen proof
export const MAX_DECK = 200; // the card points the library ships

// A deck input that doesn't check out. at: which item of a list was bad.
// crashed: it trapped the WebAssembly, whose state can't be trusted after.
export class DeckError extends Error {
  name = "DeckError";
  constructor(message, { at, crashed = false } = {}) {
    super(message);
    this.at = at;
    this.crashed = crashed;
  }
}

const OPS = ["keygen", "joinKeys", "newDeck", "shuffle", "verifyShuffle", "shares", "verifyShares", "open", "checkSecret", "faces"];

function workerBackend() {
  let worker = null;
  let nextId = 0;
  const jobs = new Map(); // id -> { op, args, resolve, reject }

  function start() {
    worker = new Worker(new URL("./deck-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data: { id, ok, value, error } }) => {
      const job = jobs.get(id);
      if (!job) return;
      jobs.delete(id);
      if (ok) return job.resolve(value);
      if (!error.deck) return job.reject(new Error(error.message));
      job.reject(new DeckError(error.message, { at: error.at, crashed: error.crashed }));
      if (error.crashed) restart();
    };
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      const err = new Error(`the deck worker failed: ${ev.message || "it could not start"}`);
      for (const job of jobs.values()) job.reject(err);
      jobs.clear();
      worker.terminate();
      worker = null;
    };
  }

  // The jobs queued behind a crash run again on a fresh worker.
  function restart() {
    worker.terminate();
    start();
    for (const [id, { op, args }] of jobs) worker.postMessage({ id, op, args });
  }

  return (op, args) =>
    new Promise((resolve, reject) => {
      if (!worker) start();
      const id = ++nextId;
      jobs.set(id, { op, args, resolve, reject });
      worker.postMessage({ id, op, args });
    });
}

function inProcessBackend() {
  const ready = import("./deck-crypto.js").then((m) => m.loadDeckCrypto());
  return async (op, args) => (await ready)[op](...args);
}

let service = null;

export function deckService() {
  if (!service) {
    const call = typeof Worker === "function" ? workerBackend() : inProcessBackend();
    service = Object.fromEntries(OPS.map((op) => [op, (...args) => call(op, args)]));
  }
  return service;
}
