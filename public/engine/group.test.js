import test from "node:test";
import assert from "node:assert/strict";
import { localPair, MAX_MESSAGE_LENGTH, MESSAGE_TOO_BIG } from "./channel.js";
import { localGroup } from "./group.js";
import { admitGuest, startHub, greetHost, matchRouter } from "./session.js";
import { localRoom } from "./room.js";

const tick = () => new Promise((r) => setTimeout(r, 1));

function inboxes(groups) {
  return groups.map((g) => {
    const got = [];
    g.on("message", (msg, from) => got.push([from, msg.n]));
    return got;
  });
}

test("a group delivers every message to every other seat, tagged with the sender, in the hub's order", async () => {
  const groups = localGroup(4);
  assert.deepEqual(groups.map((g) => g.seat), [0, 1, 2, 3]);
  const got = inboxes(groups);
  groups[2].send({ n: 1 });
  groups[0].send({ n: 2 });
  groups[3].send({ n: 3 });
  groups[1].send({ n: 4 });
  await tick();
  // The hub's own message goes out at once; the spokes' reach it in send order.
  const hubOrder = [[0, 2], [2, 1], [3, 3], [1, 4]];
  const others = (seat) => hubOrder.filter(([from]) => from !== seat);
  for (const seat of [0, 1, 2, 3]) assert.deepEqual(got[seat], others(seat), `seat ${seat}`);
});

test("a spoke that drops out is reported to everyone; the hub closing cuts every spoke off", async () => {
  const groups = localGroup(3);
  const left = groups.map((g) => {
    const seats = [];
    g.on("leave", (seat) => seats.push(seat));
    return seats;
  });
  groups[2].close();
  await tick();
  assert.deepEqual(left, [[2], [2], []]);
  const closed = new Promise((r) => groups[1].on("close", r));
  groups[0].close();
  await closed;
});

test("three sessions: names by seat, rematch needs every vote, anyone leaving ends it for all", async () => {
  const sessions = localRoom({ game: "demo", names: ["Ada", "Bo", "Cy"], mode: "friend" });
  assert.deepEqual(sessions.map((s) => s.index), [0, 1, 2]);
  assert.deepEqual(sessions[1].others.map((p) => p.name), ["Ada", "Cy"]);
  assert.equal(sessions[2].me.name, "Cy");

  const got = [];
  sessions[1].onMessage((msg, from) => got.push([from, msg.t]));
  sessions[0].send({ t: "hi" });
  sessions[2].send({ t: "yo" });
  await tick();
  assert.deepEqual(got, [[0, "hi"], [2, "yo"]]);

  let started = 0;
  for (const s of sessions) s.on("rematch-start", () => started++);
  const seen = [];
  sessions[0].on("rematch", (v) => seen.push(v));
  sessions[1].requestRematch();
  sessions[2].requestRematch();
  await tick();
  assert.equal(started, 0);
  assert.deepEqual(seen.at(-1), { me: false, them: true, seats: [1, 2] });
  sessions[0].requestRematch();
  await tick();
  assert.equal(started, 3);

  const ends = sessions.map((s) => new Promise((r) => s.on("end", (reason, seat) => r([reason, seat]))));
  sessions[2].leave();
  assert.deepEqual(await ends[0], ["left", 2]);
  assert.deepEqual(await ends[1], ["left", 2]);
  assert.deepEqual(await ends[2], ["self", 2]);
});

test("handshake: the host admits guests one by one, shows them the roster, then seats them in join order", async () => {
  const [h1, g1] = localPair();
  const [h2, g2] = localPair();
  const rosters = [];
  const guestOne = greetHost(g1, { name: "Bo", game: "demo", onRoster: (names) => rosters.push(names) });
  const first = await admitGuest(h1, { game: "demo" });
  const guestTwo = greetHost(g2, { name: "Cy", game: "demo" });
  const second = await admitGuest(h2, { game: "demo" });
  assert.deepEqual([first, second], ["Bo", "Cy"]);
  h1.send({ t: "$roster", players: ["Ada", "Bo", "Cy"] });
  const hub = startHub({ name: "Ada", guests: [{ link: h1, name: first }, { link: h2, name: second }], game: "demo" });
  // A game message sent right after the start must not be lost.
  hub.send({ t: "go", m: 1 });
  const [bo, cy] = await Promise.all([guestOne, guestTwo]);
  assert.deepEqual(rosters, [["Ada", "Bo", "Cy"]]);
  assert.deepEqual([bo.index, cy.index], [1, 2]);
  assert.deepEqual(cy.players.map((p) => p.name), ["Ada", "Bo", "Cy"]);
  const got = [];
  matchRouter(cy).start({ m: 1, receive: (msg, from) => got.push([from, msg.t]) });
  assert.deepEqual(got, [[0, "go"]]);
});

