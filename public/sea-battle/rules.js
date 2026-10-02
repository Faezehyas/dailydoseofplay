// Sea Battle rules. Pure functions and plain data: no DOM, no network, no
// timers, no Math.random (randomness is passed in as an rng function), so
// both peers, the robot and the tests all run exactly this code.
import { pickWeighted, randInt, sample } from "../engine/rng.js";

export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const FLEET = [5, 4, 3, 3, 2];
export const SHIP_NAMES = { 5: "Carrier", 4: "Battleship", 3: "Cruiser", 2: "Destroyer" };

// Public cell states on a board, as seen by both players.
export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2;
export const CLEAR = 3; // known water next to a sunk ship (ships never touch side by side)

// Gifts: every GIFT_EVERY moves one gift pops on each board (max MAX_GIFTS
// waiting per board). Firing at a gift's square collects it for the shooter.
export const GIFT_EVERY = 6;
export const MAX_GIFTS = 2;
export const RAIN_COUNT = 7;

export const WEAPONS = {
  shot: { label: "Shot", gift: false, help: "1 square. Hit to fire again." },
  missile: { label: "Simple missile", gift: true, weight: 40, help: "1 square. A bonus shot: your turn continues even on a miss." },
  big: { label: "Big missile", gift: true, weight: 30, help: "5-square splash (plus shape)." },
  rain: { label: "Missile rain", gift: true, weight: 20, help: "7 random unexplored squares, agreed by both players." },
  nuke: { label: "Nuclear missile", gift: true, weight: 10, help: "14-square splash." },
};
export const GIFT_TYPES = Object.keys(WEAPONS).filter((w) => WEAPONS[w].gift);

// Splash patterns as [dRow, dCol] around the aimed square.
export const PATTERNS = {
  shot: [[0, 0]],
  missile: [[0, 0]],
  big: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]],
  // 4x4 block with two opposite corners spared: 14 squares.
  nuke: (() => {
    const out = [];
    for (let dr = -1; dr <= 2; dr++) {
      for (let dc = -1; dc <= 2; dc++) {
        if ((dr === -1 && dc === -1) || (dr === 2 && dc === 2)) continue;
        out.push([dr, dc]);
      }
    }
    return out;
  })(),
};

export const idx = (r, c) => r * SIZE + c;
export const rowOf = (i) => Math.floor(i / SIZE);
export const colOf = (i) => i % SIZE;
export const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

export function orthoNeighbors(i) {
  const r = rowOf(i);
  const c = colOf(i);
  const out = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    if (inBounds(r + dr, c + dc)) out.push(idx(r + dr, c + dc));
  }
  return out;
}

// ---------- ships and fleets ----------
// A ship is { r, c, len, vertical }.

export function shipCells(ship) {
  const out = [];
  for (let k = 0; k < ship.len; k++) out.push(ship.vertical ? idx(ship.r + k, ship.c) : idx(ship.r, ship.c + k));
  return out;
}

export function shipInBounds(ship) {
  if (!Number.isInteger(ship.r) || !Number.isInteger(ship.c) || !Number.isInteger(ship.len)) return false;
  const endR = ship.vertical ? ship.r + ship.len - 1 : ship.r;
  const endC = ship.vertical ? ship.c : ship.c + ship.len - 1;
  return inBounds(ship.r, ship.c) && inBounds(endR, endC);
}

// Occupancy grid: cell -> ship index or -1.
export function occupancy(ships) {
  const grid = new Array(CELLS).fill(-1);
  ships.forEach((ship, s) => {
    for (const i of shipCells(ship)) grid[i] = s;
  });
  return grid;
}

// Can `ship` sit on the board next to `others`? No overlap, no side contact.
export function canPlace(others, ship) {
  if (!shipInBounds(ship)) return false;
  const grid = occupancy(others);
  for (const i of shipCells(ship)) {
    if (grid[i] !== -1) return false;
    for (const n of orthoNeighbors(i)) if (grid[n] !== -1) return false;
  }
  return true;
}

export function validateFleet(ships) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return { ok: false, reason: "wrong number of ships" };
  if (!ships.every((s) => s && typeof s === "object")) return { ok: false, reason: "malformed ship" };
  const lens = ships.map((s) => s?.len).sort((a, b) => b - a);
  if (lens.join() !== [...FLEET].sort((a, b) => b - a).join()) return { ok: false, reason: "wrong ship sizes" };
  for (let s = 0; s < ships.length; s++) {
    const ship = ships[s];
    if (typeof ship.vertical !== "boolean" || !shipInBounds(ship)) return { ok: false, reason: "ship off the board" };
    if (!canPlace(ships.slice(0, s), ship)) return { ok: false, reason: "ships overlap or touch" };
  }
  return { ok: true };
}

// Canonical form used for commitments: fixed key order, sorted ships.
export function normalizeFleet(ships) {
  return ships
    .map((s) => ({ r: s.r, c: s.c, len: s.len, vertical: !!s.vertical }))
    .sort((a, b) => b.len - a.len || a.r - b.r || a.c - b.c || Number(a.vertical) - Number(b.vertical));
}

