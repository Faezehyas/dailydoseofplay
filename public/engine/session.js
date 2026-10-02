// A Session is what a game receives: a connected two-player channel plus the
// engine-level plumbing every game needs (names, rematch votes, goodbye).
// It is DOM-free so games and robots can be tested headless.
//
// Engine messages use a "$" prefix: $hello, $rematch, $bye. Everything else
// is a game message and is handed to session.onMessage handlers, buffered
// until the game registers one.
import { Emitter } from "./channel.js";

export const PROTOCOL_VERSION = 1;
const HELLO_TIMEOUT_MS = 10_000;

export class Session extends Emitter {
  constructor({ channel, mode, index, me, opponent, game }) {
    super();
    this.channel = channel;
    this.mode = mode; // "friend" | "robot"
    this.index = index; // 0 = host (room creator), 1 = guest
    this.role = index === 0 ? "host" : "guest";
    this.me = me;
    this.opponent = opponent;
    this.game = game;
    this.ended = false;
    this.rematchVotes = { me: false, them: false };
    this.handlers = [];
    this.buffer = [];
    this.offMsg = channel.on("message", (msg) => this.#onMessage(msg));
    this.offClose = channel.on("close", () => this.#end("closed"));
  }

  #onMessage(msg) {
    if (!msg || typeof msg.t !== "string") return;
    switch (msg.t) {
      case "$hello":
        return;
      case "$bye":
        return this.#end("left");
      case "$rematch":
        this.rematchVotes.them = true;
        this.emit("rematch", { ...this.rematchVotes });
        return this.#maybeRematch();
      default:
        if (msg.t.startsWith("$")) return;
        if (this.handlers.length === 0) this.buffer.push(msg);
        else for (const fn of this.handlers) fn(msg);
    }
  }

  onMessage(fn) {
    this.handlers.push(fn);
    for (const msg of this.buffer.splice(0)) fn(msg);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== fn);
    };
  }

  send(msg) {
    if (this.ended) return false;
    return this.channel.send(msg);
  }

  requestRematch() {
    if (this.ended || this.rematchVotes.me) return;
    this.rematchVotes.me = true;
    this.channel.send({ t: "$rematch" });
    this.emit("rematch", { ...this.rematchVotes });
    this.#maybeRematch();
  }

  #maybeRematch() {
    if (this.rematchVotes.me && this.rematchVotes.them) {
      this.rematchVotes = { me: false, them: false };
      this.emit("rematch-start");
    }
  }

  #end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.offMsg();
    this.offClose();
    this.emit("end", reason);
  }

  // Leave on purpose: tell the peer, then close the transport.
  leave() {
    if (this.ended) return;
    this.channel.send({ t: "$bye" });
    this.#end("self");
    setTimeout(() => this.channel.close(), 50);
  }
}

// Exchange $hello on a freshly opened channel and resolve to a Session.
export function openSession({ channel, mode, index, name, game }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      offClose();
      reject(new Error("hello_timeout"));
    }, HELLO_TIMEOUT_MS);
    const offClose = channel.on("close", () => {
      clearTimeout(timer);
      off();
      reject(new Error("closed"));
    });
    const off = channel.on("message", (msg) => {
      if (msg?.t !== "$hello") return;
      clearTimeout(timer);
      off();
      offClose();
      if (msg.game !== game || msg.v !== PROTOCOL_VERSION) return reject(new Error("version_mismatch"));
      const opponentName = String(msg.name || "").slice(0, 20) || (mode === "robot" ? "Robot" : "Friend");
      resolve(new Session({ channel, mode, index, me: { name }, opponent: { name: opponentName }, game }));
    });
    channel.send({ t: "$hello", name, game, v: PROTOCOL_VERSION });
  });
}
