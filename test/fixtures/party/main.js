// Test-only game for up to three players (test/browser/multiplayer.test.js):
// players take turns rolling a shared 1-3 die; the first total of 12 wins.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, RuleError, startTurnRobot } from "../engine/turn-match.js";
import { el } from "../engine/shell.js";

const rules = {
  newState: (first, players) => ({ turn: first, players, winner: -1, total: 0, log: [] }),
  needsRandom: () => true,
  applyMove(state, player, move, rng) {
    if (state.winner !== -1) throw new RuleError("game over");
    if (state.turn !== player) throw new RuleError("not your turn");
    if (move.type !== "roll") throw new RuleError("bad move");
    const n = 1 + Math.floor(rng() * 3);
    state.total += n;
    state.log.push([player, n]);
    if (state.total >= 12) state.winner = player;
    else state.turn = (player + 1) % state.players;
    return [{ type: "rolled", player, n }];
  },
};

startGameShell({
  slug: "party",
  title: "Party",
  minPlayers: 2,
  maxPlayers: 3,
  robots: 2,
  createRobot: (session) => startTurnRobot(session, { rules, choose: () => ({ type: "roll" }), delay: 50 }),
  onSession(session, root, shell) {
    const router = matchRouter(session);
    let match;
    let m = 0;
    let votes = { seats: [] };
    const players = el("p", { id: "party-players" });
    const status = el("p", { id: "party-status" });
    const move = el("button", { class: "btn primary", type: "button", id: "move", onclick: () => match.play({ type: "roll" }) }, ROLL_LABEL);
    const rematch = el("button", { class: "btn", type: "button", id: "rematch", onclick: () => session.requestRematch() }, "Rematch");
    const leave = el("button", { class: "btn ghost", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
    root.append(el("div", { class: "card" }, players, status, move, rematch, leave));
    players.textContent = session.players.map((p) => (p.seat === session.index ? `${p.name} (you)` : p.name)).join(", ");
    function render() {
      const s = match.state;
      move.disabled = !match.canMove();
      rematch.hidden = match.phase !== "over";
      if (match.phase === "over") status.textContent = `${session.players[s.winner].name} wins! Rematch votes: ${votes.seats.length}`;
      else if (match.phase === "playing") status.textContent = `Total ${s.total}. ${session.players[s.turn].name} to roll.`;
      else status.textContent = match.phase;
    }
    function newMatch() {
      match = new TurnMatch({ send: (msg) => session.send(msg), me: session.index, players: session.players.length, rules, m: ++m });
      window.ddp.match = match;
      match.on("update", render);
      router.start(match);
      render();
    }
    const offs = [
      session.on("rematch", (v) => ((votes = v), render())),
      session.on("rematch-start", () => ((votes = { seats: [] }), newMatch())),
    ];
    newMatch();
    return { destroy: () => offs.forEach((off) => off()) };
  },
});

// Declared after startGameShell() on purpose, like real games' helpers: the
// shell must not mount the game before this module has finished loading.
const ROLL_LABEL = "Roll";
