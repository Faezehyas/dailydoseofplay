// A group is how the players of one game reach each other. Everything above
// this file (Session, matches, robots) talks only to this interface, so the
// way messages travel can change without touching games:
//
//   group.seat                       my seat, 0..n-1 (seat 0 is the room creator)
//   group.send(msg)                  deliver msg to every other seat
//   group.on("message", (msg, from)) a message from seat `from`
//   group.on("leave", seat)          that seat's connection is gone
//   group.on("close")                I am cut off from every other seat
//   group.close()
//
// Today's layout is a star: seat 0 (the hub) holds one link to each other
// seat (a spoke) and forwards every message to everyone else, so all players
// see other players' messages in the hub's order. A link is any two-ended
// channel: a PeerChannel (WebRTC) or one end of localPair().
import { Emitter, localPair } from "./channel.js";

// Wire frames: spoke -> hub { msg }; hub -> spoke { from, msg } or { left }.
export class HubGroup extends Emitter {
  constructor({ links }) {
    super();
    this.seat = 0;
    this.links = new Map(links); // seat -> link
    this.offs = [];
    for (const [seat, link] of this.links) {
      this.offs.push(
        link.on("message", (frame) => {
          if (frame && typeof frame === "object" && "msg" in frame) this.#relay(seat, frame.msg);
        }),
        link.on("close", () => this.#drop(seat)),
      );
    }
  }

  send(msg) {
    this.#relay(this.seat, msg);
    return true;
  }

  #relay(from, msg) {
    for (const [seat, link] of this.links) if (seat !== from) link.send({ from, msg });
    if (from !== this.seat) this.emit("message", msg, from);
  }

  #drop(seat) {
    if (!this.links.delete(seat)) return;
    for (const link of this.links.values()) link.send({ left: seat });
    this.emit("leave", seat);
  }

  close() {
    for (const off of this.offs.splice(0)) off();
    const links = [...this.links.values()];
    this.links.clear();
    for (const link of links) link.close();
    this.emit("close");
  }
}

export class SpokeGroup extends Emitter {
  constructor({ seat, link }) {
    super();
    this.seat = seat;
    this.link = link;
    this.closed = false;
    this.offs = [
      link.on("message", (frame) => {
        if (!frame || typeof frame !== "object") return;
        if (Number.isInteger(frame.left)) this.emit("leave", frame.left);
        else if ("msg" in frame && Number.isInteger(frame.from)) this.emit("message", frame.msg, frame.from);
      }),
      link.on("close", () => this.#closed()),
    ];
  }

  send(msg) {
    return this.link.send({ msg });
  }

  #closed() {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.offs.splice(0)) off();
    this.emit("close");
  }

  close() {
    this.link.close();
    this.#closed();
  }
}

// n connected in-memory group ends (robot games and tests), indexed by seat.
export function localGroup(n, { latency = 0 } = {}) {
  const links = new Map();
  const spokes = [];
  for (let seat = 1; seat < n; seat++) {
    const [hubEnd, spokeEnd] = localPair({ latency });
    links.set(seat, hubEnd);
    spokes.push(new SpokeGroup({ seat, link: spokeEnd }));
  }
  return [new HubGroup({ links }), ...spokes];
}
