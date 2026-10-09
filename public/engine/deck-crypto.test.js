import test from "node:test";
import assert from "node:assert/strict";
import { loadDeckCrypto } from "./deck-crypto.js";
import { DeckError, CARD_BYTES, PK_BYTES, HELLO_BYTES, SHARE_BYTES, SECRET_BYTES, MAX_DECK } from "./deck-service.js";

const deck = await loadDeckCrypto();
const ctx = (seat) => `test/seat${seat}`;

function table(n) {
  const keys = Array.from({ length: n }, (_, s) => deck.keygen(ctx(s)));
  const { joint, pks } = deck.joinKeys(keys.map((k, s) => ({ hello: k.hello, context: ctx(s) })));
  return { keys, joint, pks };
}

function shuffled(t, size) {
  let cards = deck.newDeck(size);
  t.keys.forEach((k, s) => {
    const out = deck.shuffle(t.joint, k.secret, cards);
    cards = deck.verifyShuffle(t.joint, s, cards, out.proof);
  });
  return cards;
}

function openAll(t, card) {
  const shares = t.keys.map((k) => deck.shares(k.secret, [card])[0]);
  return deck.open(t.joint, card, shares.map((share, s) => ({ pk: t.pks[s], share })));
}

const rejects = (f, re, at) => {
  assert.throws(f, (err) => {
    assert.ok(err instanceof DeckError, `a DeckError, got ${err?.name}: ${err?.message}`);
    if (re) assert.match(err.message, re);
    if (at !== undefined) assert.equal(err.at, at);
    return true;
  });
};

test("keys: sizes, and the joint key checks each key's proof and its context", () => {
  const t = table(3);
  assert.equal(t.keys[0].secret.length, SECRET_BYTES);
  assert.equal(t.keys[0].hello.length, HELLO_BYTES);
  assert.deepEqual(t.pks[1], t.keys[1].hello.slice(0, PK_BYTES));
  const hellos = t.keys.map((k, s) => ({ hello: k.hello, context: ctx(s) }));
  rejects(() => deck.joinKeys([hellos[0], { ...hellos[1], context: ctx(2) }]), /Schnorr/, 1);
  rejects(() => deck.joinKeys([hellos[0], hellos[1], { ...hellos[1] }]), /twice/, 2);
  rejects(() => deck.joinKeys([hellos[0], { hello: new Uint8Array(98).fill(7), context: ctx(1) }]), undefined, 1);
});

test("deck: a shuffled deck holds every card once, and each player's shuffle is checked", () => {
  const t = table(3);
  rejects(() => deck.newDeck(0));
  rejects(() => deck.newDeck(MAX_DECK + 1));
  const start = deck.newDeck(12);
  assert.equal(start.length, 12);
  assert.ok(start.every((c) => c.length === CARD_BYTES));
  const cards = shuffled(t, 12);
  const faces = cards.map((c) => openAll(t, c));
  assert.deepEqual([...faces].sort((a, b) => a - b), [...Array(12).keys()]);
  assert.notDeepEqual(faces, [...Array(12).keys()], "shuffled (fails 1 time in 12!)");

  const out = deck.shuffle(t.joint, t.keys[1].secret, cards);
  assert.deepEqual(deck.verifyShuffle(t.joint, 1, cards, out.proof), out.cards, "the shuffler and the checkers hold the same cards");
  rejects(() => deck.verifyShuffle(t.joint, 2, cards, out.proof), /Incorrect player/);
  rejects(() => deck.verifyShuffle(t.joint, 1, start, out.proof));
  const swapped = out.proof.slice();
  swapped.set(out.proof.slice(8 + CARD_BYTES, 8 + 2 * CARD_BYTES), 8); // a card copied over another
  rejects(() => deck.verifyShuffle(t.joint, 1, cards, swapped));
  for (const n of [1, 2, 3]) assert.equal(shuffled(t, n).length, n, `${n} cards`);
});

test("shares: tied to the seat that sent them and to their card; a card opens only with every share", () => {
  const t = table(3);
  const cards = shuffled(t, 6);
  const [a, b] = deck.shares(t.keys[1].secret, cards.slice(0, 2));
  assert.equal(a.length, SHARE_BYTES);
  deck.verifyShares(t.joint, [{ card: cards[0], pk: t.pks[1], share: a }]);
  rejects(() => deck.verifyShares(t.joint, [{ card: cards[0], pk: t.pks[1], share: a }, { card: cards[0], pk: t.pks[2], share: a }]), /Chaum-Pedersen/, 1);
  rejects(() => deck.verifyShares(t.joint, [{ card: cards[0], pk: t.pks[1], share: b }]), /Chaum-Pedersen/, 0);
  const shares = t.keys.map((k) => deck.shares(k.secret, [cards[0]])[0]);
  rejects(() => deck.open(t.joint, cards[0], shares.slice(0, 2).map((share, s) => ({ pk: t.pks[s], share }))), /missing/);
  rejects(() => deck.open(t.joint, cards[0], shares.map((share) => ({ pk: t.pks[0], share }))), undefined, 1);
  assert.equal(deck.open(t.joint, cards[0], shares.map((share, s) => ({ pk: t.pks[s], share }))), openAll(t, cards[0]));
});

test("audit: revealed keys are checked against the keys played, and open every card", () => {
  const t = table(2);
  const cards = shuffled(t, 8);
  assert.equal(deck.checkSecret(t.keys[0].secret, ctx(0), t.pks[0]), true);
  assert.equal(deck.checkSecret(t.keys[1].secret, ctx(0), t.pks[0]), false);
  assert.equal(deck.checkSecret(new Uint8Array(SECRET_BYTES).fill(1), ctx(0), t.pks[0]), false);
  assert.equal(deck.checkSecret(new Uint8Array(3), ctx(0), t.pks[0]), false);
  const faces = deck.faces(t.joint, t.keys.map((k) => k.secret), cards);
  assert.deepEqual(faces, cards.map((c) => openAll(t, c)));
});

test("garbage bytes are a DeckError; anything but bytes is our own bug, not theirs", () => {
  const t = table(2);
  const cards = shuffled(t, 4);
  const junk = [new Uint8Array(0), new Uint8Array(7), new Uint8Array(300).fill(255)];
  const calls = {
    joinKeys: (j) => deck.joinKeys([{ hello: j, context: "x" }]),
    shuffle: (j) => deck.shuffle(j, t.keys[0].secret, cards),
    shuffleKey: (j) => deck.shuffle(t.joint, j, cards),
    verifyShuffle: (j) => deck.verifyShuffle(t.joint, 0, cards, j),
    shares: (j) => deck.shares(t.keys[0].secret, [j]),
    verifyShares: (j) => deck.verifyShares(t.joint, [{ card: cards[0], pk: t.pks[0], share: j }]),
    open: (j) => deck.open(t.joint, j, []),
    faces: (j) => deck.faces(t.joint, [j], cards),
  };
  for (const [name, f] of Object.entries(calls)) {
    for (const j of junk) assert.throws(() => f(j), DeckError, name);
  }
  assert.throws(() => deck.shares(t.keys[0].secret, null), TypeError);
  // Still works afterwards.
  assert.equal(shuffled(t, 4).length, 4);
});
