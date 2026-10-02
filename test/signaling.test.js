// Integration: two real clients (the same RoomClient the browser uses) create
// and join a room through the running signaling server, relay signals, and
// see each other leave. Node 22+ provides the global WebSocket.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";
import { RoomClient } from "../public/engine/signaling.js";

const once = (emitter, type) => new Promise((resolve) => emitter.on(type, resolve));

test("host creates a room, friend joins with the code, signals relay both ways", async (t) => {
  const srv = await startServer();
  const host = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  const friend = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  t.after(async () => {
    host.close();
    friend.close();
    await srv.close();
  });
  await Promise.all([host.connect(), friend.connect()]);

  const created = await host.create("Ada");
  assert.match(created.room, /^[A-Z2-9]{4}$/);
  assert.equal(created.game, "sea-battle");

  const peerJoined = once(host, "peer");
  const joined = await friend.join(created.room.toLowerCase(), "Bo");
  assert.equal(joined.room, created.room);
  assert.equal(joined.host, host.id);
  assert.deepEqual(joined.peers.map((p) => p.name).sort(), ["Ada", "Bo"]);
  assert.deepEqual(await peerJoined, { id: friend.id, name: "Bo" });

  const health = await (await fetch(`${srv.base}/healthz`)).json();
  assert.equal(health.rooms, 1);
  assert.equal(health.players, 2);
  assert.deepEqual(health.games, { "sea-battle": 1 });

  // SDP/ICE relay is opaque: whatever goes in comes out, tagged with the sender.
  const atFriend = once(friend, "signal");
  host.signal(friend.id, { sdp: { type: "offer", sdp: "v=0 fake" } });
  assert.deepEqual(await atFriend, { from: host.id, data: { sdp: { type: "offer", sdp: "v=0 fake" } } });
  const atHost = once(host, "signal");
  friend.signal(host.id, { candidate: { candidate: "fake", sdpMid: "0" } });
  assert.deepEqual(await atHost, { from: friend.id, data: { candidate: { candidate: "fake", sdpMid: "0" } } });

  // A third player is turned away: two-player game.
  const third = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  await third.connect();
  await assert.rejects(third.join(created.room, "Cy"), (err) => err.code === "room_full");
  third.close();

  // Friend leaves; host is told. Host leaves; room closes.
  const left = once(host, "leave");
  friend.close();
  assert.deepEqual(await left, { id: friend.id });
  host.leave();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await (await fetch(`${srv.base}/healthz`)).json()).rooms, 0);
});

test("rooms are scoped by game slug and unknown games are refused", async (t) => {
  const srv = await startServer();
  const a = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  const b = new RoomClient({ game: "tic-tac-toe", url: srv.wsUrl });
  const c = new RoomClient({ game: "not-a-game", url: srv.wsUrl });
  t.after(async () => {
    a.close();
    b.close();
    c.close();
    await srv.close();
  });
  await Promise.all([a.connect(), b.connect(), c.connect()]);
  const { room } = await a.create("A");
  await assert.rejects(b.join(room, "B"), (err) => err.code === "no_such_room");
  await assert.rejects(c.create("C"), (err) => err.code === "bad_game");
  await assert.rejects(c.join(room, "C"), (err) => err.code === "bad_game");
});

test("host leaving closes the room for the guest", async (t) => {
  const srv = await startServer();
  const host = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  const guest = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  t.after(async () => {
    guest.close();
    await srv.close();
  });
  await Promise.all([host.connect(), guest.connect()]);
  const { room } = await host.create("H");
  await guest.join(room, "G");
  const gone = once(guest, "host-left");
  host.close();
  await gone;
  const late = new RoomClient({ game: "sea-battle", url: srv.wsUrl });
  await late.connect();
  await assert.rejects(late.join(room, "L"), (err) => err.code === "no_such_room");
  late.close();
});

test("malformed traffic gets error replies, not crashes", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const ws = new WebSocket(srv.wsUrl);
  const replies = [];
  ws.onmessage = (e) => replies.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  ws.send("not json");
  ws.send(JSON.stringify({ t: "signal", to: "999", data: {} }));
  ws.send(JSON.stringify({ t: "nope" }));
  ws.send(JSON.stringify({ t: "ping" }));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(
    replies.map((m) => m.code || m.t),
    ["hello", "bad_json", "not_in_room", "unknown_type", "pong"],
  );
  ws.close();
  assert.equal((await fetch(`${srv.base}/healthz`)).status, 200);
});
