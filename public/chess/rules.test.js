import test from "node:test";
import assert from "node:assert/strict";
import { RuleError } from "../engine/turn-match.js";
import {
  makeRules,
  newState as newTimedState,
  stateFromFen,
  applyMove,
  listMoves,
  legalMoves,
  genMoves,
  makeMove,
  unmakeMove,
  isAttacked,
  insufficientMaterial,
  parseFen,
  toFen,
  parseSquare,
  squareName,
  colorOfPlayer,
  normalizeConfig,
  timeLeft,
  DEFAULT_CONFIG,
  START_FEN,
  WHITE,
  BLACK,
  DRAW,
  EMPTY,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
} from "./rules.js";

const UNTIMED = { moveSeconds: 0, gameSeconds: 0 };
const newState = (first, config = UNTIMED) => newTimedState(first, config);
const sq = parseSquare;
// "e2e4" or "e7e8q" -> wire move.
function mv(lan) {
  const move = { from: sq(lan.slice(0, 2)), to: sq(lan.slice(2, 4)) };
  if (lan[4]) move.promo = lan[4];
  return move;
}
// Play moves in order, each by whoever's turn it is.
function play(state, ...lans) {
  for (const lan of lans) applyMove(state, state.turn, mv(lan));
  return state;
}
const fen = (f, white = 0) => stateFromFen(f, { white });
const sans = (state) => state.moves.map((m) => m.san).join(" ");

function perft(pos, depth) {
  if (depth === 0) return 1;
  let n = 0;
  const side = pos.side;
  for (const m of genMoves(pos)) {
    const undo = makeMove(pos, m);
    if (!isAttacked(pos.board, pos.kings[side], side ^ 1)) n += perft(pos, depth - 1);
    unmakeMove(pos, m, undo);
  }
  return n;
}

test("a new game starts from the standard position, and the first player has White", () => {
  for (const first of [0, 1]) {
    const s = newState(first);
    assert.equal(s.turn, first);
    assert.equal(s.white, first);
    assert.equal(s.winner, -1);
    assert.equal(colorOfPlayer(s, first), WHITE);
    assert.equal(colorOfPlayer(s, 1 - first), BLACK);
    assert.equal(toFen(s), START_FEN);
    assert.equal(listMoves(s).length, 20);
    assert.equal(s.board[sq("e1")], KING);
    assert.equal(s.board[sq("d8")], 8 + QUEEN);
    assert.equal(squareName(0), "a1");
    assert.equal(squareName(63), "h8");
  }
});

