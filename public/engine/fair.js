// Fair play between peers that do not trust each other, with no server
// involved. Two tools:
//
// 1. Commitments: publish sha256(salt:value) now, reveal value+salt later.
//    Used to lock in hidden information (e.g. a fleet) before play starts.
//
// 2. SharedRandom: unbiased, unpredictable random draws agreed by all peers.
//    Each peer builds a hash chain x0 -> x1=H(x0) -> ... -> xN and publishes
//    the tip xN. Draw k reveals x(N-k) from every seat; each peer checks
//    H(x(N-k)) equals the previous value. The draw seed is
//    H(k, seat0Value, seat1Value, ...). Values are fixed by the published
//    tips, so the last revealer cannot bias the result, and nobody can
//    predict a draw before every reveal arrives.
import { rngFromBytes } from "./rng.js";

const enc = new TextEncoder();

// WebCrypto's digest only exists on secure origins (https, localhost). Plain
// http (http://0.0.0.0:8080, a LAN IP) falls back to the same hash in JS.
export async function sha256(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  const subtle = globalThis.crypto?.subtle;
  return subtle ? new Uint8Array(await subtle.digest("SHA-256", bytes)) : sha256js(bytes);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const ror = (x, n) => (x >>> n) | (x << (32 - n));

// SHA-256 (FIPS 180-4) in plain JS.
export function sha256js(bytes) {
  const n = bytes.length;
  const padded = new Uint8Array(((n + 72) >> 6) << 6);
  padded.set(bytes);
  padded[n] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(n / 0x20000000));
  view.setUint32(padded.length - 4, (n << 3) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15];
      const b = W[i - 2];
      W[i] = W[i - 16] + (ror(a, 7) ^ ror(a, 18) ^ (a >>> 3)) + W[i - 7] + (ror(b, 17) ^ ror(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
    }
    [a, b, c, d, e, f, g, h].forEach((v, k) => (H[k] += v));
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  H.forEach((v, k) => outView.setUint32(k * 4, v));
  return out;
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 || /[^0-9a-f]/.test(hex)) throw new FairPlayError("bad hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export class FairPlayError extends Error {}

// JSON with sorted keys, so both sides hash identical bytes.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function commit(value) {
  const salt = toHex(randomBytes(16));
  const commitment = toHex(await sha256(`${salt}:${canonical(value)}`));
  return { commitment, salt };
}

export async function verifyCommit(commitment, value, salt) {
  if (typeof salt !== "string") return false;
  return toHex(await sha256(`${salt}:${canonical(value)}`)) === commitment;
}

export class HashChain {
  static async create(length = 256) {
    const links = [randomBytes(32)];
    for (let i = 0; i < length; i++) links.push(await sha256(links[i]));
    return new HashChain(links.map(toHex));
  }
  constructor(links) {
    this.links = links;
    this.length = links.length - 1;
  }
  get tip() {
    return this.links[this.length];
  }
  reveal(k) {
    if (k < 1 || k > this.length) throw new FairPlayError("hash chain exhausted");
    return this.links[this.length - k];
  }
}

export class ChainVerifier {
  constructor(tip) {
    if (typeof tip !== "string" || tip.length !== 64) throw new FairPlayError("bad chain tip");
    this.last = tip;
    this.k = 0;
  }
  async accept(k, value) {
    if (k !== this.k + 1) throw new FairPlayError(`draw ${k} out of order`);
    if (toHex(await sha256(fromHex(value))) !== this.last) throw new FairPlayError(`draw ${k} does not match commitment`);
    this.last = value;
    this.k = k;
  }
}

export class SharedRandom {
  static async create(length = 256) {
    return new SharedRandom(await HashChain.create(length));
  }
  constructor(chain) {
    this.chain = chain;
    this.k = 0;
    this.inbox = new Map(); // "k:seat" -> value
    this.waiters = new Map(); // "k:seat" -> { resolve, reject }
    this.verifiers = null; // seat -> ChainVerifier, mine excluded
    this.failed = null;
  }
  get tip() {
    return this.chain.tip;
  }
  // tips: chain tips by seat (mine is ignored); index: my seat. The seats fix
  // the hashing order.
  setPeers(tips, index) {
    this.index = index;
    this.verifiers = new Map();
    tips.forEach((tip, seat) => seat !== index && this.verifiers.set(seat, new ChainVerifier(tip)));
  }
  // Two players: index 0 for the host, 1 for the guest.
  setPeer(peerTip, index) {
    const tips = [];
    tips[1 - index] = peerTip;
    this.setPeers(tips, index);
  }
  // from: the revealing seat; optional with a single peer once it is set.
  receive(k, value, from = this.#onlyPeer()) {
    const key = `${k}:${from}`;
    const waiter = this.waiters.get(key);
    if (waiter) {
      this.waiters.delete(key);
      waiter.resolve(value);
    } else {
      this.inbox.set(key, value);
    }
  }
  #onlyPeer() {
    return this.verifiers?.size === 1 ? [...this.verifiers.keys()][0] : 1 - this.index;
  }
  abort(err) {
    this.failed = err;
    for (const w of this.waiters.values()) w.reject(err);
    this.waiters.clear();
  }
  #wait(k, seat) {
    if (this.failed) return Promise.reject(this.failed);
    const key = `${k}:${seat}`;
    if (this.inbox.has(key)) {
      const v = this.inbox.get(key);
      this.inbox.delete(key);
      return Promise.resolve(v);
    }
    return new Promise((resolve, reject) => this.waiters.set(key, { resolve, reject }));
  }
  // send(k, value) must deliver { k, value } to every peer's receive().
  // Resolves to a PRNG function all peers share for this draw.
  async draw(send) {
    if (!this.verifiers) throw new FairPlayError("peer chain not set");
    const k = ++this.k;
    const values = [];
    values[this.index] = this.chain.reveal(k);
    send(k, values[this.index]);
    const seats = [...this.verifiers.keys()];
    const theirs = await Promise.all(seats.map((seat) => this.#wait(k, seat)));
    for (const [i, seat] of seats.entries()) {
      await this.verifiers.get(seat).accept(k, theirs[i]);
      values[seat] = theirs[i];
    }
    return rngFromBytes(await sha256(`ddp-draw:${k}:${values.join(":")}`));
  }
}
