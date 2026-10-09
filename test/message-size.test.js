// Lists the largest message each game sends between browsers, and checks it is
// far below MAX_MESSAGE_LENGTH (engine/channel.js), the size at which a
// browser refuses a message and cuts the sender off. Every game plays one full
// match with robots in every seat, at its biggest board and player count, over
// the in-memory group; each frame is measured as it goes over a link, in its
// wire form (a guest's { msg } or the host's forwarded { from, msg }).
//
//   node --test test/message-size.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { localPair, MAX_MESSAGE_LENGTH } from "../public/engine/channel.js";
import { localRoom } from "../public/engine/room.js";
import { admitGuest, greetHost, startHub } from "../public/engine/session.js";
import { startTurnRobot } from "../public/engine/turn-match.js";
import { startCardRobot } from "../public/engine/card-match.js";
import { makeRules as toyCards, chooseMove as toyMove } from "./fixtures/toy-cards.js";
import { NAME_MAX } from "../public/engine/names.js";

// "Far below": a real message may grow 16 times before it reaches the cap.
const HEADROOM = 16;
const ROBOT_MS = 600; // the time a robot's move reports, as in the games' main.js

const tick = () => new Promise((r) => setTimeout(r, 1));
async function until(fn, ms = 120_000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await tick();
  }
}

// Wraps a link's send so every frame it sends is measured: largest.size, largest.t.
function measure(links, largest) {
  for (const link of links) {
    const send = link.send.bind(link);
    link.send = (frame) => {
      const size = JSON.stringify(frame).length;
      if (size > largest.size) Object.assign(largest, { size, t: frame.msg?.t ?? frame.t ?? "left" });
      return send(frame);
    };
  }
}

const names = (n) => Array.from({ length: n }, (_, i) => String(i).repeat(NAME_MAX));
const turnRobot = (rules, choose) => (s) => startTurnRobot(s, { rules, choose, delay: 0 });
const timed = (chooseMove, opts) => (st, me, rng) => ({ ...chooseMove(st, me, rng, opts), ms: ROBOT_MS });

// Each game at its biggest: board, players, and clocks on where moves then carry ms.
const GAMES = {
  "tic-tac-toe": async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/tic-tac-toe/rules.js");
    const { chooseMove } = await import("../public/tic-tac-toe/robot.js");
    const config = { ...DEFAULT_CONFIG, size: 5 };
    return { config, players: 2, robot: turnRobot(makeRules(config), timed(chooseMove)) };
  },
  "connect-4": async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/connect-4/rules.js");
    const { chooseMove } = await import("../public/connect-4/robot.js");
    const config = { ...DEFAULT_CONFIG, size: "9x9", level: "easy" };
    return { config, players: 2, robot: turnRobot(makeRules(config), timed(chooseMove, { level: "easy" })) };
  },
  gomoku: async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/gomoku/rules.js");
    const { chooseMove } = await import("../public/gomoku/robot.js");
    return { config: DEFAULT_CONFIG, players: 2, robot: turnRobot(makeRules(DEFAULT_CONFIG), timed(chooseMove)) };
  },
  checkers: async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/checkers/rules.js");
    const { chooseMove } = await import("../public/checkers/robot.js");
    const config = { ...DEFAULT_CONFIG, moveSeconds: 120, gameSeconds: 3600 };
    return { config: { ...config, level: "easy" }, players: 2, robot: turnRobot(makeRules(config), timed(chooseMove, { level: "easy" })) };
  },
  chess: async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/chess/rules.js");
    const { startRobot } = await import("../public/chess/robot.js");
    const config = { ...DEFAULT_CONFIG, moveSeconds: 120, gameSeconds: 3600 };
    return { config, players: 2, robot: (s) => startRobot(s, { rules: makeRules(config), level: "easy", think: () => 0, timeMs: 20 }) };
  },
  backgammon: async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/backgammon/rules.js");
    const { chooseMove, startRobot } = await import("../public/backgammon/robot.js");
    const config = { ...DEFAULT_CONFIG, moveSeconds: 120, gameSeconds: 3600 };
    const choose = (st, me, rng) => ({ ...chooseMove(st, me, rng, { level: "easy" }), ms: ROBOT_MS });
    return { config, players: 2, robot: (s) => startRobot(s, { rules: makeRules(config), choose, delay: () => 0 }) };
  },
  "chutes-and-ladders": async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/chutes-and-ladders/rules.js");
    const { chooseMove } = await import("../public/chutes-and-ladders/robot.js");
    const config = { ...DEFAULT_CONFIG, robots: 3 };
    return { config, players: 4, robot: turnRobot(makeRules(config), chooseMove) };
  },
  ludo: async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/ludo/rules.js");
    const { chooseMove, startRobot } = await import("../public/ludo/robot.js");
    const config = { ...DEFAULT_CONFIG, blocks: true, captureBonus: true, moveSeconds: 30 };
    const choose = (st, me, rng) => chooseMove(st, me, rng, { level: "easy" });
    return { config, players: 4, robot: (s) => startRobot(s, { rules: makeRules(config), choose, delay: () => 0 }) };
  },
  "dots-and-boxes": async () => {
    const { makeRules, DEFAULT_CONFIG } = await import("../public/dots-and-boxes/rules.js");
    const { startRobot } = await import("../public/dots-and-boxes/robot.js");
    const config = { ...DEFAULT_CONFIG, size: 6, moveSeconds: 60, gameSeconds: 600 };
    return { config, players: 2, robot: (s) => startRobot(s, { rules: makeRules(config), level: "easy", think: () => 0 }) };
  },
  "sea-battle": async () => {
    const { DEFAULT_CONFIG } = await import("../public/sea-battle/rules.js");
    const { startRobot } = await import("../public/sea-battle/robot.js");
    return { config: DEFAULT_CONFIG, players: 2, robot: (s) => startRobot(s, { delay: 0, config: DEFAULT_CONFIG }) };
  },
};

