import test from "node:test";
import assert from "node:assert/strict";
import { localPair } from "../engine/channel.js";
import { openSession, matchRouter } from "../engine/session.js";
import { rngFromSeed } from "../engine/rng.js";
import { SeaBattleMatch } from "./match.js";
import { randomFleet, shipCells, occupancy, CELLS, UNKNOWN, answerShots } from "./rules.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function sessions() {
  const [x, y] = localPair();
  return Promise.all([
    openSession({ channel: x, mode: "friend", index: 0, name: "Host", game: "sea-battle" }),
    openSession({ channel: y, mode: "friend", index: 1, name: "Guest", game: "sea-battle" }),
  ]);
}

function pair(host, guest, fleets, m = 1) {
  const a = new SeaBattleMatch({ send: (msg) => host.send(msg), me: 0, fleet: fleets[0], m });
  const b = new SeaBattleMatch({ send: (msg) => guest.send(msg), me: 1, fleet: fleets[1], m });
  return [a, b];
}

async function until(fn, label, ms = 5000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error(`timeout: ${label}`);
    await tick(1);
  }
}

// Each side shoots through the opponent's ships in order, then water.
// waterFirst[p]: player p shoots all water before any ship (a hopeless player).
async function playOut(matches, fleets, { skipRain = false, waterFirst = [false, false] } = {}) {
  const plans = [0, 1].map((p) => {
    const ships = [...new Set(fleets[1 - p].flatMap(shipCells))];
    const water = [...Array(CELLS).keys()].filter((i) => !ships.includes(i));
    return waterFirst[p] ? [...water, ...ships] : [...ships, ...water];
  });
  let guard = 0;
  while (matches.every((m) => m.phase === "playing") && guard++ < 1000) {
    await until(() => matches.some((m) => m.canFire()) || matches.some((m) => m.phase !== "playing"), "someone can fire");
    const shooter = matches.find((m) => m.canFire());
    if (!shooter) break;
    const board = shooter.state.boards[1 - shooter.me];
    const inv = shooter.state.inventory[shooter.me];
    const target = plans[shooter.me].find((i) => board.cells[i] === UNKNOWN);
    const weapon = !skipRain && inv.rain > 0 ? "rain" : inv.big > 0 ? "big" : "shot";
    await shooter.fire(weapon, target);
    await until(() => !shooter.pending && !shooter.working, "answer");
  }
}

test("two honest peers play a full match and agree on everything", async () => {
  const [host, guest] = await sessions();
  const fleets = [randomFleet(rngFromSeed("h1")), randomFleet(rngFromSeed("g1"))];
  const [a, b] = pair(host, guest, fleets);
  matchRouter(host).start(a);
  matchRouter(guest).start(b);
  const gifts = [];
  a.on("gifts", (g) => gifts.push(...g));
  await Promise.all([a.ready(), b.ready()]);
  await until(() => a.phase === "playing" && b.phase === "playing", "start");
  assert.equal(a.state.turn, b.state.turn, "agreed first player");
  await playOut([a, b], fleets);
  await until(() => a.verdict && b.verdict, "verdicts");
  assert.equal(a.phase, "over");
  assert.equal(a.state.winner, b.state.winner);
  assert.deepEqual(JSON.parse(JSON.stringify(a.state)), JSON.parse(JSON.stringify(b.state)), "identical public state");
  assert.deepEqual(a.verdict, { ok: true });
  assert.deepEqual(b.verdict, { ok: true });
  assert.ok(gifts.length > 0, "gifts popped during the match");
  assert.ok(a.sr.k > 1, "several shared draws happened");
});

test("nobody learns the other fleet before game over", async () => {
  const [host, guest] = await sessions();
  const fleets = [randomFleet(rngFromSeed("h2")), randomFleet(rngFromSeed("g2"))];
  const seen = [];
  const spy = (session) => {
    const send = session.send.bind(session);
    return (msg) => {
      seen.push(msg);
      return send(msg);
    };
  };
  const a = new SeaBattleMatch({ send: spy(host), me: 0, fleet: fleets[0] });
  const b = new SeaBattleMatch({ send: spy(guest), me: 1, fleet: fleets[1] });
  matchRouter(host).start(a);
  matchRouter(guest).start(b);
  await Promise.all([a.ready(), b.ready()]);
  await until(() => a.phase === "playing" && b.phase === "playing", "start");
  // Before any shot, nothing on the wire describes a ship.
  const wire = JSON.stringify(seen);
  assert.ok(!/"fleet"|"vertical"|"len"/.test(wire), wire);
  await playOut([a, b], fleets, { skipRain: true });
  await until(() => a.verdict && b.verdict, "verdicts");
  const reveals = seen.filter((m) => m.t === "reveal");
  assert.equal(reveals.length, 2);
  const firstReveal = seen.findIndex((m) => m.t === "reveal");
  assert.ok(seen.slice(0, firstReveal).every((m) => m.t !== "reveal"));
  // Only sunk ships were described before the reveal, and only after all their squares were hit.
  assert.ok(seen.slice(0, firstReveal).every((m) => m.t !== "result" || m.sunk.every((s) => s.cells.length === s.len)));
});

