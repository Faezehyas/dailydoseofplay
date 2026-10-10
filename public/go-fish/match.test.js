// Go Fish over the real card engine: robots in every seat of a localRoom(),
// each running its own CardMatch, shuffling with proofs and auditing at the
// end. Every lie the rules can't see during play is caught by the audit.
import test from "node:test";
import assert from "node:assert/strict";
import { localRoom } from "../engine/room.js";
import { CardMatch } from "../engine/card-match.js";
import { matchRouter } from "../engine/session.js";
import { rngFromSeed } from "../engine/rng.js";
import { makeRules, forcedMove, ranksIn, askable, rankOf, bookIn } from "./rules.js";
import { chooseMove, startRobot } from "./robot.js";

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 280_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}
const done = (m) => m.verdict || m.phase === "aborted";

// Every face a seat knows is open to all or in its own hand.
function assertNoLeaks(match) {
  for (const [id, s] of match.slots.entries()) {
    if (s.face !== null && !s.gone) assert.ok(s.open || s.owner === match.me, `seat ${match.me} knows hidden slot ${id}`);
  }
}

const honest = (level = "hard") => (st, me, rng, face) => chooseMove(st, me, rng, face, { level });

async function play({ players, config = {}, choose = () => honest() }) {
  const sessions = localRoom({ game: "go-fish", names: Array.from({ length: players }, (_, i) => `P${i}`), mode: "friend" });
  const rules = makeRules(config);
  const robots = [];
  for (const [i, s] of sessions.entries()) robots.push(startRobot(s, { rules, choose: choose(i, () => robots[i].match), delay: () => 0, rng: rngFromSeed(`seat ${i} ${players}`) }));
  let checks = 0;
  for (const r of robots) {
    r.match.on("update", () => {
      assertNoLeaks(r.match);
      checks++;
    });
  }
  try {
    await until(() => robots.every((r) => done(r.match)));
  } finally {
    for (const r of robots) r.destroy();
  }
  return { matches: robots.map((r) => r.match), checks };
}

// Classic rules, then the others: the whole stock taken, pairs, and a lucky fish that passes.
for (const [players, config] of [[2, {}], [4, {}], [3, { empty: "out", books: 2 }], [4, { lucky: "pass", hand: 7 }]]) {
  test(`${players} seats, ${JSON.stringify(config)}: a full game, the same state everywhere, a passing audit and no seat ever knowing another's hidden card`, { timeout: 300_000 }, async () => {
    const { matches, checks } = await play({ players, config });
    for (const m of matches) {
      assert.equal(m.phase, "over", m.abortReason);
      assert.deepEqual(m.verdict, { ok: true });
      assert.deepEqual(m.state, matches[0].state);
    }
    const st = matches[0].state;
    assert.ok(checks >= players * st.moves, "checked as the game went");
    assert.equal(st.books.flat().length, config.books === 2 ? 26 : 13);
    assert.ok(st.log.some((e) => e.t === "give") && st.log.some((e) => e.t === "fish"), "cards changed hands, and someone went fishing");
    // Every card ended face up in a book, the same everywhere.
    for (const m of matches) for (const b of st.books.flat()) for (const slot of b.slots) assert.equal(rankOf(m.face(slot)), b.rank);
  });
}

test("a seat out of turn can't move: refused at home, and stops the match if sent anyway", { timeout: 60_000 }, async () => {
  const sessions = localRoom({ game: "go-fish", names: ["A", "B", "C"], mode: "friend" });
  const rules = makeRules({ first: "host" });
  const matches = sessions.map((s) => {
    const m = new CardMatch({ send: (msg) => s.send(msg), me: s.index, players: 3, rules });
    matchRouter(s).start(m);
    return m;
  });
  await until(() => matches.every((m) => m.phase === "playing"));
  assert.deepEqual([matches[0].state.turn, matches[0].state.phase], [0, "open"]);
  const invalid = [];
  matches[2].on("invalid", (why) => invalid.push(why));
  await matches[2].play({ done: true });
  assert.deepEqual(invalid, ["not your turn"]);
  sessions[2].send({ t: "move", m: 1, move: { done: true }, sh: [] });
  await until(() => matches[0].phase === "aborted" && matches[1].phase === "aborted");
  for (const m of matches.slice(0, 2)) {
    assert.ok(m.abortSeat === 2 || m.abortAbout === 2);
    assert.match(m.abortReason, /moved out of turn/);
  }
});

