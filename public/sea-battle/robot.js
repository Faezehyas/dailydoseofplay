// The robot opponent. It plays through the same SeaBattleMatch protocol and
// rules as a human peer; only the move choice below is robot-specific.
//
// Strategy: probability density over every placement of every ship still
// afloat, consistent with what is known (misses, cleared water, sunk ships,
// and the rule that ships never touch side by side).
//   * target mode (an unsunk hit exists): only placements that cover a hit
//     count, weighted by how many hits they cover, so it follows the line;
//   * hunt mode: restricted to a parity lattice of the smallest ship left,
//     and it goes out of its way for gifts;
//   * weapons: splash weapons are aimed where they cover the most density.
import { randomFleet, remainingShips, shipCells, orthoNeighbors, aimedCells, other, CELLS, SIZE, UNKNOWN, HIT, MISS, CLEAR, rowOf, colOf } from "./rules.js";
import { SeaBattleMatch } from "./match.js";
import { matchRouter } from "../engine/session.js";

export function analyze(board) {
  const sunkCells = new Set(board.sunk.flatMap((s) => s.cells));
  const openHits = [];
  for (let i = 0; i < CELLS; i++) if (board.cells[i] === HIT && !sunkCells.has(i)) openHits.push(i);
  const openHitSet = new Set(openHits);
  const targetMode = openHits.length > 0;
  const density = new Float64Array(CELLS);
  const left = remainingShips(board);
  for (const len of left) {
    for (const vertical of [false, true]) {
      for (let r = 0; r + (vertical ? len - 1 : 0) < SIZE; r++) {
        for (let c = 0; c + (vertical ? 0 : len - 1) < SIZE; c++) {
          const cells = shipCells({ r, c, len, vertical });
          let covered = 0;
          let possible = true;
          for (const i of cells) {
            const v = board.cells[i];
            if (v === MISS || v === CLEAR || sunkCells.has(i)) {
              possible = false;
              break;
            }
            if (v === HIT) covered++;
          }
          if (!possible) continue;
          if (targetMode) {
            if (covered === 0) continue;
            // A hit right beside this ship but not part of it would be touching.
            const inShip = new Set(cells);
            if (cells.some((i) => orthoNeighbors(i).some((n) => openHitSet.has(n) && !inShip.has(n)))) continue;
          }
          const weight = targetMode ? covered ** 3 : 1;
          for (const i of cells) if (board.cells[i] === UNKNOWN) density[i] += weight;
        }
      }
    }
  }
  return { density, targetMode, left };
}

function bestOf(candidates, score, rng) {
  let best = [];
  let bestScore = -Infinity;
  for (const i of candidates) {
    const s = score(i);
    if (s > bestScore + 1e-9) {
      bestScore = s;
      best = [i];
    } else if (Math.abs(s - bestScore) <= 1e-9) {
      best.push(i);
    }
  }
  return { cell: best[Math.floor(rng() * best.length)], score: bestScore };
}

// Pick { weapon, target } for `me` in public match state.
export function chooseMove(state, me, rng = Math.random) {
  const board = state.boards[other(me)];
  const inv = state.inventory[me];
  const { density, targetMode, left } = analyze(board);
  const unknown = [];
  for (let i = 0; i < CELLS; i++) if (board.cells[i] === UNKNOWN) unknown.push(i);
  let candidates = unknown;
  if (!targetMode) {
    const step = Math.min(...left);
    const parity = unknown.filter((i) => (rowOf(i) + colOf(i)) % step === 0 && density[i] > 0);
    if (parity.length) candidates = parity;
  }
  const max = Math.max(0, ...candidates.map((i) => density[i]));
  const gifts = new Set(board.gifts.map((g) => g.cell));
  const giftBonus = targetMode ? 0 : max * 0.75;
  const single = bestOf(candidates, (i) => density[i] + (gifts.has(i) ? giftBonus : 0), rng);

  if (!targetMode) {
    for (const weapon of ["nuke", "big"]) {
      if (inv[weapon] > 0) {
        const aim = bestOf(
          [...Array(CELLS).keys()],
          (i) => aimedCells(board, weapon, i).reduce((s, c) => s + density[c] + (gifts.has(c) ? giftBonus : 0), 0),
          rng,
        );
        if (aim.score > 0) return { weapon, target: aim.cell };
      }
    }
    if (inv.rain > 0) return { weapon: "rain" };
  }
  return { weapon: "shot", target: single.cell };
}

// Drive the robot's side of a session. Returns { destroy }. config: the
// room's time limits; the robot reports no time spent, so only the human's
// clock runs.
export function startRobot(session, { delay = 650, rng = Math.random, config = null } = {}) {
  let match = null;
  let timer = null;
  let destroyed = false;
  const router = matchRouter(session);

  function schedule() {
    if (destroyed || timer || !match.canFire()) return;
    timer = setTimeout(() => {
      timer = null;
      if (destroyed || !match.canFire()) return;
      const { weapon, target } = chooseMove(match.state, match.me, rng);
      match.fire(weapon, target, 0);
    }, delay + Math.floor(rng() * delay * 0.5));
  }

  function newMatch(m) {
    match = new SeaBattleMatch({ send: (msg) => session.send(msg), me: session.index, fleet: randomFleet(rng), m, config });
    match.on("update", schedule);
    router.start(match);
    match.ready();
  }

  session.on("rematch-start", () => newMatch(match.m + 1));
  newMatch(1);
  return {
    get match() {
      return match;
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