// Plays one full match with robots in every seat; returns the largest frame.
async function largestIn(slug) {
  const { config, players, robot } = await GAMES[slug]();
  const sessions = localRoom({ game: slug, names: names(players), mode: "friend" });
  const largest = { size: 0, t: null };
  measure([...sessions[0].group.links.values(), ...sessions.slice(1).map((s) => s.group.link)], largest);
  // The room creator's settings, as each game's main.js sends them.
  sessions[0].send({ t: "setup", config });
  const robots = sessions.map(robot);
  await until(() => robots.every((r) => ["over", "aborted"].includes(r.match.phase)));
  for (const r of robots) r.destroy();
  assert.deepEqual(robots.map((r) => r.match.phase), robots.map(() => "over"), `${slug}: every seat finished the match`);
  return largest;
}

test("every game's largest message is far below the cap", { timeout: 600_000 }, async (t) => {
  const registry = JSON.parse(readFileSync(new URL("../public/games.json", import.meta.url), "utf8"));
  const ready = registry.games.filter((g) => g.status === "ready").map((g) => g.slug);
  assert.deepEqual(ready.filter((slug) => !GAMES[slug]), [], "every game in games.json is measured here");
  const rows = [];
  for (const slug of Object.keys(GAMES)) {
    const largest = await largestIn(slug);
    rows.push([slug, largest]);
    t.diagnostic(`${slug}: ${largest.size} characters (${largest.t})`);
  }
  for (const [slug, { size }] of rows) {
    assert.ok(size > 0, `${slug}: messages were measured`);
    assert.ok(size * HEADROOM <= MAX_MESSAGE_LENGTH, `${slug}: ${size} is too close to ${MAX_MESSAGE_LENGTH}`);
  }
});

test("the engine's own handshake, with four players at the longest names, is far below the cap", async (t) => {
  const largest = { size: 0, t: null };
  const [host, ...guests] = names(4);
  const pairs = guests.map(() => localPair());
  measure(pairs.flat(), largest);
  const joined = pairs.map(([, g], i) => greetHost(g, { name: guests[i], game: "sea-battle" }));
  const admitted = await Promise.all(pairs.map(async ([h]) => ({ link: h, name: await admitGuest(h, { game: "sea-battle" }) })));
  for (const g of admitted) g.link.send({ t: "$roster", players: [host, ...guests] });
  startHub({ name: host, guests: admitted, game: "sea-battle" });
  await Promise.all(joined);
  t.diagnostic(`engine handshake: ${largest.size} characters (${largest.t})`);
  assert.ok(largest.size * HEADROOM <= MAX_MESSAGE_LENGTH);
});

test("the card engine's largest message is far below the cap, with four players and a 108-card deck", { timeout: 300_000 }, async (t) => {
  // Shuffles and share rounds grow with the deck, so CardMatch sends them in parts.
  const rules = toyCards({ deckSize: 108, hand: 7, maxTurns: 40 });
  const sessions = localRoom({ game: "cards", names: names(4), mode: "friend" });
  const largest = { size: 0, t: null };
  measure([...sessions[0].group.links.values(), ...sessions.slice(1).map((s) => s.group.link)], largest);
  const robots = sessions.map((s) => startCardRobot(s, { rules, choose: toyMove, delay: 0 }));
  await until(() => robots.every((r) => r.match.verdict || r.match.phase === "aborted"));
  for (const r of robots) r.destroy();
  assert.deepEqual(robots.map((r) => r.match.verdict?.ok), [true, true, true, true]);
  t.diagnostic(`card engine: ${largest.size} characters (${largest.t})`);
  assert.ok(largest.size * HEADROOM <= MAX_MESSAGE_LENGTH, `${largest.size} is too close to ${MAX_MESSAGE_LENGTH}`);
});
