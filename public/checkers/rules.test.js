import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import {
  makeRules,
  newState as newTimedState,
  applyMove,
  legalMoves,
  capturedBy,
  countPieces,
  initialBoard,
  normalizeConfig,
  timeLeft,
  isDark,
  DARK,
  DEFAULT_CONFIG,
  QUIET_LIMIT,
  EMPTY,
  DRAW,
} from "./rules.js";

const UNTIMED = { moveSeconds: 0, gameSeconds: 0 };
const newState = (first, config = UNTIMED) => newTimedState(first, config);
const sq = (r, c) => r * 8 + c;
const sortPaths = (paths) => paths.map((p) => p.join("-")).sort();

// Build a state from 8 rows: x/X = player 0 man/king, o/O = player 1 man/king, . or space = empty.
function stateFrom(rows, turn = 0) {
  const s = newState(0);
  s.board = rows.flatMap((row) => [...row.padEnd(8, ".")].map((ch) => ({ x: 0, o: 1, X: 2, O: 3 })[ch] ?? EMPTY));
  s.turn = turn;
  return s;
}

test("a new game has 12 men each on the dark squares, player 0 at the bottom", () => {
  const s = newState(1);
  assert.equal(s.turn, 1);
  assert.equal(s.first, 1);
  assert.equal(s.winner, -1);
  assert.equal(s.quiet, 0);
  assert.equal(DARK.length, 32);
  assert.equal(countPieces(s.board, 0), 12);
  assert.equal(countPieces(s.board, 1), 12);
  s.board.forEach((v, i) => {
    if (v !== EMPTY) assert.ok(isDark(i), `piece on light square ${i}`);
    if (v === 1) assert.ok(i < 24);
    if (v === 0) assert.ok(i >= 40);
  });
  assert.ok(isDark(sq(7, 0)), "each player has a dark square in their left corner");
  assert.deepEqual(s.board, initialBoard());
});

test("the opening has 7 moves for each side, all one step forward", () => {
  const s = newState(0);
  for (const player of [0, 1]) {
    const moves = legalMoves(s.board, player);
    assert.equal(moves.length, 7);
    for (const [from, to] of moves) assert.equal(to >> 3, (from >> 3) + (player === 0 ? -1 : 1));
  }
});

test("a step moves the man and passes the turn", () => {
  const s = newState(0);
  const events = applyMove(s, 0, { path: [sq(5, 0), sq(4, 1)] });
  assert.deepEqual(events, [{ type: "moved", player: 0, path: [40, 33], captured: [], crowned: false }]);
  assert.equal(s.board[sq(5, 0)], EMPTY);
  assert.equal(s.board[sq(4, 1)], 0);
  assert.equal(s.turn, 1);
  assert.equal(s.quiet, 1);
  assert.deepEqual(s.moves, [[40, 33]]);
});

test("men move only forward; kings move both ways", () => {
  const s = stateFrom(["", "", "", "..x", "", "....O", "", ""]);
  assert.deepEqual(sortPaths(legalMoves(s.board, 0)), sortPaths([[sq(3, 2), sq(2, 1)], [sq(3, 2), sq(2, 3)]]));
  assert.deepEqual(
    sortPaths(legalMoves(s.board, 1)),
    sortPaths([[sq(5, 4), sq(4, 3)], [sq(5, 4), sq(4, 5)], [sq(5, 4), sq(6, 3)], [sq(5, 4), sq(6, 5)]]),
  );
});

test("captures are mandatory", () => {
  // x on (5,2) can jump o on (4,3); x on (5,6) could step but may not.
  const s = stateFrom(["", "", "", "", "...o", "..x...x", "", ""]);
  assert.deepEqual(legalMoves(s.board, 0), [[sq(5, 2), sq(3, 4)]]);
  assert.throws(() => applyMove(s, 0, { path: [sq(5, 6), sq(4, 7)] }), (e) => e instanceof RuleError && /must capture/.test(e.message));
  const events = applyMove(s, 0, { path: [sq(5, 2), sq(3, 4)] });
  assert.deepEqual(events[0].captured, [sq(4, 3)]);
  assert.equal(s.board[sq(4, 3)], EMPTY);
  assert.equal(s.quiet, 0);
});

