// How players find each other and end up seated in one group (group.js).
// The lobby UI only uses the three entry points below, so the transport (a
// star over WebRTC today; a server relay or a mesh later) can change without
// touching the lobby or any game.
//
//   new HostRoom({ game, name })        open() -> code; emits "players", "guest-gone", "lost"; start() -> Session
//   new GuestRoom({ game, code, name }) join() -> Session once the host starts; emits "status"
//   localRoom({ game, names, mode })    one Session per seat, connected in memory (robots, tests)
import { Emitter } from "./channel.js";
import { RoomClient } from "./signaling.js";
import { PeerChannel } from "./peer.js";
import { localGroup } from "./group.js";
import { Session, admitGuest, startHub, sendRoster, greetHost } from "./session.js";

// A failure after the room was found: the lobby explains these differently
// from signaling errors (SignalingError: no_such_room, room_full, ...).
export class RoomError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // no_direct_link | host_gone | host_left | version_mismatch | lobby_lost
  }
}

export class HostRoom extends Emitter {
  constructor({ game, name, signalingUrl }) {
    super();
    this.game = game;
    this.name = name;
    this.signalingUrl = signalingUrl;
    this.rooms = null;
    this.code = null;
    this.guests = new Map(); // signaling id -> { name, link, ready }, in join order
    this.started = false;
    this.closed = false;
  }

  async open() {
    const rooms = new RoomClient({ game: this.game, url: this.signalingUrl });
    this.rooms = rooms;
    await rooms.connect();
    rooms.on("close", () => !this.started && !this.closed && this.emit("lost"));
    const { room } = await rooms.create(this.name);
    this.code = room;
    rooms.on("peer", ({ id, name }) => this.#link(id, name));
    rooms.on("leave", ({ id }) => this.#drop(id, "left"));
    return room;
  }

  // Everyone in the room so far, host first. ready: connected and checked.
  get players() {
    return [{ name: this.name, ready: true }, ...[...this.guests.values()].map(({ name, ready }) => ({ name, ready }))];
  }

  get readyGuests() {
    return [...this.guests.values()].filter((g) => g.ready);
  }

  #link(id, name) {
    if (this.started || this.closed) return;
    const link = new PeerChannel({ rooms: this.rooms, peerId: id, initiator: true });
    const guest = { name, link, ready: false };
    this.guests.set(id, guest);
    link.on("failed", (reason) => this.#drop(id, reason));
    link.on("close", () => this.#drop(id, "left"));
    link.on("open", async () => {
      try {
        guest.name = await admitGuest(link, { game: this.game });
      } catch (err) {
        return this.#drop(id, err.message);
      }
      if (this.guests.get(id) !== guest || this.started) return;
      guest.ready = true;
      this.#changed();
    });
    this.#changed();
  }

  #drop(id, reason) {
    const guest = this.guests.get(id);
    if (!guest || this.started) return;
    this.guests.delete(id);
    guest.link.close();
    this.#changed();
    this.emit("guest-gone", { name: guest.name, reason, wasReady: guest.ready });
  }

  #changed() {
    const players = this.players;
    sendRoster(this.readyGuests, players.filter((p) => p.ready).map((p) => p.name));
    this.emit("players", players);
  }

  // Seats the connected guests in join order. Guests still connecting are dropped.
  start() {
    const guests = this.readyGuests;
    if (this.started || guests.length === 0) throw new Error("no players to start with");
    this.started = true;
    for (const g of this.guests.values()) if (!g.ready) g.link.close();
    const session = startHub({ name: this.name, guests, game: this.game });
    // The room is complete: free it on the server.
    this.rooms.close();
    this.rooms = null;
    return session;
  }

  close() {
    this.closed = true;
    if (!this.started) for (const g of this.guests.values()) g.link.close();
    this.guests.clear();
    this.rooms?.close();
    this.rooms = null;
  }
}

export class GuestRoom extends Emitter {
  constructor({ game, code, name, signalingUrl }) {
    super();
    this.game = game;
    this.code = String(code).trim().toUpperCase();
    this.name = name;
    this.signalingUrl = signalingUrl;
    this.rooms = null;
    this.link = null;
  }

  // Emits "status" with { step: "connecting", host }, { step: "connected" },
  // then { step: "waiting", players } while the host waits for more players.
  async join() {
    const rooms = new RoomClient({ game: this.game, url: this.signalingUrl });
    this.rooms = rooms;
    await rooms.connect();
    const joined = await rooms.join(this.code, this.name);
    const host = joined.peers.find((p) => p.id === joined.host);
    this.emit("status", { step: "connecting", host: host?.name });
    const link = new PeerChannel({ rooms, peerId: joined.host, initiator: false });
    this.link = link;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code) => {
        if (settled) return;
        settled = true;
        this.close();
        reject(new RoomError(code));
      };
      // The host frees the room once the game starts, which can be just before our link opens.
      rooms.on("host-left", () => !link.open && fail("host_left"));
      rooms.on("close", () => !link.open && fail("lobby_lost"));
      link.on("failed", (reason) => fail(reason === "closed_before_open" ? "host_gone" : "no_direct_link"));
      link.on("open", () => {
        this.emit("status", { step: "connected" });
        greetHost(link, {
          name: this.name,
          game: this.game,
          onRoster: (players) => this.emit("status", { step: "waiting", players }),
        }).then(
          (session) => {
            if (settled) return session.leave();
            settled = true;
            this.rooms?.close();
            this.rooms = null;
            resolve(session);
          },
          (err) => fail(err.message === "version_mismatch" ? "version_mismatch" : err.message === "closed" ? "host_gone" : "no_direct_link"),
        );
      });
    });
  }

  close() {
    this.link?.close();
    this.rooms?.close();
    this.rooms = null;
  }
}

export function localRoom({ game, names, mode = "robot" }) {
  return localGroup(names.length).map((group) => new Session({ group, mode, players: names, game }));
}