test("move generation matches the published perft counts", () => {
  const cases = [
    [START_FEN, [20, 400, 8902]],
    ["r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862]],
    ["8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]],
    ["r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]],
    ["rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379]],
  ];
  for (const [f, counts] of cases) {
    const pos = parseFen(f);
    counts.forEach((n, i) => assert.equal(perft(pos, i + 1), n, `${f} depth ${i + 1}`));
    assert.equal(toFen(pos), f, "make and unmake leave the position as it was");
  }
});

test("a legal move updates the board, the turn and the notation", () => {
  const s = newState(1);
  const events = applyMove(s, 1, mv("g1f3"));
  assert.deepEqual(events, [{ type: "moved", player: 1, from: sq("g1"), to: sq("f3"), san: "Nf3", captured: 0, capturedAt: -1, check: false }]);
  assert.equal(s.board[sq("f3")], KNIGHT);
  assert.equal(s.board[sq("g1")], EMPTY);
  assert.equal(s.turn, 0);
  play(s, "d7d5", "f3e5", "c8f5", "e5f7");
  assert.equal(sans(s), "Nf3 d5 Ne5 Bf5 Nxf7");
  assert.deepEqual(s.captured, [[PAWN], []]);
  assert.equal(toFen(s), "rn1qkbnr/ppp1pNpp/8/3p1b2/8/8/PPPPPPPP/RNBQKB1R b KQkq - 0 3");
});

test("notation: disambiguation, captures, checks, castling and promotion", () => {
  const knights = fen("4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1");
  applyMove(knights, 0, mv("c3e4"));
  assert.equal(knights.moves[0].san, "Nce4");
  const rooks = fen("4k3/R7/8/8/8/8/R7/4K3 w - - 0 1");
  applyMove(rooks, 0, mv("a2a5"));
  assert.equal(rooks.moves[0].san, "R2a5");
  const queens = fen("1k6/8/8/8/Q6Q/8/8/Q3K3 w - - 0 1");
  applyMove(queens, 0, mv("a4d4"));
  assert.equal(queens.moves[0].san, "Qa4d4");
  const promo = fen("3r1k2/4P3/8/8/8/8/8/4K3 w - - 0 1");
  applyMove(promo, 0, mv("e7d8q"));
  assert.equal(promo.moves[0].san, "exd8=Q+");
  const castle = fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  play(castle, "e1g1", "e8c8");
  assert.equal(sans(castle), "O-O O-O-O");
});

test("castling moves the rook, and needs rights, empty squares and no check on the king's path", () => {
  const base = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
  const s = fen(base);
  play(s, "e1c1", "e8g8");
  assert.equal(s.board[sq("c1")], KING);
  assert.equal(s.board[sq("d1")], ROOK);
  assert.equal(s.board[sq("a1")], EMPTY);
  assert.equal(s.board[sq("g8")], 8 + KING);
  assert.equal(s.board[sq("f8")], 8 + ROOK);
  assert.equal(s.castling, 0);

  const refused = (f, lan, msg) => {
    const st = fen(f);
    assert.throws(() => applyMove(st, st.turn, mv(lan)), (err) => err instanceof RuleError && msg.test(err.message), `${f} ${lan}`);
  };
  refused("r3k2r/8/8/8/8/8/8/R3K2R w Qkq - 0 1", "e1g1", /can't move there/); // no right
  refused("r3k2r/8/8/8/8/8/8/R2QK2R w KQkq - 0 1", "e1c1", /can't move there/); // blocked
  refused("r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1", "e1c1", /can't move there/); // b1 blocked too
  refused("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1".replace("8/8/8/8/8/8", "8/8/8/8/8/4r3"), "e1g1", /can't move there/); // in check
  refused("r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1", "e1g1", /can't move there/); // through f1
  refused("r3k2r/8/8/8/8/6r1/8/R3K2R w KQkq - 0 1", "e1g1", /can't move there/); // into g1
  // Queen side: b1 may be attacked, c1 and d1 may not.
  const ok = fen("r3k2r/8/8/8/8/1r6/8/R3K2R w KQkq - 0 1");
  applyMove(ok, 0, mv("e1c1"));
  assert.equal(ok.board[sq("c1")], KING);

  // Moving the king or a rook, or losing a rook, gives up the rights.
  const moved = fen(base);
  play(moved, "h1h2", "a8a7", "h2h1", "a7a8");
  assert.equal(toFen(moved).split(" ")[2], "Qk");
  const taken = fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  play(taken, "a1a8");
  assert.equal(toFen(taken).split(" ")[2], "Kk");
});

test("en passant: only right after the double step, and the passed pawn is removed", () => {
  const s = newState(0);
  play(s, "e2e4", "a7a6", "e4e5", "d7d5");
  assert.equal(squareName(s.ep), "d6");
  const [moved] = applyMove(s, 0, mv("e5d6"));
  assert.equal(moved.capturedAt, sq("d5"), "the passed pawn is taken from d5");
  assert.equal(moved.captured, PAWN);
  assert.equal(s.moves.at(-1).san, "exd6");
  assert.equal(s.board[sq("d5")], EMPTY);
  assert.equal(s.board[sq("d6")], PAWN);
  assert.deepEqual(s.captured[WHITE], [PAWN]);

  const late = newState(0);
  play(late, "e2e4", "d7d5", "e4e5", "f7f5", "a2a3", "a7a6");
  assert.throws(() => applyMove(late, 0, mv("e5f6")), /can't move there/, "the chance is gone one move later");
  assert.throws(() => applyMove(late, 0, mv("e5d6")), /can't move there/);
});

test("promotion needs a choice, allows any piece and is refused off the last row", () => {
  const f = "8/4P1k1/8/8/8/8/1p4K1/8 w - - 0 1";
  const s = fen(f);
  assert.throws(() => applyMove(s, 0, mv("e7e8")), (err) => err instanceof RuleError && /Pick a piece to promote to/.test(err.message));
  assert.throws(() => applyMove(s, 0, { ...mv("e7e8"), promo: "k" }), /queen, rook, bishop or knight/);
  assert.throws(() => applyMove(s, 0, { ...mv("e7e8"), promo: "Q" }), /queen, rook, bishop or knight/);
  assert.throws(() => applyMove(s, 0, { ...mv("g2g3"), promo: "q" }), /Only a pawn reaching the last row/);
  for (const [promo, type] of [["q", QUEEN], ["r", ROOK], ["b", BISHOP], ["n", KNIGHT]]) {
    const st = fen(f);
    applyMove(st, 0, mv(`e7e8${promo}`));
    assert.equal(st.board[sq("e8")], type);
    assert.equal(st.moves[0].promo, promo);
  }
  const knight = fen(f);
  applyMove(knight, 0, mv("e7e8n"));
  assert.equal(knight.moves[0].san, "e8=N+", "the new knight checks g7");
  applyMove(knight, 1, mv("g7f8"));
  applyMove(knight, 0, mv("g2h3"));
  applyMove(knight, 1, mv("b2b1r"));
  assert.equal(knight.board[sq("b1")], 8 + ROOK);
});

test("moves that leave the king in check are refused, as are malformed and out-of-turn moves", () => {
  // The e-file knight is pinned by the rook on e8.
  const s = fen("4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1");
  const snapshot = structuredClone(s);
  const cases = [
    [0, mv("e2c3"), /leave your king in check/],
    [0, mv("e1e2"), /can't move there/],
    [0, mv("e1e3"), /can't move there/],
    [0, mv("g8g7"), /your own pieces/],
    [0, mv("a1a2"), /your own pieces/],
    [1, mv("g8g7"), /Not your turn/],
    [0, { from: 64, to: 0 }, /square on the board/],
    [0, { from: -1, to: 0 }, /square on the board/],
    [0, { from: 4.5, to: 12 }, /square on the board/],
    [0, { from: "e1", to: "d1" }, /square on the board/],
    [0, {}, /square on the board/],
    [0, null, /square on the board/],
    [0, "e1d1", /square on the board/],
  ];
  for (const [player, move, msg] of cases) {
    assert.throws(() => applyMove(s, player, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
    assert.deepEqual(s, snapshot);
  }
  // A king may not step next to the other king or into a pawn's attack.
  const kings = fen("8/8/8/3k4/8/3Kp3/8/8 w - - 0 1");
  assert.throws(() => applyMove(kings, 0, mv("d3d4")), /leave your king in check/);
  assert.throws(() => applyMove(kings, 0, mv("d3d2")), /leave your king in check/);
  applyMove(kings, 0, mv("d3e3"));
});

test("a scripted full game: the fastest checkmate", () => {
  const s = newState(0);
  play(s, "f2f3", "e7e5", "g2g4");
  assert.equal(s.winner, -1);
  const events = applyMove(s, 1, mv("d8h4"));
  assert.deepEqual(events.at(-1), { type: "checkmate", player: 1 });
  assert.equal(s.winner, 1);
  assert.equal(s.reason, "checkmate");
  assert.equal(sans(s), "f3 e5 g4 Qh4#");
  assert.equal(s.turn, 0);
  assert.equal(listMoves(s).length, 0);
  assert.throws(() => applyMove(s, 0, mv("a2a3")), /game is over/);
  assert.throws(() => applyMove(s, 1, mv("a7a6")), /game is over/);
});

test("checkmate wins for the guest playing White too, with a longer mate", () => {
  const s = newState(1);
  play(s, "e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7");
  assert.equal(s.winner, 1);
  assert.equal(s.reason, "checkmate");
  assert.equal(s.moves.at(-1).san, "Qxf7#");
});

test("stalemate is a draw", () => {
  const s = fen("7k/8/6K1/8/8/8/5Q2/8 w - - 0 1");
  const events = applyMove(s, 0, mv("f2f7"));
  assert.deepEqual(events.at(-1), { type: "draw", reason: "stalemate" });
  assert.equal(s.winner, DRAW);
  assert.equal(s.reason, "stalemate");
});

test("the third time a position appears, the game is drawn", () => {
  const s = newState(0);
  const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
  play(s, ...shuffle, ...shuffle.slice(0, 3));
  assert.equal(s.winner, -1, "twice is not enough");
  const events = applyMove(s, 1, mv("f6g8"));
  assert.deepEqual(events.at(-1), { type: "draw", reason: "repetition" });
  assert.equal(s.reason, "repetition");
  assert.equal(s.winner, DRAW);

  // A pawn move or capture starts the count again.
  const reset = newState(0);
  play(reset, ...shuffle, "e2e4", "e7e5", ...shuffle, ...shuffle.slice(0, 3));
  assert.equal(reset.winner, -1);
});

test("an en passant chance only counts for repetition when it can be taken", () => {
  const s = newState(0);
  play(s, "e2e4");
  assert.equal(squareName(s.ep), "e3");
  assert.match(s.positions.at(-1), / -$/, "no black pawn can take on e3");
  play(s, "d7d5", "e4e5", "f7f5");
  assert.match(s.positions.at(-1), / f6$/);
});

test("fifty moves each without a capture or pawn move is a draw, unless the last one mates", () => {
  const s = fen("4k3/8/8/8/8/8/R7/4K3 w - - 98 80");
  play(s, "a2b2");
  assert.equal(s.winner, -1);
  const events = applyMove(s, 1, mv("e8d8"));
  assert.equal(s.halfmove, 100);
  assert.deepEqual(events.at(-1), { type: "draw", reason: "fifty" });
  const mate = fen("6k1/8/6K1/8/8/8/8/R7 w - - 99 80");
  applyMove(mate, 0, mv("a1a8"));
  assert.equal(mate.reason, "checkmate");
  assert.equal(mate.winner, 0);
});

test("too little material to mate is a draw", () => {
  // d7, f3 and a8 are light squares; c7 is dark.
  const drawn = ["8/8/4k3/8/8/4K3/8/8 w - - 0 1", "8/8/4k3/8/8/4KB2/8/8 w - - 0 1", "8/8/4k3/8/8/4KN2/8/8 w - - 0 1", "8/3b4/4k3/8/8/4KB2/8/8 w - - 0 1", "B7/3b4/4k3/8/8/4KB2/8/8 w - - 0 1"];
  const alive = ["8/8/4k3/8/8/4KNN1/8/8 w - - 0 1", "8/2b5/4k3/8/8/4KB2/8/8 w - - 0 1", "8/8/4k3/8/8/4KP2/8/8 w - - 0 1", "8/8/4k3/8/8/4KR2/8/8 w - - 0 1", "8/8/3nk3/8/8/4KB2/8/8 w - - 0 1"];
  for (const f of drawn) assert.equal(insufficientMaterial(parseFen(f).board), true, f);
  for (const f of alive) assert.equal(insufficientMaterial(parseFen(f).board), false, f);
  // Taking the last piece ends the game.
  const s = fen("8/8/8/4q3/3K4/8/8/7k w - - 0 1");
  const events = applyMove(s, 0, mv("d4e5"));
  assert.deepEqual(events.at(-1), { type: "draw", reason: "material" });
  assert.equal(s.winner, DRAW);
});

// ---------- settings ----------

test("settings default to papergames' values and reject unknown ones", () => {
  assert.deepEqual(DEFAULT_CONFIG, { moveSeconds: 0, gameSeconds: 0, first: "random", level: "easy" });
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig({ moveSeconds: 45, gameSeconds: "300", first: "me", level: "expert" }), DEFAULT_CONFIG);
  const custom = { moveSeconds: 120, gameSeconds: 3600, first: "guest", level: "hard" };
  assert.deepEqual(normalizeConfig({ ...custom, size: 9 }), custom);
});

test("who plays White: the coin toss, or the room's fixed choice", () => {
  for (const coin of [0, 1]) {
    assert.equal(makeRules({ first: "random" }).newState(coin).white, coin);
    assert.equal(makeRules({ first: "host" }).newState(coin).white, 0);
    const s = makeRules({ first: "guest" }).newState(coin);
    assert.equal(s.white, 1);
    assert.equal(s.turn, 1, "White moves first");
  }
  assert.equal(makeRules({}).needsRandom(), false);
});

// ---------- clocks and resigning ----------

test("timed moves spend the mover's clock within the limits", () => {
  const s = makeRules({ moveSeconds: 30, gameSeconds: 180 }).newState(0);
  assert.equal(s.moveMs, 30_000);
  assert.deepEqual(s.clocks, [180_000, 180_000]);
  applyMove(s, 0, { ...mv("e2e4"), ms: 12_345 });
  applyMove(s, 1, { ...mv("e7e5"), ms: 1_000 });
  assert.deepEqual(s.clocks, [167_655, 179_000]);
  assert.equal(timeLeft(s, 0), 30_000);
  for (const [move, msg] of [
    [mv("d2d4"), /Move time missing/],
    [{ ...mv("d2d4"), ms: -1 }, /Move time missing/],
    [{ ...mv("d2d4"), ms: 2.5 }, /Move time missing/],
    [{ ...mv("d2d4"), ms: 30_001 }, /Time ran out/],
  ]) {
    assert.throws(() => applyMove(s, 0, move), (err) => err instanceof RuleError && msg.test(err.message), JSON.stringify(move));
  }
  s.clocks[0] = 900;
  assert.equal(timeLeft(s, 0), 900, "the game clock is the tighter one");
  assert.throws(() => applyMove(s, 0, { ...mv("d2d4"), ms: 901 }), /Time ran out/);
  applyMove(s, 0, { ...mv("d2d4"), ms: 900 });
  assert.equal(s.clocks[0], 0);
});

test("running out of time loses; an untimed game has no timeouts", () => {
  const s = makeRules({ moveSeconds: 60, gameSeconds: 0, first: "host" }).newState(1);
  assert.equal(s.clocks, null);
  applyMove(s, 0, { ...mv("e2e4"), ms: 100 });
  assert.throws(() => applyMove(s, 0, { timeout: true }), /Not your turn/);
  assert.deepEqual(applyMove(s, 1, { timeout: true }), [{ type: "timeout", player: 1 }]);
  assert.equal(s.winner, 0);
  assert.equal(s.reason, "timeout");
  const untimed = newState(0);
  assert.throws(() => applyMove(untimed, 0, { timeout: true }), /no clock/);
  applyMove(untimed, 0, { ...mv("e2e4"), ms: 99_999_999 });
});

test("resigning on your turn gives the game to the opponent", () => {
  const s = newState(1);
  play(s, "e2e4");
  assert.throws(() => applyMove(s, 1, { resign: true }), /Not your turn/);
  assert.deepEqual(applyMove(s, 0, { resign: true }), [{ type: "resign", player: 0 }]);
  assert.equal(s.winner, 1);
  assert.equal(s.reason, "resign");
  assert.throws(() => applyMove(s, 1, { resign: true }), /game is over/);
});

test("legalMoves and listMoves agree, and listMoves uses the wire form", () => {
  const s = fen("8/4P1k1/8/8/8/8/6K1/8 w - - 0 1");
  assert.equal(legalMoves(s).length, listMoves(s).length);
  const promos = listMoves(s).filter((m) => m.from === sq("e7"));
  assert.deepEqual(promos.map((m) => m.promo).sort(), ["b", "n", "q", "r"]);
  assert.ok(listMoves(s).filter((m) => m.from === sq("g2")).every((m) => !("promo" in m)));
});
