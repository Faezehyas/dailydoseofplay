// Integration: two real clients (the same RoomClient the browser uses) create
// and join a room through the running signaling server, relay signals, and
// see each other leave. Node 22+ provides the global WebSocket.
import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startServer } from "./helpers.js";
import { RoomClient } from "../public/engine/signaling.js";

const once = (emitter, type) => new Promise((resolve) => emitter.on(type, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clients(t, srv, game, n) {
  const list = Array.from({ length: n }, () => new RoomClient({ game, url: srv.wsUrl }));
  t.after(() => list.forEach((c) => c.close()));
  await Promise.all(list.map((c) => c.connect()));
  return list;
}

// A raw socket (the ws package can set headers) that collects every reply.
async function rawSocket(t, srv, headers = {}) {
  const ws = new WebSocket(srv.wsUrl, { headers });
  const replies = [];
  ws.on("message", (data) => replies.push(JSON.parse(data)));
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => (ws.once("open", resolve), ws.once("error", reject)));
  const ask = async (msg) => {
    const before = replies.length;
    ws.send(JSON.stringify(msg));
    for (let i = 0; i < 100 && replies.length === before; i++) await sleep(10);
    return replies[before];
  };
  return { ws, replies, ask, closed: new Promise((resolve) => ws.once("close", resolve)) };
}

const guess = (sock, room) => sock.ask({ t: "join", game: "sea-battle", room, name: "X" });

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
  assert.match(created.key, /^[A-Za-z0-9_-]{22}$/, "128-bit base64url invite key");
  assert.equal(created.game, "sea-battle");

  const peerJoined = once(host, "peer");
  const joined = await friend.join(created.room.toLowerCase(), "Bo", created.key);
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
  const { room, key } = await host.create("H");
  await guest.join(room, "G", key);
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

test("the 6th wrong code within a minute is refused and closes the connection; the budget is shared per IP", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host] = await clients(t, srv, "sea-battle", 1);
  const { room, key } = await host.create("H");
  const wrong = room === "ZZZZ" ? "YYYY" : "ZZZZ";

  const a = await rawSocket(t, srv);
  for (let i = 0; i < 5; i++) assert.equal((await guess(a, wrong)).code, "no_such_room", `guess ${i + 1}`);
  // The 6th try is refused even for a real code, so it can't tell rooms apart.
  assert.equal((await guess(a, room)).code, "rate_limited");
  await a.closed;

  // A new connection from the same address has no budget left either.
  const b = await rawSocket(t, srv);
  assert.equal((await guess(b, wrong)).code, "rate_limited");
  await b.closed;

  // The right key is never a guess, so it still gets in.
  const c = await rawSocket(t, srv);
  assert.equal((await c.ask({ t: "join", game: "sea-battle", room, key, name: "Bo" })).t, "joined");
});

test("rate limits: the client-IP header picks the bucket, CLIENT_IP_HEADER overrides it, and the window slides", async (t) => {
  const srv = await startServer({ limits: { windowMs: 300 } });
  t.after(() => srv.close());
  const spend = async (headers) => {
    const sock = await rawSocket(t, srv, headers);
    for (let i = 0; i < 5; i++) await guess(sock, "ZZZZ");
    return sock;
  };
  await spend({ "X-Forwarded-For": "203.0.113.7, 10.0.0.1" });
  const same = await rawSocket(t, srv, { "X-Forwarded-For": "203.0.113.7" });
  assert.equal((await guess(same, "ZZZZ")).code, "rate_limited");
  const other = await rawSocket(t, srv, { "X-Forwarded-For": "198.51.100.2" });
  assert.equal((await guess(other, "ZZZZ")).code, "no_such_room");
  await sleep(350);
  const later = await rawSocket(t, srv, { "X-Forwarded-For": "203.0.113.7" });
  assert.equal((await guess(later, "ZZZZ")).code, "no_such_room", "budget back after the window");

  const custom = await startServer({ clientIpHeader: "Fly-Client-IP" });
  t.after(() => custom.close());
  const first = await rawSocket(t, custom, { "Fly-Client-IP": "192.0.2.1", "X-Forwarded-For": "198.51.100.9" });
  for (let i = 0; i < 5; i++) await guess(first, "ZZZZ");
  const sameIp = await rawSocket(t, custom, { "Fly-Client-IP": "192.0.2.1", "X-Forwarded-For": "198.51.100.10" });
  assert.equal((await guess(sameIp, "ZZZZ")).code, "rate_limited");
  const newIp = await rawSocket(t, custom, { "Fly-Client-IP": "192.0.2.2", "X-Forwarded-For": "198.51.100.9" });
  assert.equal((await guess(newIp, "ZZZZ")).code, "no_such_room");
});

