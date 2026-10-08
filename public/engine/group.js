// A group is how the players of one game reach each other. Everything above
// this file (Session, matches, robots) talks only to this interface, so the
// way messages travel can change without touching games:
//
//   group.seat                       my seat, 0..n-1 (seat 0 is the room creator)
//   group.send(msg)                  deliver msg to every other seat
//   group.on("message", (msg, from)) a message from seat `from`
//   group.on("leave", seat, reason)  that seat's connection is gone
//   group.on("close", reason)        I am cut off from every other seat
//   group.close()
//
// reason is MESSAGE_TOO_BIG (channel.js) when a link was closed because the
// other end sent an oversized message; otherwise it is undefined.
//
// Today's layout is a star: seat 0 (the hub) holds one link to each other
// seat (a spoke) and forwards every message to everyone else, so all players
// see other players' messages in the hub's order. A link is any two-ended
// channel: a PeerChannel (WebRTC) or one end of localPair().
import { Emitter, localPair, MAX_MESSAGE_LENGTH, MESSAGE_TOO_BIG } from "./channel.js";

// Wire frames: spoke -> hub { msg }; hub -> spoke { from, msg } or { left, reason? }.
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
        link.on("close", (reason) => this.#drop(seat, reason)),
      );
    }
  }

  send(msg) {
    this.#relay(this.seat, msg);
    return true;
  }

  #relay(from, msg) {
    // The forwarded frame is a little longer than the one that arrived, so it is
    // measured again: an oversized one cuts off its sender, not the receivers.
    if (from !== this.seat && JSON.stringify({ from, msg }).length > MAX_MESSAGE_LENGTH) {
      return this.links.get(from)?.close(MESSAGE_TOO_BIG);
    }
    for (const [seat, link] of this.links) if (seat !== from) link.send({ from, msg });
    if (from !== this.seat) this.emit("message", msg, from);
  }

  #drop(seat, reason) {
    if (!this.links.delete(seat)) return;
    const frame = reason === MESSAGE_TOO_BIG ? { left: seat, reason } : { left: seat };
    for (const link of this.links.values()) link.send(frame);
    this.emit("leave", seat, frame.reason);
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
        if (Number.isInteger(frame.left)) this.emit("leave", frame.left, frame.reason === MESSAGE_TOO_BIG ? MESSAGE_TOO_BIG : undefined);
        else if ("msg" in frame && Number.isInteger(frame.from)) this.emit("message", frame.msg, frame.from);
      }),
      link.on("close", (reason) => this.#closed(reason)),
    ];
  }

  send(msg) {
    return this.link.send({ msg });
  }

  #closed(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.offs.splice(0)) off();
    this.emit("close", reason);
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