test("multi-jumps must be completed, and any full sequence may be chosen", () => {
  // x at (7,0) can jump (6,1) to (5,2), then either (4,3) to (3,4) or (4,1) to (3,0).
  // From (3,4) it can go on over (2,5) to (1,6).
  const s = stateFrom(["", "", ".....o", "", ".o.o", "", ".o", "x"]);
  assert.deepEqual(sortPaths(legalMoves(s.board, 0)), sortPaths([[56, 42, 24], [56, 42, 28, 14]]));
  assert.throws(() => applyMove(structuredClone(s), 0, { path: [56, 42] }), /Keep jumping/);
  assert.throws(() => applyMove(structuredClone(s), 0, { path: [56, 42, 28] }), /Keep jumping/);
  const events = applyMove(s, 0, { path: [56, 42, 28, 14] });
  assert.deepEqual(events[0].captured, [49, 35, 21]);
  assert.deepEqual(capturedBy([56, 42, 28, 14]), [49, 35, 21]);
  assert.equal(countPieces(s.board, 1), 1);
  assert.equal(s.board[14], 0);
});

test("a man that reaches the far row is crowned, and that ends its move", () => {
  // x jumps (1,2) and lands on (0,3); as a king it could jump on over (1,4), but may not.
  const t = stateFrom(["", "..o.o", ".x", "", "", "", "", ""]);
  assert.deepEqual(legalMoves(t.board, 0), [[sq(2, 1), sq(0, 3)]]);
  const events = applyMove(t, 0, { path: [sq(2, 1), sq(0, 3)] });
  assert.equal(events[0].crowned, true);
  assert.equal(t.board[sq(0, 3)], 2, "now a king");
  assert.equal(t.turn, 1, "the turn passes although the new king could jump again");
  assert.equal(t.quiet, 0);
});

test("a king can jump backwards and around, but never jumps a piece twice", () => {
  // X at (4,1) with o men around: it can loop (4,1)->(2,3)->(4,5)->(6,3)->(4,1).
  const s = stateFrom(["", "", "", "..o.o", ".X", "..o.o", "", ""]);
  const moves = legalMoves(s.board, 0);
  assert.ok(moves.every((m) => new Set(capturedBy(m)).size === capturedBy(m).length), "no piece jumped twice");
  assert.ok(moves.some((m) => m.length === 5 && m[0] === m[4]), "it may land back on its start square");
  assert.equal(Math.max(...moves.map((m) => m.length)), 5);
  const loop = moves.find((m) => m.length === 5);
  applyMove(s, 0, { path: loop });
  assert.equal(countPieces(s.board, 1), 0);
  assert.equal(s.winner, 0);
  assert.equal(s.reason, "captured");
});

test("capturing every piece wins", () => {
  const s = stateFrom(["", "", "", "..o", ".x", "", "", ""]);
  const events = applyMove(s, 0, { path: [sq(4, 1), sq(2, 3)] });
  assert.deepEqual(events.at(-1), { type: "win", player: 0, reason: "captured" });
  assert.equal(s.winner, 0);
  assert.equal(s.turn, 0, "the turn stays put once the game is over");
});

test("a player left with no legal move loses", () => {
  // o on (0,1) is blocked by x pieces it cannot jump.
  const s = stateFrom([".o", "x.x", "...x", "", "", "", "", "x"]);
  assert.equal(legalMoves(s.board, 1).length, 0);
  const t = stateFrom([".o", "x", ".x.x", "", "", "", "", "x"]);
  const events = applyMove(t, 0, { path: [sq(2, 1), sq(1, 2)] });
  assert.deepEqual(events.at(-1), { type: "win", player: 0, reason: "blocked" });
  assert.equal(t.reason, "blocked");
});

