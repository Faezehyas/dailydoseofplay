import test from "node:test";
import assert from "node:assert/strict";
import { commit, verifyCommit, HashChain, ChainVerifier, SharedRandom, sha256, toHex, FairPlayError, canonical } from "./fair.js";
import { localPair } from "./channel.js";
import { Session, openSession } from "./session.js";

test("commitments verify only the committed value", async () => {
  const fleet = [{ r: 1, c: 2, len: 3, vertical: true }];
  const { commitment, salt } = await commit(fleet);
  assert.equal(await verifyCommit(commitment, fleet, salt), true);
  assert.equal(await verifyCommit(commitment, [{ vertical: true, len: 3, c: 2, r: 1 }], salt), true, "key order is irrelevant");
  assert.equal(await verifyCommit(commitment, [{ r: 1, c: 3, len: 3, vertical: true }], salt), false);
  assert.equal(await verifyCommit(commitment, fleet, "00"), false);
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 0 }] }), '{"a":[2,{"c":0,"d":1}],"b":1}');
});

test("hash chain reveals verify in order and reject forgeries", async () => {
  const chain = await HashChain.create(8);
  const verifier = new ChainVerifier(chain.tip);
  await verifier.accept(1, chain.reveal(1));
  await verifier.accept(2, chain.reveal(2));
  await assert.rejects(verifier.accept(4, chain.reveal(4)), FairPlayError);
  await assert.rejects(verifier.accept(3, toHex(await sha256("forged"))), FairPlayError);
  assert.throws(() => chain.reveal(9), FairPlayError);
});

async function pairOfRandoms() {
  const a = await SharedRandom.create(16);
  const b = await SharedRandom.create(16);
  a.setPeer(b.tip, 0);
  b.setPeer(a.tip, 1);
  const sendA = (k, v) => setTimeout(() => b.receive(k, v));
  const sendB = (k, v) => setTimeout(() => a.receive(k, v));
  return { a, b, sendA, sendB };
}

test("shared random: both peers get the same numbers, draw after draw", async () => {
  const { a, b, sendA, sendB } = await pairOfRandoms();
  for (let k = 0; k < 5; k++) {
    const [ra, rb] = await Promise.all([a.draw(sendA), b.draw(sendB)]);
    const xs = [ra(), ra(), ra()];
    assert.deepEqual([rb(), rb(), rb()], xs);
    assert.ok(xs.every((x) => x >= 0 && x < 1));
  }
});

test("shared random: a peer that changes its value is caught", async () => {
  const { a, b, sendB } = await pairOfRandoms();
  const tamper = async (k) => setTimeout(async () => b.receive(k, toHex(await sha256(`bias-${k}`))));
  await assert.rejects(Promise.all([a.draw(sendB), b.draw(tamper)]), FairPlayError);
});

test("sessions exchange names, buffer early game messages, and agree on rematches", async () => {
  const [x, y] = localPair();
  const [host, guest] = await Promise.all([
    openSession({ channel: x, mode: "friend", index: 0, name: "Ada", game: "demo" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "Bo", game: "demo" }),
  ]);
  assert.ok(host instanceof Session);
  assert.equal(host.opponent.name, "Bo");
  assert.equal(guest.opponent.name, "Ada");
  assert.equal(guest.role, "guest");
  host.send({ t: "early", n: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const got = [];
  guest.onMessage((msg) => got.push(msg));
  assert.deepEqual(got, [{ t: "early", n: 1 }]);

  let started = 0;
  host.on("rematch-start", () => started++);
  guest.on("rematch-start", () => started++);
  host.requestRematch();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(started, 0);
  guest.requestRematch();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(started, 2);

  const ended = new Promise((r) => guest.on("end", r));
  host.leave();
  assert.equal(await ended, "left");
});

test("sessions refuse a peer from another game", async () => {
  const [x, y] = localPair();
  await assert.rejects(
    Promise.all([
      openSession({ channel: x, mode: "friend", index: 0, name: "A", game: "one" }),
      openSession({ channel: y, mode: "friend", index: 1, name: "B", game: "two" }),
    ]),
    /version_mismatch/,
  );
});