for (const variant of ["reveals the fleet it answered with", "reveals the fleet it committed to"]) {
  test(`a defender who swaps its fleet after Ready is caught when it ${variant}`, async () => {
    const [host, guest] = await sessions();
    const committed = randomFleet(rngFromSeed("g3"));
    const swapped = randomFleet(rngFromSeed("g3-swap"));
    const fleets = [randomFleet(rngFromSeed("h3")), swapped];
    const [a, b] = pair(host, guest, [fleets[0], committed]);
    matchRouter(host).start(a);
    matchRouter(guest).start(b);
    await Promise.all([a.ready(), b.ready()]);
    await until(() => a.phase === "playing" && b.phase === "playing", "start");
    const realFleet = b.fleet;
    b.fleet = swapped; // answers now come from a different, uncommitted fleet
    if (variant.includes("committed")) {
      const realSend = b.send;
      b.send = (msg) => realSend(msg.t === "reveal" ? { ...msg, fleet: realFleet } : msg);
    }
    await playOut([a, b], fleets, { skipRain: true, waterFirst: [false, true] });
    await until(() => a.verdict && b.verdict, "verdicts");
    assert.equal(a.verdict.ok, false, JSON.stringify(a.verdict));
    assert.equal(a.state.winner, 0, "the host sank the (swapped) fleet");
    assert.deepEqual(b.verdict, { ok: true }, "the honest side passes the audit");
  });
}

test("an impossible answer aborts the match on the spot", async () => {
  const [host, guest] = await sessions();
  const fleets = [randomFleet(rngFromSeed("h4")), randomFleet(rngFromSeed("g4"))];
  const [a, b] = pair(host, guest, fleets);
  matchRouter(host).start(a);
  matchRouter(guest).start(b);
  const realSend = b.send;
  b.send = (msg) => realSend(msg.t === "result" ? { ...msg, hits: [1, 1, 1] } : msg);
  const aborted = new Promise((r) => a.on("abort", r));
  await Promise.all([a.ready(), b.ready()]);
  await until(() => a.phase === "playing" && b.phase === "playing", "start");
  if (a.state.turn !== 0) {
    // Let the guest miss once so the host shoots.
    const water = [...Array(CELLS).keys()].find((i) => occupancy(fleets[0])[i] === -1);
    b.send = (msg) => realSend(msg);
    await b.fire("shot", water);
    await until(() => a.canFire(), "host turn");
    b.send = (msg) => realSend(msg.t === "result" ? { ...msg, hits: [1, 1, 1] } : msg);
  }
  await a.fire("shot", 0);
  const { reason } = await aborted;
  assert.match(reason, /broke the rules/);
});

test("rematch messages wait for the next match", async () => {
  const [host, guest] = await sessions();
  const routerB = matchRouter(guest);
  const b1 = new SeaBattleMatch({ send: (msg) => guest.send(msg), me: 1, fleet: randomFleet(rngFromSeed("x")), m: 1 });
  routerB.start(b1);
  // Host is already on match 2 and announces readiness early.
  const a2 = new SeaBattleMatch({ send: (msg) => host.send(msg), me: 0, fleet: randomFleet(rngFromSeed("y")), m: 2 });
  matchRouter(host).start(a2);
  await a2.ready();
  await tick(5);
  assert.equal(b1.peer, null, "match 1 ignores match 2 traffic");
  const b2 = new SeaBattleMatch({ send: (msg) => guest.send(msg), me: 1, fleet: randomFleet(rngFromSeed("z")), m: 2 });
  routerB.start(b2);
  await b2.ready();
  await until(() => a2.phase === "playing" && b2.phase === "playing", "match 2 starts");
});

test("defender answers never depend on anything but its own fleet", () => {
  const fleet = randomFleet(rngFromSeed("q"));
  const board = { cells: new Array(CELLS).fill(UNKNOWN), sunk: [], gifts: [] };
  const grid = occupancy(fleet);
  const all = [...Array(CELLS).keys()];
  const { hits } = answerShots(fleet, board, all);
  assert.deepEqual(hits, all.map((i) => (grid[i] === -1 ? 0 : 1)));
});