test(`${QUIET_LIMIT} turns in a row with no capture and no new king is a draw`, () => {
  const s = stateFrom([".X", "", "", "", "", "", "", "......O"]);
  const shuttle = [
    [sq(0, 1), sq(1, 0)],
    [sq(7, 6), sq(6, 7)],
    [sq(1, 0), sq(0, 1)],
    [sq(6, 7), sq(7, 6)],
  ];
  for (let k = 0; k < QUIET_LIMIT - 1; k++) applyMove(s, s.turn, { path: shuttle[k % 4] });
  assert.equal(s.quiet, QUIET_LIMIT - 1);
  assert.equal(s.winner, -1);
  const events = applyMove(s, s.turn, { path: shuttle[(QUIET_LIMIT - 1) % 4] });
  assert.deepEqual(events.at(-1), { type: "draw" });
  assert.equal(s.winner, DRAW);
  assert.equal(s.reason, "draw");
});

test("a capture or a new king resets the quiet count", () => {
  const s = stateFrom(["", "x", "", "", "", "", "", "......O"]);
  s.quiet = 30;
  applyMove(s, 0, { path: [sq(1, 0), sq(0, 1)] });
  assert.equal(s.quiet, 0, "crowned");
  applyMove(s, 1, { path: [sq(7, 6), sq(6, 7)] });
  assert.equal(s.quiet, 1);
});

