// The deck cryptography over the vendored mental-poker WebAssembly, bytes in
// and bytes out (see ARCHITECTURE.md "Card games"). Synchronous: deck-service.js
// runs it in a worker.
import init, * as lib from "./vendor/mental-poker/cards_play.js";
import { DeckError, CARD_BYTES, PK_BYTES, HELLO_BYTES, SECRET_BYTES, SHARE_BYTES, MAX_DECK } from "./deck-service.js";

export { DeckError };

const LEN_BYTES = 8; // arkworks' u64 length before a list

const enc = new TextEncoder();

function why(err) {
  try {
    return err.as_js_error().message;
  } catch {
    return "rejected";
  }
}

// Runs f, freeing the library objects it registers with own(). The library
// rejecting an input, or trapping on it, becomes a DeckError.
function guard(f, at) {
  const owned = [];
  let crashed = false;
  try {
    return f((obj) => (owned.push(obj), obj));
  } catch (err) {
    if (err instanceof DeckError) {
      crashed = err.crashed;
      throw err;
    }
    if (err instanceof WebAssembly.RuntimeError) {
      crashed = true;
      throw new DeckError(`crypto crashed: ${err.message}`, { at, crashed });
    }
    if (err instanceof lib.CardsError) throw new DeckError(why(err), { at });
    throw err;
  } finally {
    // After a trap the objects are still borrowed and freeing them throws.
    if (!crashed) for (const obj of owned) obj.free();
  }
}

const u32 = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function checkLength(bytes, n, what) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== n) throw new DeckError(`bad ${what}`);
}

// A list of cards as the library's MaskedCards bytes.
function deckBytes(cards) {
  const head = new Uint8Array(LEN_BYTES);
  new DataView(head.buffer).setBigUint64(0, BigInt(cards.length), true);
  return concat([head, ...cards]);
}

function splitDeck(bytes, n) {
  if (bytes.length < LEN_BYTES + n * CARD_BYTES) throw new DeckError("short deck");
  if (new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(0, true) !== BigInt(n)) throw new DeckError("deck size changed");
  return Array.from({ length: n }, (_, i) => bytes.slice(LEN_BYTES + i * CARD_BYTES, LEN_BYTES + (i + 1) * CARD_BYTES));
}

