// Fair play between two peers that do not trust each other, with no server
// involved. Two tools:
//
// 1. Commitments: publish sha256(salt:value) now, reveal value+salt later.
//    Used to lock in hidden information (e.g. a fleet) before play starts.
//
// 2. SharedRandom: unbiased, unpredictable random draws agreed by both peers.
//    Each peer builds a hash chain x0 -> x1=H(x0) -> ... -> xN and publishes
//    the tip xN. Draw k reveals x(N-k) from both sides; each side checks
//    H(x(N-k)) equals the previous value. The draw seed is
//    H(k, hostValue, guestValue). Values are fixed by the published tip, so
//    the second revealer cannot bias the result, and nobody can predict a
//    draw before both reveals arrive.
import { rngFromBytes } from "./rng.js";

const enc = new TextEncoder();

export async function sha256(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
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
    this.inbox = new Map();
    this.waiters = new Map();
    this.verifier = null;
    this.failed = null;
  }
  get tip() {
    return this.chain.tip;
  }
  // index: 0 for the host, 1 for the guest; fixes the hashing order.
  setPeer(peerTip, index) {
    this.verifier = new ChainVerifier(peerTip);
    this.index = index;
  }
  receive(k, value) {
    const waiter = this.waiters.get(k);
    if (waiter) {
      this.waiters.delete(k);
      waiter.resolve(value);
    } else {
      this.inbox.set(k, value);
    }
  }
  abort(err) {
    this.failed = err;
    for (const w of this.waiters.values()) w.reject(err);
    this.waiters.clear();
  }
  #wait(k) {
    if (this.failed) return Promise.reject(this.failed);
    if (this.inbox.has(k)) {
      const v = this.inbox.get(k);
      this.inbox.delete(k);
      return Promise.resolve(v);
    }
    return new Promise((resolve, reject) => this.waiters.set(k, { resolve, reject }));
  }
  // send(k, value) must deliver { k, value } to the peer's receive().
  // Resolves to a PRNG function both peers share for this draw.
  async draw(send) {
    if (!this.verifier) throw new FairPlayError("peer chain not set");
    const k = ++this.k;
    const mine = this.chain.reveal(k);
    send(k, mine);
    const theirs = await this.#wait(k);
    await this.verifier.accept(k, theirs);
    const [a, b] = this.index === 0 ? [mine, theirs] : [theirs, mine];
    return rngFromBytes(await sha256(`ddp-draw:${k}:${a}:${b}`));
  }
}
