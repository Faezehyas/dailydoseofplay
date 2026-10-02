// Tic Tac Toe page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { rules, markOf, SIZE, CELLS, EMPTY, DRAW } from "./rules.js";
import { chooseMove } from "./robot.js";

const MARK_SVG = {
  X: '<svg viewBox="0 0 100 100" class="mark x" aria-hidden="true"><path d="M24 24 76 76"/><path d="M76 24 24 76"/></svg>',
  O: '<svg viewBox="0 0 100 100" class="mark o" aria-hidden="true"><circle cx="50" cy="50" r="28"/></svg>',
};

startGameShell({
  slug: "tic-tac-toe",
  title: "Tic Tac Toe",
  tagline: "Three in a row takes the round. Quick to learn, sneaky to master.",
  createRobot: (session) => startTurnRobot(session, { rules, choose: chooseMove, delay: 600 }),
  onSession: (session, root, shell) => mountTicTacToe(session, root, shell),
});

const cellName = (i) => `Row ${Math.floor(i / SIZE) + 1}, column ${(i % SIZE) + 1}`;

function mountTicTacToe(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const router = matchRouter(session);
  const score = { me: 0, them: 0, draws: 0 };
  let match = null;
  let m = 0;
  let rematch = { me: false, them: false };
  let destroyed = false;

  // ---------- layout ----------
  const players = el("div", { class: "ttt-players" });
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
  const scoreBox = el("dl", { class: "ttt-score", id: "ttt-score", "aria-label": "Score" });
  const status = el("p", { class: "ttt-status", id: "ttt-status", role: "status", "aria-live": "polite" });
  const note = el("p", { class: "ttt-note", id: "ttt-note" });
  const cells = Array.from({ length: CELLS }, (_, i) =>
    el("button", { type: "button", class: "ttt-cell", dataset: { i, v: "" }, "aria-label": `${cellName(i)}, empty` }),
  );
  const board = el("div", { class: "ttt-board", id: "ttt-board", role: "group", "aria-label": "Board" }, ...cells);
  const overBox = el("div", { class: "ttt-over", id: "ttt-over", hidden: true });

  root.append(
    el("div", { class: "tic-tac-toe" }, el("div", { class: "ttt-top" }, players, leaveBtn), scoreBox, status, el("div", { class: "ttt-board-wrap" }, board), note, overBox),
  );

  // ---------- input ----------
  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".ttt-cell");
    if (!cell || !match) return;
    const i = Number(cell.dataset.i);
    if (match.phase !== "playing") return;
    if (!match.canMove()) return toast(match.state.turn === opp ? `Wait for ${oppName}` : "One moment…");
    if (match.state.board[i] !== EMPTY) return toast("That square is taken");
    match.play({ cell: i });
  });
  // Arrow keys move between squares; Enter or Space plays (native button).
  board.addEventListener("keydown", (e) => {
    const cell = e.target.closest(".ttt-cell");
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!cell || !step) return;
    e.preventDefault();
    const i = Number(cell.dataset.i);
    const r = (Math.floor(i / SIZE) + step[0] + SIZE) % SIZE;
    const c = ((i % SIZE) + step[1] + SIZE) % SIZE;
    cells[r * SIZE + c].focus();
  });

  // ---------- render ----------
  function markFor(player) {
    return match.state ? markOf(match.state, player) : null;
  }

  function pill(player, name) {
    const st = match.state;
    const active = match.phase === "playing" && st.turn === player;
    const mark = markFor(player);
    const badge = el("span", { class: "pill-mark", "aria-label": mark ? `plays ${mark}` : "mark not decided" });
    badge.innerHTML = mark ? MARK_SVG[mark] : "?";
    return el("span", { class: `who ${player === me ? "me" : ""} ${active ? "active" : ""}` }, badge, el("span", { class: "name" }, name));
  }

  function renderScore() {
    const item = (label, n, cls) => el("div", { class: cls }, el("dt", {}, label), el("dd", {}, String(n)));
    scoreBox.replaceChildren(item("You", score.me, "mine"), item("Draws", score.draws, "draws"), item(oppName, score.them, "theirs"));
  }

  function statusText() {
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return "Tossing a coin to see who starts…";
      case "playing":
        return st.turn === me ? `Your turn. Place your ${markOf(st, me)}.` : `${oppName} is thinking…`;
      case "over":
        if (st.winner === DRAW) return "It's a draw. Nobody got three in a row.";
        return st.winner === me ? "You win! Three in a row." : `${oppName} wins this round.`;
      default:
        return "Match stopped.";
    }
  }

  function render() {
    if (destroyed || !match) return;
    const st = match.state;
    const phase = match.phase;
    root.querySelector(".tic-tac-toe").dataset.phase = phase;
    players.replaceChildren(pill(me, myName), el("span", { class: "vs" }, "vs"), pill(opp, oppName));
    renderScore();
    status.textContent = statusText();
    status.classList.toggle("mine", phase === "playing" && st.turn === me);

    const myTurn = match.canMove();
    board.classList.toggle("armed", myTurn);
    const line = new Set(st?.line || []);
    for (let i = 0; i < CELLS; i++) {
      const cell = cells[i];
      const owner = st ? st.board[i] : EMPTY;
      const mark = owner === EMPTY ? "" : markOf(st, owner);
      if (cell.dataset.v !== mark) {
        cell.dataset.v = mark;
        cell.innerHTML = mark ? MARK_SVG[mark] : "";
      }
      cell.classList.toggle("win", line.has(i));
      cell.classList.toggle("last", st?.moves.at(-1) === i);
      cell.setAttribute("aria-label", `${cellName(i)}, ${mark || "empty"}${line.has(i) ? ", winning line" : ""}`);
      cell.setAttribute("aria-disabled", String(!myTurn || owner !== EMPTY));
    }
    board.classList.toggle("done", phase === "over" || phase === "aborted");
    renderOver();
  }

  function renderOver() {
    const phase = match.phase;
    if (phase !== "over" && phase !== "aborted") {
      overBox.hidden = true;
      return;
    }
    overBox.hidden = false;
    const winner = phase === "over" ? match.state.winner : -1;
    const title = phase === "aborted" ? "Match stopped" : winner === DRAW ? "Draw" : winner === me ? "Victory!" : "Defeat";
    const detail =
      phase === "aborted"
        ? match.abortReason || "The match was stopped."
        : winner === DRAW
          ? "A full board and no line. Well defended, both of you."
          : winner === me
            ? `You lined up three ${markOf(match.state, me)}s.`
            : `${oppName} lined up three ${markOf(match.state, opp)}s.`;
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${oppName}…`;
    else if (rematch.them) rematchText = `${oppName} wants a rematch!`;
    overBox.replaceChildren(
      el("h2", { class: winner === me ? "win" : "", id: "ttt-result" }, title),
      el("p", { class: `detail ${phase === "aborted" ? "bad" : ""}` }, detail),
      el(
        "div",
        { class: "ttt-actions" },
        el(
          "button",
          { class: "btn primary", type: "button", id: "rematch", disabled: rematch.me, onclick: () => session.requestRematch() },
          rematch.them && !rematch.me ? "Accept rematch" : "Rematch",
        ),
        el("button", { class: "btn", type: "button", onclick: () => shell.leave() }, "Leave"),
      ),
      rematchText && el("p", { class: "rematch-status", id: "rematch-status" }, rematchText),
    );
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    rematch = { me: false, them: false };
    note.textContent = m === 1 ? `Playing against ${oppName}. Good luck!` : `Rematch #${m - 1}. New coin toss.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => toast(reason));
    match.on("start", ({ first }) => {
      note.textContent = `Coin toss (drawn by both browsers): ${first === me ? "you start" : `${oppName} starts`} with X.`;
      toast(first === me ? "You go first. You're X!" : `${oppName} goes first with X`);
    });
    match.on("over", ({ winner }) => {
      if (winner === DRAW) score.draws++;
      else if (winner === me) score.me++;
      else score.them++;
    });
    router.start(match);
    render();
  }

  const offs = [
    session.on("rematch", (votes) => {
      rematch = votes;
      if (votes.them && !votes.me) toast(`${oppName} wants a rematch`);
      render();
    }),
    session.on("rematch-start", newMatch),
  ];
  newMatch();

  return {
    destroy() {
      destroyed = true;
      for (const off of offs) off();
    },
  };
}