// A message whose JSON (wrapped as wrap(pad) builds it) is exactly `length` characters.
function sized(length, wrap = (pad) => pad) {
  const msg = { t: "x", pad: "" };
  msg.pad = "a".repeat(length - JSON.stringify(wrap(msg)).length);
  assert.equal(JSON.stringify(wrap(msg)).length, length);
  return msg;
}

function closes(link) {
  const got = [];
  link.on("close", (reason) => got.push(reason));
  return got;
}

test("local pair: a message at the cap arrives; one over it is dropped and the receiving end closes", async () => {
  const [a, b] = localPair();
  const got = [];
  b.on("message", (msg) => got.push(msg.pad.length));
  const [closedA, closedB] = [closes(a), closes(b)];
  const fits = sized(MAX_MESSAGE_LENGTH);
  a.send(fits);
  await tick();
  assert.deepEqual(got, [fits.pad.length]);
  assert.equal(b.open, true);

  a.send(sized(MAX_MESSAGE_LENGTH + 1));
  a.send({ t: "after" });
  await tick();
  assert.deepEqual(got, [fits.pad.length], "neither the oversized message nor anything after it arrives");
  assert.deepEqual(closedB, [MESSAGE_TOO_BIG], "the receiver says why it closed");
  assert.deepEqual(closedA, [undefined], "the sender is just cut off");
  assert.equal(a.open || b.open, false);
});

test("group: a guest whose message is too big to forward is cut off, and everyone else is told why", async () => {
  const groups = localGroup(4);
  const got = inboxes(groups);
  const left = groups.map((g) => {
    const seats = [];
    g.on("leave", (seat, reason) => seats.push([seat, reason]));
    return seats;
  });
  const closed = closes(groups[1]);
  // The guest's frame { msg } just fits through its link to the hub, but the
  // hub's { from, msg } to the others would not: the hub refuses to forward it.
  groups[1].send(sized(MAX_MESSAGE_LENGTH, (msg) => ({ msg })));
  groups[2].send({ n: 1 });
  await tick();
  assert.deepEqual(closed, [undefined], "the sender is cut off from the hub");
  assert.deepEqual(got, [[[2, 1]], [], [], [[2, 1]]], "nobody receives the oversized message");
  assert.deepEqual(left, [[[1, MESSAGE_TOO_BIG]], [], [[1, MESSAGE_TOO_BIG]], [[1, MESSAGE_TOO_BIG]]]);
  // The others play on.
  groups[3].send({ n: 2 });
  await tick();
  assert.deepEqual(got[0].at(-1), [3, 2]);
  assert.deepEqual(got[2].at(-1), [3, 2]);
});

test("group: an oversized message from a guest never reaches the hub's game", async () => {
  const groups = localGroup(2);
  const got = inboxes(groups);
  const left = [];
  groups[0].on("leave", (seat, reason) => left.push([seat, reason]));
  groups[1].send({ n: 1, pad: "a".repeat(MAX_MESSAGE_LENGTH) });
  await tick();
  assert.deepEqual(got, [[], []]);
  assert.deepEqual(left, [[1, MESSAGE_TOO_BIG]]);
});

test("sessions end with message_too_big for the players who refused or were told, from either direction", async () => {
  const big = { t: "spam", pad: "a".repeat(MAX_MESSAGE_LENGTH) };
  const ends = (sessions) => sessions.map((s) => new Promise((r) => s.on("end", (reason, seat) => r([reason, seat]))));

  // A guest sends it: the host refuses, the third player hears why.
  let sessions = localRoom({ game: "demo", names: ["Ada", "Bo", "Cy"], mode: "friend" });
  let ended = ends(sessions);
  sessions[2].send(big);
  assert.deepEqual(await ended[0], [MESSAGE_TOO_BIG, 2]);
  assert.deepEqual(await ended[1], [MESSAGE_TOO_BIG, 2]);
  assert.deepEqual(await ended[2], ["closed", 0], "the sender only sees the host go");

  // The host sends it: every guest refuses it.
  sessions = localRoom({ game: "demo", names: ["Ada", "Bo", "Cy"], mode: "friend" });
  ended = ends(sessions);
  sessions[0].send(big);
  assert.deepEqual(await ended[1], [MESSAGE_TOO_BIG, 0]);
  assert.deepEqual(await ended[2], [MESSAGE_TOO_BIG, 0]);
  assert.deepEqual((await ended[0])[0], "closed");
});

test("handshake: an oversized message before the start fails it with message_too_big", async () => {
  const [h, g] = localPair();
  const guest = greetHost(g, { name: "Bo", game: "demo" });
  await admitGuest(h, { game: "demo" });
  h.send({ t: "$roster", players: ["a".repeat(MAX_MESSAGE_LENGTH)] });
  await assert.rejects(guest, { message: MESSAGE_TOO_BIG });

  const [h2, g2] = localPair();
  const admitted = admitGuest(h2, { game: "demo" });
  g2.send({ t: "$hello", name: "a".repeat(MAX_MESSAGE_LENGTH), game: "demo", v: 2 });
  await assert.rejects(admitted, { message: MESSAGE_TOO_BIG });
});
