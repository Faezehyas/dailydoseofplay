// WebSocket client for the shared /ws signaling endpoint. Works in browsers
// and in Node 22+ (global WebSocket), which the integration test relies on.
import { Emitter } from "./channel.js";

const PING_MS = 25_000;

export class SignalingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function defaultSignalingUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export class RoomClient extends Emitter {
  constructor({ game, url = defaultSignalingUrl() }) {
    super();
    this.game = game;
    this.url = url;
    this.ws = null;
    this.id = null;
    this.room = null;
    this.key = null;
    this.hostId = null;
    this.pending = null; // { types, resolve, reject }
    this.pinger = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        this.pinger = setInterval(() => this.#send({ t: "ping" }), PING_MS);
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === "hello" && !settled) {
          settled = true;
          this.id = msg.id;
          resolve(this);
        }
        // Refused before hello, e.g. too_many_connections.
        if (msg.t === "error" && !settled) {
          settled = true;
          return reject(new SignalingError(msg.code));
        }
        this.#onMessage(msg);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new SignalingError("connect_failed"));
        }
      };
      // The server puts its error code in the close reason (room_expired, too_fast, ...).
      ws.onclose = (ev) => {
        clearInterval(this.pinger);
        if (!settled) {
          settled = true;
          reject(new SignalingError("connect_failed"));
        }
        this.pending?.reject(new SignalingError("closed"));
        this.pending = null;
        this.emit("close", ev?.reason || null);
      };
    });
  }

  get connected() {
    return this.ws?.readyState === 1;
  }

  #send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  #request(msg, types) {
    if (this.pending) return Promise.reject(new SignalingError("busy"));
    return new Promise((resolve, reject) => {
      this.pending = { types, resolve, reject };
      this.#send(msg);
    });
  }

  #onMessage(msg) {
    if (this.pending && (this.pending.types.includes(msg.t) || msg.t === "error")) {
      const { resolve, reject } = this.pending;
      this.pending = null;
      if (msg.t === "error") reject(new SignalingError(msg.code));
      else resolve(msg);
      return;
    }
    switch (msg.t) {
      case "peer":
        return this.emit("peer", { id: msg.id, name: msg.name });
      case "knocking":
        return this.emit("knocking");
      case "knock":
        return this.emit("knock", { id: msg.id, name: msg.name });
      case "knock-gone":
        return this.emit("knock-gone", { id: msg.id });
      case "leave":
        return this.emit("leave", { id: msg.id });
      case "host-left":
        this.room = null;
        return this.emit("host-left");
      case "signal":
        return this.emit("signal", { from: msg.from, data: msg.data });
      case "error":
        return this.emit("error", new SignalingError(msg.code));
    }
  }

  async create(name) {
    const msg = await this.#request({ t: "create", game: this.game, name }, ["created"]);
    this.room = msg.room;
    this.key = msg.key;
    this.hostId = this.id;
    return msg;
  }

  // With the invite key the server seats us at once. Without it we emit
  // "knocking" and wait until the host admits us (or an error: declined, no_answer).
  async join(room, name, key) {
    const msg = await this.#request({ t: "join", game: this.game, room, name, ...(key ? { key } : {}) }, ["joined"]);
    this.room = msg.room;
    this.hostId = msg.host;
    return msg;
  }

  admit(id) {
    this.#send({ t: "admit", id });
  }

  decline(id) {
    this.#send({ t: "decline", id });
  }

  signal(to, data) {
    this.#send({ t: "signal", to, data });
  }

  leave() {
    this.room = null;
    this.#send({ t: "leave" });
  }

  close() {
    clearInterval(this.pinger);
    this.ws?.close();
  }
}
