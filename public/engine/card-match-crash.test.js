// A shuffle whose proof traps the deck's WebAssembly, in a match. Its own
// file, so the trap can't touch the module other tests use.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "./room.js";
import { startCardRobot } from "./card-match.js";
import { toBase64, fromBase64 } from "./base64.js";
import { makeRules, chooseMove } from "../../test/fixtures/toy-cards.js";

const TRAP = 2268; // see deck-crash.test.js

test("a shuffle that crashes the deck stops the match and names the shuffler", { timeout: 60_000 }, async () => {
  const rules = makeRules({ deckSize: 10 });
  const sessions = localRoom({ game: "toy", names: ["A", "B"] });
  const send = sessions[1].send.bind(sessions[1]);
  // Parts carry 2250 bytes each, so the byte sits in part 1.
  sessions[1].send = (msg) => {
    if (msg.t === "shuffle" && msg.i === 1) {
      const d = fromBase64(msg.d);
      d[TRAP - 2250] = 255;
      msg = { ...msg, d: toBase64(d) };
    }
    return send(msg);
  };
  const robots = sessions.map((s) => startCardRobot(s, { rules, choose: chooseMove, delay: 0 }));
  while (robots[0].match.phase !== "aborted") await new Promise((r) => setTimeout(r, 5));
  assert.equal(robots[0].match.abortSeat, 1);
  assert.equal(robots[0].match.abortReason, "sent a shuffle that doesn't check out (it crashed the deck)");
});