test("a wrong invite key counts as a guess", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host] = await clients(t, srv, "sea-battle", 1);
  const { room, key } = await host.create("H");
  let knocked = false;
  host.on("knock", () => (knocked = true));
  const sock = await rawSocket(t, srv);
  const bad = key.replace(/^./, (c) => (c === "A" ? "B" : "A"));
  for (let i = 0; i < 5; i++) {
    assert.equal((await sock.ask({ t: "join", game: "sea-battle", room, key: bad, name: "X" })).code, "no_such_room");
  }
  assert.equal((await sock.ask({ t: "join", game: "sea-battle", room, key: bad, name: "X" })).code, "rate_limited");
  await sock.closed;
  assert.equal(knocked, false, "the host is never bothered by wrong keys");
});

test("a code-only join waits for the host: Accept seats it, Decline closes it", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, bo, cy] = await clients(t, srv, "ludo", 3);
  const { room } = await host.create("Ada");
  const peers = [];
  host.on("peer", (p) => peers.push(p));

  const knock = once(host, "knock");
  const knocking = once(bo, "knocking");
  const boJoined = bo.join(room, "Bo");
  await knocking;
  assert.deepEqual(await knock, { id: bo.id, name: "Bo" });
  // Waiting at the door: no peer for the host, no relay to anyone.
  const door = await rawSocket(t, srv);
  const doorKnock = once(host, "knock");
  assert.deepEqual(await door.ask({ t: "join", game: "ludo", room, name: "Dee" }), { t: "knocking", game: "ludo", room });
  const { id: deeId } = await doorKnock;
  assert.equal((await door.ask({ t: "signal", to: host.id, data: { sdp: "nope" } })).code, "not_in_room");
  assert.deepEqual(peers, []);
  assert.equal((await (await fetch(`${srv.base}/healthz`)).json()).players, 1);
  host.decline(deeId);
  await door.closed;
  assert.deepEqual(door.replies.at(-1), { t: "error", code: "declined" });

  host.admit(bo.id);
  const joined = await boJoined;
  assert.equal(joined.host, host.id);
  await sleep(20);
  assert.deepEqual(peers, [{ id: bo.id, name: "Bo" }]);

  const cyKnock = once(host, "knock");
  const cyJoined = cy.join(room, "Cy");
  await cyKnock;
  const cyClosed = once(cy, "close");
  host.decline(cy.id);
  await assert.rejects(cyJoined, (err) => err.code === "declined");
  await cyClosed;
  assert.equal(peers.length, 1);
});

test("an unanswered knock times out, a withdrawn one disappears, and only the host may answer", async (t) => {
  const srv = await startServer({ limits: { approvalMs: 150 } });
  t.after(() => srv.close());
  const [host, guest, knocker, quitter] = await clients(t, srv, "ludo", 4);
  const { room, key } = await host.create("Ada");
  await guest.join(room, "Bo", key);

  const knock = once(host, "knock");
  const pending = knocker.join(room, "Cy");
  const { id } = await knock;
  const notHost = once(guest, "error");
  guest.admit(id);
  assert.equal((await notHost).code, "not_host");
  const gone = once(host, "knock-gone");
  await assert.rejects(pending, (err) => err.code === "no_answer");
  assert.deepEqual(await gone, { id });

  const quitKnock = once(host, "knock");
  quitter.join(room, "Dee").catch(() => {});
  await quitKnock;
  const quitGone = once(host, "knock-gone");
  quitter.close();
  assert.deepEqual(await quitGone, { id: quitter.id });
});

test("the host closing the room tells anyone still knocking", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, knocker] = await clients(t, srv, "sea-battle", 2);
  const { room } = await host.create("Ada");
  const knock = once(host, "knock");
  const pending = knocker.join(room, "Bo");
  await knock;
  host.close();
  await assert.rejects(pending, (err) => err.code === "host_left");
});

test("a 4-seat room admits keyed guests in join order until it is full", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const [host, ...guests] = await clients(t, srv, "ludo", 5);
  const { room, key } = await host.create("Ada");
  const names = ["Bo", "Cy", "Dee"];
  for (const [i, name] of names.entries()) {
    const joined = await guests[i].join(room, name, key);
    assert.deepEqual(joined.peers.map((p) => p.name), ["Ada", ...names.slice(0, i + 1)]);
  }
  await assert.rejects(guests[3].join(room, "Eve", key), (err) => err.code === "room_full");
  await assert.rejects(guests[3].join(room, "Eve"), (err) => err.code === "room_full", "no knocking on a full room");
  const health = await (await fetch(`${srv.base}/healthz`)).json();
  assert.equal(health.players, 4);
});
