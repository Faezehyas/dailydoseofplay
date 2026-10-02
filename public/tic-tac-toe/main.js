// Tic Tac Toe page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { makeRules, normalizeConfig, markOf, isTimed, timeLeft, EMPTY, DRAW, IN_A_ROW } from "./rules.js";
import { chooseMove } from "./robot.js";
import { mountSettings } from "./settings.js";

const MARK_SVG = {
  X: '<svg viewBox="0 0 100 100" class="mark x" aria-hidden="true"><path d="M24 24 76 76"/><path d="M76 24 24 76"/></svg>',
  O: '<svg viewBox="0 0 100 100" class="mark o" aria-hidden="true"><circle cx="50" cy="50" r="28"/></svg>',
};
const ROBOT_DELAY = 600;
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const IN_A_ROW_WORD = { 3: "three", 4: "four" };

const settings = mountSettings(document.getElementById("ttt-settings"), document.getElementById("lobby"));

startGameShell({
  slug: "tic-tac-toe",
  title: "Tic Tac Toe",
  tagline: "Line them up before your friend does. Quick to learn, sneaky to master.",
  createRobot: (session) =>
    startTurnRobot(session, {
      rules: makeRules(settings.get()),
      choose: (state, me, rng) => ({ ...chooseMove(state, me, rng), ms: ROBOT_DELAY }),
      delay: ROBOT_DELAY,
    }),
  onSession: (session, root, shell) => mountTicTacToe(session, root, shell),
});

const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function describeConfig(c) {
  const parts = [`${c.size} × ${c.size}, ${IN_A_ROW_WORD[IN_A_ROW[c.size]]} in a row`];
  parts.push(c.moveSeconds ? `${c.moveSeconds} s a move` : "no move limit");
  parts.push(c.gameSeconds ? `${c.gameSeconds / 60} min each` : "no game clock");
  return parts.join(" · ");
}

