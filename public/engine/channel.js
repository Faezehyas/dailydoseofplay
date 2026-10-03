// Tiny event emitter and the in-memory channel used for robot games and tests.
// Every transport (WebRTC DataChannel, local pair) exposes the same shape:
//   send(msg), on("message" | "close", fn), close(), open

export class Emitter {
  #handlers = new Map();
  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    this.#handlers.get(type)?.delete(fn);
  }
  emit(type, ...args) {
    for (const fn of [...(this.#handlers.get(type) || [])]) fn(...args);
  }
}

class LocalEnd extends Emitter {
  constructor(latency) {
    super();
    this.latency = latency;
    this.other = null;
    this.open = true;
  }
  send(msg) {
    if (!this.open) return false;
    const wire = JSON.stringify(msg); // same serialisation as the real wire
    const other = this.other;
    this.#deliver(() => other.open && other.emit("message", JSON.parse(wire)));
    return true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    this.emit("close");
    const other = this.other;
    this.#deliver(() => {
      if (!other.open) return;
      other.open = false;
      other.emit("close");
    });
  }
  // Without latency, deliver on a microtask rather than a timer: like a real
  // DataChannel, the robot's link must keep working when the page's timers
  // are throttled (background tab) or faked (a test clock).
  #deliver(fn) {
    if (this.latency) setTimeout(fn, this.latency);
    else queueMicrotask(fn);
  }
}

// Two connected in-memory endpoints. Delivery is async and ordered, like an
// ordered reliable DataChannel.
export function localPair({ latency = 0 } = {}) {
  const a = new LocalEnd(latency);
  const b = new LocalEnd(latency);
  a.other = b;
  b.other = a;
  return [a, b];
}
