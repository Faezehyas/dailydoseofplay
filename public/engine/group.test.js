import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "./channel.js";
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