test("illegal moves throw RuleError and leave the state alone", () => {
  const s = newState(0);
  const snapshot = structuredClone(s);
  const cases = [
    [0, { path: [sq(5, 0), sq(3, 2)] }, /can't move there/],
    [0, { path: [sq(5, 0), sq(4, 0)] }, /can't move there/],
    [0, { path: [sq(6, 1), sq(5, 0)] }, /can't move there/],
    [0, { path: [sq(5, 0), sq(6, 1)] }, /can't move there/],
    [0, { path: [sq(2, 1), sq(3, 0)] }, /your pieces/],
    [0, { path: [sq(4, 1), sq(3, 0)] }, /your pieces/],
    [1, { path: [sq(2, 1), sq(3, 0)] }, /Not your turn/],
    [0, { path: [sq(5, 0)] }, /Pick a piece/],
    [0, { path: [sq(5, 0), 64] }, /Pick a piece/],
    [0, { path: [sq(5, 0), 32.5] }, /Pick a piece/],
    [0, { path: "40-33" }, /Pick a piece/],
    [0, { path: Array(14).fill(40) }, /Pick a piece/],
    [0, {}, /Pick a piece/],
    [0, null, /Pick a piece/],
  ];
  for (const [player, move, msg] of cases) {
    assert.throws(() => applyMove(s, player, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
    assert.deepEqual(s, snapshot);
  }
});

test("no move is accepted after the game is over", () => {
  const s = stateFrom(["", "", "", "..o", ".x", "", "", ""]);
  applyMove(s, 0, { path: [sq(4, 1), sq(2, 3)] });
  assert.throws(() => applyMove(s, 1, { path: [sq(2, 3), sq(3, 4)] }), /game is over/);
  assert.throws(() => applyMove(s, 0, { path: [sq(2, 3), sq(1, 4)] }), /game is over/);
});

test("a scripted full game ends in the expected state", () => {
  // Each side plays its longest capture, else its lowest-numbered move. Player 1
  // opens; player 0 ends up 6 pieces to 1 but never corners the last: a quiet draw.
  const s = newState(1);
  const script = [];
  while (s.winner === -1) {
    const moves = legalMoves(s.board, s.turn).sort((a, b) => b.length - a.length || a[0] - b[0] || a.at(-1) - b.at(-1));
    script.push(moves[0]);
    applyMove(s, s.turn, { path: moves[0] });
  }
  assert.deepEqual(script.slice(0, 6), [[17, 24], [40, 33], [8, 17], [33, 26], [17, 35], [42, 28]]);
  assert.equal(script.length, 121);
  assert.equal(s.winner, DRAW);
  assert.equal(s.reason, "draw");
  assert.equal(s.quiet, QUIET_LIMIT);
  assert.deepEqual([countPieces(s.board, 0), countPieces(s.board, 1)], [6, 1]);
  assert.deepEqual(s.moves, script);
  const replay = newState(1);
  for (const path of script) applyMove(replay, replay.turn, { path });
  assert.deepEqual(replay, s);
});

// ---------- settings ----------

test("settings default to papergames-style values and reject unknown ones", () => {
  assert.deepEqual(DEFAULT_CONFIG, { moveSeconds: 0, gameSeconds: 0, first: "random" });
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ moveSeconds: 45, gameSeconds: "300", first: "me" }), DEFAULT_CONFIG);
  const custom = { moveSeconds: 90, gameSeconds: 480, first: "guest" };
  assert.deepEqual(normalizeConfig({ ...custom, size: 10, level: "hard" }), custom);
});

test("who moves first: the coin toss, or the room's fixed choice", () => {
  for (const coin of [0, 1]) {
    assert.equal(makeRules({ first: "random" }).newState(coin).turn, coin);
    assert.equal(makeRules({ first: "host" }).newState(coin).turn, 0);
    assert.equal(makeRules({ first: "guest" }).newState(coin).turn, 1);
    assert.equal(makeRules({ first: "guest" }).newState(coin).first, 1);
  }
  assert.equal(makeRules({}).needsRandom(), false);
});

// ---------- clocks ----------

test("timed moves spend the mover's clock", () => {
  const s = makeRules({ moveSeconds: 30, gameSeconds: 180 }).newState(0);
  assert.equal(s.moveMs, 30_000);
  assert.deepEqual(s.clocks, [180_000, 180_000]);
  applyMove(s, 0, { path: [40, 33], ms: 12_345 });
  applyMove(s, 1, { path: [17, 24], ms: 1_000 });
  assert.deepEqual(s.clocks, [167_655, 179_000]);
  assert.equal(timeLeft(s, 0), 30_000, "the move limit is the tighter one");
  s.clocks[0] = 2_000;
  assert.equal(timeLeft(s, 0), 2_000, "the game clock is the tighter one");
});

test("timed moves need an honest move time within the limits", () => {
  const s = makeRules({ moveSeconds: 30, gameSeconds: 0 }).newState(0);
  assert.equal(s.clocks, null);
  for (const [move, msg] of [
    [{ path: [40, 33] }, /Move time missing/],
    [{ path: [40, 33], ms: -1 }, /Move time missing/],
    [{ path: [40, 33], ms: 1.5 }, /Move time missing/],
    [{ path: [40, 33], ms: 30_001 }, /Time ran out/],
  ]) {
    assert.throws(() => applyMove(s, 0, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
  }
  applyMove(s, 0, { path: [40, 33], ms: 30_000 });
  const bank = makeRules({ moveSeconds: 0, gameSeconds: 180 }).newState(0);
  bank.clocks[0] = 500;
  assert.throws(() => applyMove(bank, 0, { path: [40, 33], ms: 501 }), /Time ran out/);
});

test("running out of time loses the round", () => {
  const s = makeRules({ moveSeconds: 30, gameSeconds: 300 }).newState(1);
  applyMove(s, 1, { path: [17, 24], ms: 100 });
  assert.throws(() => applyMove(s, 1, { timeout: true }), /Not your turn/);
  const events = applyMove(s, 0, { timeout: true });
  assert.deepEqual(events, [{ type: "timeout", player: 0 }]);
  assert.equal(s.winner, 1);
  assert.equal(s.reason, "timeout");
  assert.throws(() => applyMove(s, 0, { path: [40, 33], ms: 0 }), /game is over/);
});

test("an untimed game has no timeouts and ignores move times", () => {
  const s = newState(0);
  assert.throws(() => applyMove(s, 0, { timeout: true }), /no clock/);
  applyMove(s, 0, { path: [40, 33], ms: 99_999_999 });
  assert.equal(s.board[33], 0);
});