export function createDeckCrypto() {
  const loadJoint = (own, joint) => own(lib.AggregatedPublicKeys.deserialize(joint));
  const loadKey = (own, secret) => {
    checkLength(secret, SECRET_BYTES, "secret key");
    return own(lib.PlayerKeypair.deserialize(secret));
  };

  // The library's reveal message: the sender's key, the card, the share.
  const revealMessage = (pk, card, share) => {
    checkLength(pk, PK_BYTES, "public key");
    checkLength(card, CARD_BYTES, "card");
    checkLength(share, SHARE_BYTES, "share");
    return concat([pk, card, share]);
  };

  return {
    // context binds the key to one seat of one match (see card-match.js).
    keygen(context) {
      return guard((own) => {
        const kp = own(new lib.PlayerKeypair());
        return { secret: kp.serialize(), hello: kp.prove_player(enc.encode(context)) };
      });
    },

    // players: [{ hello, context }] in seat order. Checks every key proof.
    // Returns the joint key and each seat's public key.
    joinKeys(players) {
      const pks = players.map(({ hello }, at) =>
        guard(() => {
          checkLength(hello, HELLO_BYTES, "key");
          return lib.verify_player(hello, enc.encode(players[at].context));
        }, at),
      );
      pks.forEach((pk, at) => {
        if (pks.findIndex((other) => same(other, pk)) !== at) throw new DeckError("a key is used twice", { at });
      });
      return guard((own) => {
        const buf = concat([u32(players.length), ...players.flatMap(({ hello, context }) => [u32(hello.length), hello, u32(enc.encode(context).length), enc.encode(context)])]);
        return { joint: own(lib.AggregatedPublicKeys.buildFromHellos(buf)).serialize(), pks };
      });
    },

    // The cards 0..n-1 face up (no randomness yet): the first shuffle hides them.
    newDeck(n) {
      if (!Number.isInteger(n) || n < 1 || n > MAX_DECK) throw new DeckError(`deck size must be 1 to ${MAX_DECK}`);
      return guard((own) => splitDeck(own(lib.zero_mask_deck_n(n)).serialize(), n));
    },

    // Re-encrypt and permute cards, with a proof. proof is what the others check.
    shuffle(joint, secret, cards) {
      return guard((own) => {
        const proof = loadJoint(own, joint).shuffle_and_remask(loadKey(own, secret), own(lib.MaskedCards.deserialize(deckBytes(cards))));
        return { proof, cards: splitDeck(proof, cards.length) };
      });
    },

    // Seat `seat`'s shuffle of `cards`: the shuffled cards, or a DeckError.
    verifyShuffle(joint, seat, cards, proof) {
      return guard((own) => {
        if (!(proof instanceof Uint8Array)) throw new DeckError("bad shuffle");
        const out = own(loadJoint(own, joint).verify_shuffle(seat, own(lib.MaskedCards.deserialize(deckBytes(cards))), proof));
        if (out.len() !== cards.length) throw new DeckError("shuffle changed the deck size");
        return splitDeck(out.serialize(), cards.length);
      });
    },

    // My shares for these cards, in order.
    shares(secret, cards) {
      return guard((own) => {
        const kp = loadKey(own, secret);
        return cards.map((card) => {
          checkLength(card, CARD_BYTES, "card");
          return kp.prove_reveal(card).slice(PK_BYTES + CARD_BYTES);
        });
      });
    },

    // items: [{ card, pk, share }]. Throws a DeckError at the first bad one.
    verifyShares(joint, items) {
      items.forEach(({ card, pk, share }, at) =>
        guard((own) => own(loadJoint(own, joint).accumulate_reveals(card)).add_reveal(revealMessage(pk, card, share)), at),
      );
    },

    // Opens a card from every seat's share ([{ pk, share }], all seats):
    // its face, 0..deck size - 1. A bad share throws at its index.
    open(joint, card, shares) {
      return guard((own) => {
        const acc = own(loadJoint(own, joint).accumulate_reveals(card));
        shares.forEach(({ pk, share }, at) => guard(() => acc.add_reveal(revealMessage(pk, card, share)), at));
        if (!acc.is_completed()) throw new DeckError("missing shares");
        return acc.completed_position();
      });
    },

    // Does this revealed secret key belong to the public key that seat used?
    checkSecret(secret, context, pk) {
      try {
        return guard((own) => same(lib.player_public(loadKey(own, secret).prove_player(enc.encode(context))), pk));
      } catch (err) {
        if (err instanceof DeckError && !err.crashed) return false;
        throw err;
      }
    },

    // With every seat's secret key (seat order), the faces of these cards.
    faces(joint, secrets, cards) {
      return guard((own) => {
        const keys = secrets.map((s) => loadKey(own, s));
        const apk = loadJoint(own, joint);
        return cards.map((card, at) =>
          guard((own2) => {
            const acc = own2(apk.accumulate_reveals(card));
            for (const kp of keys) acc.add_reveal(kp.prove_reveal(card));
            return acc.completed_position();
          }, at),
        );
      });
    },
  };
}

let loading = null;

// Loads the WebAssembly once: fetched next to this file in a browser or
// worker, read from disk in Node.
export function loadDeckCrypto() {
  loading ??= (async () => {
    const url = new URL("./vendor/mental-poker/cards_play_bg.wasm", import.meta.url);
    if (url.protocol === "file:") {
      const { readFile } = await import("node:fs/promises");
      await init({ module_or_path: await readFile(url) });
    } else {
      await init({ module_or_path: url });
    }
    return createDeckCrypto();
  })();
  return loading;
}