// A cheating seat: lies once, the first time `when` finds a lie nobody can
// see during play (every card it hides is still face down), then plays honestly.
function liar(seat, when) {
  let lies = 0;
  const make = (i, match) => (st, me, rng, face) => {
    if (i === seat && !lies) {
      const hidden = (slot) => !match().slots[slot].open;
      const lie = when(st, me, face, hidden, rng);
      if (lie) {
        lies++;
        return lie;
      }
    }
    return honest("medium")(st, me, rng, face);
  };
  return { make, lies: () => lies };
}

const LIES = [
  {
    name: "asking for a rank you don't hold",
    reason: /asked for \w+ without holding one/,
    when(st, me, face, hidden, rng) {
      if (st.phase !== "ask" || forcedMove(st, me, face)) return null;
      const mine = ranksIn(st.hands[me], face);
      const missing = [...Array(13).keys()].filter((r) => !mine.includes(r) && !st.books.flat().some((b) => b.rank === r));
      if (!missing.length || !st.hands[me].some(hidden)) return null;
      return { ask: missing[Math.floor(rng() * missing.length)], from: askable(st, me)[0] };
    },
  },
  {
    name: 'saying "Go fish" while holding the rank',
    reason: /said "Go fish" while holding/,
    when(st, me, face, hidden) {
      if (st.phase !== "answer") return null;
      const mine = st.hands[me].filter((slot) => rankOf(face(slot)) === st.ask.rank);
      return mine.length && mine.every(hidden) ? { fish: true } : null;
    },
  },
  {
    name: "handing over only some of them",
    reason: /handed over only some/,
    when(st, me, face, hidden) {
      if (st.phase !== "answer") return null;
      // Keeps one face-down card back and hands over the rest.
      const mine = st.hands[me].filter((slot) => rankOf(face(slot)) === st.ask.rank);
      const kept = mine.find(hidden);
      return mine.length > 1 && kept !== undefined ? { give: mine.filter((slot) => slot !== kept) } : null;
    },
  },
  {
    name: "not laying a book down",
    reason: /kept a book of \w+ in hand/,
    when(st, me, face, hidden) {
      const book = bookIn(st.hands[me], face, st.bookSize);
      if (!book || !book.some(hidden)) return null;
      if (st.phase === "open" || st.phase === "drawn") return { done: true };
      if (st.phase === "ask") return { ask: rankOf(face(book[0])), from: askable(st, me)[0] };
      return null;
    },
  },
  {
    name: "not showing a lucky fish",
    reason: /didn't show a lucky/,
    when(st, me, face) {
      // Not when the card also makes a book: keeping that would be a lie of its own.
      const m = forcedMove(st, me, face);
      return m?.show !== undefined && !bookIn(st.hands[me], face, st.bookSize) ? { done: true } : null;
    },
  },
];

for (const lie of LIES) {
  test(`${lie.name} goes unseen in play and is caught by the audit, which names the liar`, { timeout: 300_000 }, async () => {
    // A few seeds: the chance to lie comes up in most games, and the test needs one.
    for (let attempt = 0; attempt < 6; attempt++) {
      const cheat = liar(1, lie.when);
      const { matches } = await play({ players: 3, config: { first: attempt % 3 === 0 ? "host" : "random" }, choose: cheat.make });
      if (!cheat.lies()) continue;
      for (const m of matches) {
        assert.equal(m.phase, "over", "nobody could tell during the game");
        assert.equal(m.verdict.ok, false);
        assert.equal(m.verdict.seat, 1, "the liar is named");
        assert.match(m.verdict.reason, lie.reason);
      }
      return;
    }
    assert.fail("no chance to lie came up");
  });
}