export function randomFleet(rng) {
  for (;;) {
    const ships = [];
    let ok = true;
    for (const len of FLEET) {
      let placed = false;
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const vertical = rng() < 0.5;
        const ship = {
          r: randInt(rng, vertical ? SIZE - len + 1 : SIZE),
          c: randInt(rng, vertical ? SIZE : SIZE - len + 1),
          len,
          vertical,
        };
        if (canPlace(ships, ship)) {
          ships.push(ship);
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return ships;
  }
}

// ---------- public match state ----------

export function newBoard() {
  return { cells: new Array(CELLS).fill(UNKNOWN), sunk: [], gifts: [] };
}

export function newInventory() {
  return { missile: 0, big: 0, rain: 0, nuke: 0 };
}

// boards[p] is player p's waters (fired at by the other player).
export function newMatchState(first) {
  return {
    boards: [newBoard(), newBoard()],
    inventory: [newInventory(), newInventory()],
    turn: first,
    moves: 0,
    winner: -1,
    giftsSpawned: 0,
  };
}

export const other = (p) => 1 - p;

export function remainingShips(board) {
  const left = [...FLEET];
  for (const s of board.sunk) {
    const k = left.indexOf(s.len);
    if (k >= 0) left.splice(k, 1);
  }
  return left;
}

export function weaponAvailable(state, shooter, weapon) {
  if (!(weapon in WEAPONS)) return false;
  return weapon === "shot" || state.inventory[shooter][weapon] > 0;
}

// Squares a fired weapon covers, for every weapon except rain. Only squares
// that are still unexplored are fired at.
export function patternCells(weapon, target) {
  const r = rowOf(target);
  const c = colOf(target);
  const out = [];
  for (const [dr, dc] of PATTERNS[weapon]) if (inBounds(r + dr, c + dc)) out.push(idx(r + dr, c + dc));
  return out;
}

export function aimedCells(board, weapon, target) {
  return patternCells(weapon, target).filter((i) => board.cells[i] === UNKNOWN);
}

export function unexplored(board) {
  const out = [];
  for (let i = 0; i < CELLS; i++) if (board.cells[i] === UNKNOWN) out.push(i);
  return out;
}

// Missile rain squares from an rng both peers share.
export function rainCells(board, rng) {
  return sample(rng, unexplored(board), RAIN_COUNT).sort((a, b) => a - b);
}

// Validate a fire request against public state. Returns cells (or null for rain).
export function checkFire(state, shooter, weapon, target) {
  if (state.winner !== -1) throw new RuleError("game is over");
  if (state.turn !== shooter) throw new RuleError("not your turn");
  if (!weaponAvailable(state, shooter, weapon)) throw new RuleError("weapon not available");
  const board = state.boards[other(shooter)];
  if (weapon === "rain") {
    if (unexplored(board).length === 0) throw new RuleError("nothing left to fire at");
    return null;
  }
  if (!Number.isInteger(target) || target < 0 || target >= CELLS) throw new RuleError("bad target");
  if ((weapon === "shot" || weapon === "missile") && board.cells[target] !== UNKNOWN) throw new RuleError("square already explored");
  const cells = aimedCells(board, weapon, target);
  if (cells.length === 0) throw new RuleError("nothing to hit there");
  return cells;
}

export class RuleError extends Error {
  name = "RuleError";
}

// Defender side: answer shots against the private fleet.
// knownHits is the defender's own board state (public), used to detect sinks.
export function answerShots(fleet, board, cells) {
  const grid = occupancy(fleet);
  const hits = cells.map((i) => (grid[i] !== -1 ? 1 : 0));
  const hitSet = new Set(board.cells.flatMap((v, i) => (v === HIT ? [i] : [])));
  cells.forEach((i, k) => hits[k] && hitSet.add(i));
  const alreadySunk = new Set(board.sunk.map((s) => s.cells[0]));
  const sunk = [];
  fleet.forEach((ship) => {
    const sc = shipCells(ship);
    if (alreadySunk.has(Math.min(...sc))) return;
    if (sc.every((i) => hitSet.has(i))) sunk.push({ len: ship.len, cells: sc.slice().sort((a, b) => a - b) });
  });
  return { hits, sunk };
}

// Does a revealed sunk ship make sense against the public board?
function sunkShipValid(board, ship, hitNow) {
  if (!ship || !Array.isArray(ship.cells) || ship.cells.length !== ship.len) return false;
  const cells = ship.cells.slice().sort((a, b) => a - b);
  if (!cells.every((i) => Number.isInteger(i) && i >= 0 && i < CELLS && hitNow.has(i))) return false;
  const sameRow = cells.every((i) => rowOf(i) === rowOf(cells[0]));
  const sameCol = cells.every((i) => colOf(i) === colOf(cells[0]));
  const step = sameRow ? 1 : sameCol ? SIZE : 0;
  if (!step && cells.length > 1) return false;
  for (let k = 1; k < cells.length; k++) if (cells[k] - cells[k - 1] !== step) return false;
  const taken = new Set(board.sunk.flatMap((s) => s.cells));
  return cells.every((i) => !taken.has(i));
}

// Apply a resolved fire to the shared public state (both peers run this).
// Throws RuleError on an impossible answer. Returns a list of events.
export function applyFire(state, shooter, weapon, cells, hits, sunk) {
  const defender = other(shooter);
  const board = state.boards[defender];
  if (!Array.isArray(hits) || hits.length !== cells.length || !hits.every((h) => h === 0 || h === 1)) {
    throw new RuleError("malformed answer");
  }
  if (!Array.isArray(sunk)) throw new RuleError("malformed sunk list");
  const events = [];
  if (weapon !== "shot") state.inventory[shooter][weapon] -= 1;
  const hitNow = new Set(board.cells.flatMap((v, i) => (v === HIT ? [i] : [])));
  cells.forEach((i, k) => {
    if (board.cells[i] !== UNKNOWN) throw new RuleError("square fired twice");
    board.cells[i] = hits[k] ? HIT : MISS;
    if (hits[k]) hitNow.add(i);
    events.push({ type: hits[k] ? "hit" : "miss", cell: i });
  });
  // Validate sunk ships against remaining sizes.
  const left = remainingShips(board);
  for (const ship of sunk) {
    const k = left.indexOf(ship?.len);
    if (k < 0 || !sunkShipValid(board, ship, hitNow)) throw new RuleError("impossible sunk ship");
    left.splice(k, 1);
    const clean = { len: ship.len, cells: ship.cells.slice().sort((a, b) => a - b) };
    board.sunk.push(clean);
    for (const i of clean.cells) {
      for (const n of orthoNeighbors(i)) if (board.cells[n] === UNKNOWN) board.cells[n] = CLEAR;
    }
    events.push({ type: "sunk", ship: clean });
  }
  // Gifts under any fired square (or now known water) go to the shooter.
  const keep = [];
  for (const g of board.gifts) {
    if (cells.includes(g.cell)) {
      state.inventory[shooter][g.type] += 1;
      events.push({ type: "gift", gift: g.type, cell: g.cell, by: shooter });
    } else if (board.cells[g.cell] === UNKNOWN) {
      keep.push(g);
    }
  }
  board.gifts = keep;
  state.moves += 1;
  if (board.sunk.length === FLEET.length) {
    state.winner = shooter;
    events.push({ type: "win", winner: shooter });
  } else if (weapon === "missile" || hits.some(Boolean)) {
    events.push({ type: "again", player: shooter });
  } else {
    state.turn = defender;
    events.push({ type: "turn", player: defender });
  }
  // Out of squares to explore without a winner can only mean a lie; stop.
  if (state.winner === -1 && unexplored(board).length === 0) throw new RuleError("board exhausted without a sinking");
  return events;
}

export function giftsDue(state) {
  return state.winner === -1 && state.moves > 0 && state.moves % GIFT_EVERY === 0;
}

// Spawn one gift per board from a shared rng. Returns the new gifts.
export function spawnGifts(state, rng) {
  const spawned = [];
  for (let p = 0; p < 2; p++) {
    const board = state.boards[p];
    const type = pickWeighted(rng, GIFT_TYPES.map((value) => ({ value, weight: WEAPONS[value].weight })));
    if (board.gifts.length >= MAX_GIFTS) continue;
    const taken = new Set(board.gifts.map((g) => g.cell));
    const free = unexplored(board).filter((i) => !taken.has(i));
    if (free.length === 0) continue;
    const gift = { cell: free[randInt(rng, free.length)], type };
    board.gifts.push(gift);
    spawned.push({ board: p, ...gift });
  }
  state.giftsSpawned += spawned.length;
  return spawned;
}

// After the reveal: did the defender's answers match their real fleet?
export function auditBoard(board, fleet) {
  const v = validateFleet(fleet);
  if (!v.ok) return { ok: false, reason: v.reason };
  const grid = occupancy(fleet);
  for (let i = 0; i < CELLS; i++) {
    const cell = board.cells[i];
    if (cell === HIT && grid[i] === -1) return { ok: false, reason: `reported a hit on empty water at ${cellName(i)}` };
    if (cell === MISS && grid[i] !== -1) return { ok: false, reason: `reported a miss on a ship at ${cellName(i)}` };
    if (cell === CLEAR && grid[i] !== -1) return { ok: false, reason: `hid a ship next to a sunk one at ${cellName(i)}` };
  }
  const sunkNow = fleet.filter((ship) => shipCells(ship).every((i) => board.cells[i] === HIT));
  if (sunkNow.length !== board.sunk.length) return { ok: false, reason: "a sunk ship was not announced" };
  const announced = new Set(board.sunk.map((s) => s.cells.join()));
  for (const ship of sunkNow) {
    if (!announced.has(shipCells(ship).sort((a, b) => a - b).join())) return { ok: false, reason: "a sunk ship was misreported" };
  }
  return { ok: true };
}

export const cellName = (i) => `${"ABCDEFGHIJ"[colOf(i)]}${rowOf(i) + 1}`;