function mountTicTacToe(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const score = { me: 0, them: 0, draws: 0 };
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let rematch = { me: false, them: false };
  let destroyed = false;
  let turnStart = 0;
  let forfeited = false;
  let claimed = false;

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg)));

  // ---------- layout ----------
  const pills = [me, opp].map((player) => {
    const mark = el("span", { class: "pill-mark" }, "?");
    const node = el("span", { class: `who ${player === me ? "me" : ""}` }, mark, el("span", { class: "name" }, player === me ? myName : oppName));
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"}`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    return { node, mark, clock };
  });
  const players = el("div", { class: "ttt-players" }, pills[0].node, el("span", { class: "vs" }, "vs"), pills[1].node);
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
  const scoreBox = el("dl", { class: "ttt-score", id: "ttt-score", "aria-label": "Score" });
  const status = el("p", { class: "ttt-status", id: "ttt-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "ttt-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left", id: "ttt-move-left", role: "timer", "aria-label": "Time left for this move" });
  const clocks = el("div", { class: "ttt-clocks", id: "ttt-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const board = el("div", { class: "ttt-board", id: "ttt-board", role: "group", "aria-label": "Board" });
  const configLine = el("p", { class: "ttt-config", id: "ttt-config" });
  const note = el("p", { class: "ttt-note", id: "ttt-note" });
  const overBox = el("div", { class: "ttt-over", id: "ttt-over", hidden: true });
  let cells = [];

  root.append(
    el(
      "div",
      { class: "tic-tac-toe" },
      el("div", { class: "ttt-top" }, players, leaveBtn),
      scoreBox,
      status,
      clocks,
      el("div", { class: "ttt-board-wrap" }, board),
      configLine,
      note,
      overBox,
    ),
  );

  function buildBoard(size) {
    const cellName = (i) => `Row ${Math.floor(i / size) + 1}, column ${(i % size) + 1}`;
    cells = Array.from({ length: size * size }, (_, i) =>
      el("button", { type: "button", class: "ttt-cell", dataset: { i, v: "", name: cellName(i) }, "aria-label": `${cellName(i)}, empty` }),
    );
    board.style.setProperty("--n", size);
    board.classList.toggle("big", size > 3);
    board.replaceChildren(...cells);
  }

  // ---------- input ----------
  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".ttt-cell");
    if (!cell || !match || match.phase !== "playing") return;
    const i = Number(cell.dataset.i);
    if (!match.canMove()) return toast(match.state.turn === opp ? `Wait for ${oppName}` : "One moment…");
    if (match.state.board[i] !== EMPTY) return toast("That square is taken");
    const move = { cell: i };
    if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
    match.play(move);
  });
  // Arrow keys move between squares; Enter or Space plays (native button).
  board.addEventListener("keydown", (e) => {
    const cell = e.target.closest(".ttt-cell");
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!cell || !step || !config) return;
    e.preventDefault();
    const n = config.size;
    const i = Number(cell.dataset.i);
    const r = (Math.floor(i / n) + step[0] + n) % n;
    const c = ((i % n) + step[1] + n) % n;
    cells[r * n + c].focus();
  });

  // ---------- clocks ----------
  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !isTimed(match.state)) return;
    const st = match.state;
    const elapsed = performance.now() - turnStart;
    renderClocks(elapsed);
    const left = timeLeft(st, st.turn) - elapsed;
    if (st.turn === me && left <= 0 && !forfeited && match.canMove()) {
      forfeited = true;
      match.play({ timeout: true });
    } else if (st.turn === opp && left <= -CLAIM_GRACE_MS && !claimed) {
      // Their browser should have forfeited by now (closed laptop, frozen tab).
      claimed = true;
      match.send({ t: "abort", reason: "your clock ran out" });
      match.abort(`${oppName}'s clock ran out and their browser stopped answering.`);
    }
  }
  const ticker = setInterval(tick, 200);

  function renderClocks(elapsed = 0) {
    const st = match?.state;
    const playing = match?.phase === "playing";
    clocks.hidden = !st || !isTimed(st);
    if (clocks.hidden) return;
    for (const [k, player] of [me, opp].entries()) {
      const { clock } = pills[k];
      const running = playing && st.turn === player;
      clock.classList.toggle("active", running);
      clock.hidden = !st.clocks;
      if (!st.clocks) continue;
      const ms = st.clocks[player] - (running ? elapsed : 0);
      clock.textContent = clockText(ms);
      clock.classList.toggle("low", running && ms < 10_000);
    }
    const left = playing ? Math.max(0, timeLeft(st, st.turn) - elapsed) : 0;
    moveBar.hidden = !(playing && st.moveMs);
    moveBarFill.style.width = st.moveMs ? `${Math.min(1, left / st.moveMs) * 100}%` : "0%";
    moveBar.classList.toggle("mine", playing && st.turn === me);
    moveBar.classList.toggle("low", left < 5000);
    moveLeft.textContent = playing && st.moveMs ? `${Math.ceil(left / 1000)} s` : "";
  }

  // ---------- render ----------
  function renderPills() {
    const st = match?.state;
    for (const [k, player] of [me, opp].entries()) {
      const { node, mark } = pills[k];
      const symbol = st ? markOf(st, player) : null;
      node.classList.toggle("active", match?.phase === "playing" && st.turn === player);
      mark.setAttribute("aria-label", symbol ? `plays ${symbol}` : "mark not decided");
      if (mark.dataset.v !== (symbol || "")) {
        mark.dataset.v = symbol || "";
        mark.innerHTML = symbol ? MARK_SVG[symbol] : "?";
      }
    }
  }

  function renderScore() {
    const item = (label, n, cls) => el("div", { class: cls }, el("dt", {}, label), el("dd", {}, String(n)));
    scoreBox.replaceChildren(item("You", score.me, "mine"), item("Draws", score.draws, "draws"), item(oppName, score.them, "theirs"));
  }

  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who starts…" : "Getting ready…";
      case "playing":
        return st.turn === me ? `Your turn. Place your ${markOf(st, me)}.` : `${oppName} is thinking…`;
      case "over":
        if (st.winner === DRAW) return `It's a draw. Nobody got ${IN_A_ROW_WORD[st.k]} in a row.`;
        if (st.reason === "timeout") return st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
        return st.winner === me ? `You win with ${IN_A_ROW_WORD[st.k]} in a row!` : `${oppName} wins this round.`;
      default:
        return "Match stopped.";
    }
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    root.querySelector(".tic-tac-toe").dataset.phase = phase;
    renderPills();
    renderScore();
    renderClocks(phase === "playing" ? performance.now() - turnStart : 0);
    status.textContent = statusText();
    status.classList.toggle("mine", phase === "playing" && st.turn === me);

    const myTurn = !!match?.canMove();
    board.classList.toggle("armed", myTurn);
    const line = new Set(st?.line || []);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const owner = st ? st.board[i] : EMPTY;
      const mark = owner === EMPTY ? "" : markOf(st, owner);
      if (cell.dataset.v !== mark) {
        cell.dataset.v = mark;
        cell.innerHTML = mark ? MARK_SVG[mark] : "";
      }
      cell.classList.toggle("win", line.has(i));
      cell.classList.toggle("last", st?.moves.at(-1) === i);
      cell.setAttribute("aria-label", `${cell.dataset.name}, ${mark || "empty"}${line.has(i) ? ", winning line" : ""}`);
      cell.setAttribute("aria-disabled", String(!myTurn || owner !== EMPTY));
    }
    board.classList.toggle("done", phase === "over" || phase === "aborted");
    renderOver();
  }

  function renderOver() {
    const phase = match?.phase;
    if (phase !== "over" && phase !== "aborted") {
      overBox.hidden = true;
      return;
    }
    overBox.hidden = false;
    const st = match.state;
    const winner = phase === "over" ? st.winner : -1;
    const title = phase === "aborted" ? "Match stopped" : winner === DRAW ? "Draw" : winner === me ? "Victory!" : "Defeat";
    let detail;
    if (phase === "aborted") detail = match.abortReason || "The match was stopped.";
    else if (winner === DRAW) detail = "A full board and no line. Well defended, both of you.";
    else if (st.reason === "timeout") detail = winner === me ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else {
      const who = winner === me ? "You" : oppName;
      detail = `${who} lined up ${IN_A_ROW_WORD[st.k]} ${markOf(st, winner)}s.`;
    }
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${oppName}…`;
    else if (rematch.them) rematchText = `${oppName} wants a rematch!`;
    overBox.replaceChildren(
      el("h2", { class: winner === me ? "win" : "", id: "ttt-result" }, title),
      el("p", { class: `detail ${phase === "aborted" ? "bad" : ""}`, id: "ttt-detail" }, detail),
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
    forfeited = false;
    claimed = false;
    note.textContent = m === 1 ? `Playing against ${oppName}. Good luck!` : `Rematch #${m - 1}. Same settings, fresh board.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => toast(reason));
    match.on("start", () => {
      turnStart = performance.now();
      const first = match.state.first;
      const who = first === me ? "you start" : `${oppName} starts`;
      note.textContent = config.first === "random" ? `Coin toss (drawn by both browsers): ${who} with X.` : `Room setting: ${who} with X.`;
      toast(first === me ? "You go first. You're X!" : `${oppName} goes first with X`);
    });
    match.on("events", () => (turnStart = performance.now()));
    match.on("over", ({ winner }) => {
      if (winner === DRAW) score.draws++;
      else if (winner === me) score.me++;
      else score.them++;
    });
    router.start(match);
    render();
  }

  // The room's settings come from whoever created it (the robot uses ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = describeConfig(config);
    buildBoard(config.size);
    newMatch();
  }
  function onSetup(msg) {
    if (me === 1) begin(msg.config);
  }

  const offs = [
    offMsg,
    session.on("rematch", (votes) => {
      rematch = votes;
      if (votes.them && !votes.me) toast(`${oppName} wants a rematch`);
      render();
    }),
    session.on("rematch-start", () => config && newMatch()),
  ];
  if (session.mode === "robot") begin(settings.get());
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      clearInterval(ticker);
      for (const off of offs) off();
    },
  };
}
