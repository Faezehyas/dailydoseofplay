// Connect 4 page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { makeRules, normalizeConfig, dimensions, colorOf, isTimed, timeLeft, landing, EMPTY, DRAW } from "./rules.js";
import { chooseMove } from "./robot.js";
import { mountSettings } from "./settings.js";

const ROBOT_DELAY = 600;
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };

const settings = mountSettings(document.getElementById("c4-settings"), document.getElementById("lobby"));

startGameShell({
  slug: "connect-4",
  title: "Connect 4",
  tagline: "Drop, stack and line up four before your rival does.",
  layout: "narrow",
  createRobot: (session) => {
    const config = settings.get();
    return startTurnRobot(session, {
      rules: makeRules(config),
      choose: (state, me, rng) => ({ ...chooseMove(state, me, rng, { level: config.level }), ms: ROBOT_DELAY }),
      delay: ROBOT_DELAY,
    });
  },
  onSession: (session, root, shell) => mountConnect4(session, root, shell),
});

const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function describeConfig(c, robot) {
  const { cols, rows } = dimensions(c.size);
  const parts = [`${cols} × ${rows}, four in a row`];
  parts.push(c.moveSeconds ? `${c.moveSeconds} s a move` : "no move limit");
  parts.push(c.gameSeconds ? `${c.gameSeconds / 60} min each` : "no game clock");
  if (robot) parts.push(`${LEVEL_NAME[c.level]} robot`);
  return parts.join(" · ");
}

function mountConnect4(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const score = { wins: [0, 0], draws: 0 };
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
    const disc = el("span", { class: "pill-disc" });
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"} mono`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    return { disc, clock };
  });
  const bar = playerBar(session, { onLeave: () => shell.leave() });
  bar.update({ badges: { [me]: pills[0].disc, [opp]: pills[1].disc } });
  const status = el("p", { class: "c4-status", id: "c4-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "c4-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left mono", id: "c4-move-left", role: "timer", "aria-label": "Time left for this move" });
  const clocks = el("div", { class: "c4-clocks", id: "c4-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const board = el("div", { class: "c4-board", id: "c4-board", role: "group", "aria-label": "Board" });
  const configLine = el("p", { class: "c4-config", id: "c4-config" });
  const note = el("p", { class: "c4-note", id: "c4-note" });
  const overBox = el("div", { class: "c4-over", id: "c4-over", hidden: true });
  let columns = [];
  let cells = [];

  root.append(
    el(
      "div",
      { class: "connect-4" },
      bar.node,
      status,
      clocks,
      el("div", { class: "c4-board-wrap" }, el("div", { class: "c4-frame" }, board)),
      configLine,
      note,
      overBox,
    ),
  );

  // Each column is one button; its squares run top to bottom like the board.
  function buildBoard({ cols, rows }) {
    cells = [];
    columns = Array.from({ length: cols }, (_, col) => {
      const squares = Array.from({ length: rows }, (_, row) => el("span", { class: "c4-cell", dataset: { i: row * cols + col, v: "" } }));
      squares.forEach((sq) => (cells[Number(sq.dataset.i)] = sq));
      return el("button", { type: "button", class: "c4-col", dataset: { col } }, squares);
    });
    board.style.setProperty("--cols", cols);
    board.style.setProperty("--rows", rows);
    board.parentElement.style.setProperty("--cols", cols);
    board.parentElement.style.setProperty("--rows", rows);
    board.setAttribute("aria-label", `Board, ${cols} columns`);
    board.replaceChildren(...columns);
  }

  // ---------- input ----------
  board.addEventListener("click", (e) => {
    const column = e.target.closest(".c4-col");
    if (!column || !match || match.phase !== "playing") return;
    const col = Number(column.dataset.col);
    if (!match.canMove()) return toast(match.state.turn === opp ? `Wait for ${oppName}` : "One moment…");
    if (landing(match.state, col) < 0) return toast("That column is full");
    const move = { col };
    if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
    match.play(move);
  });
  // Arrow keys (and Home/End) move between columns; Enter or Space drops (native button).
  board.addEventListener("keydown", (e) => {
    const column = e.target.closest(".c4-col");
    if (!column || !columns.length) return;
    const n = columns.length;
    const col = Number(column.dataset.col);
    const next = { ArrowLeft: col - 1, ArrowRight: col + 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    columns[(next + n) % n].focus();
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
    bar.update({ turn: match?.phase === "playing" ? st.turn : -1 });
    for (const [k, player] of [me, opp].entries()) {
      const { disc } = pills[k];
      const color = st ? colorOf(st, player) : "";
      disc.dataset.c = color;
      disc.setAttribute("aria-label", color ? `plays ${color}` : "colour not decided");
    }
  }

  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who starts…" : "Getting ready…";
      case "playing":
        return st.turn === me ? `Your turn. Drop a ${colorOf(st, me)} disc.` : `${oppName} is thinking…`;
      case "over":
        if (st.winner === DRAW) return "It's a draw. The board is full.";
        if (st.reason === "timeout") return st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
        return st.winner === me ? "You connected four. You win!" : `${oppName} wins this round.`;
      default:
        return "Match stopped.";
    }
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    root.querySelector(".connect-4").dataset.phase = phase;
    // Coral is whoever moves first this match, on every screen.
    root.querySelector(".connect-4").dataset.you = st ? (st.first === me ? "a" : "b") : "";
    renderPills();
    bar.update({ score });
    renderClocks(phase === "playing" ? performance.now() - turnStart : 0);
    status.textContent = statusText();
    status.classList.toggle("mine", phase === "playing" && st.turn === me);

    const myTurn = !!match?.canMove();
    board.classList.toggle("armed", myTurn);
    board.dataset.me = st ? colorOf(st, me) : "";
    board.classList.toggle("done", phase === "over" || phase === "aborted");
    const line = new Set(st?.line || []);
    const lastCol = st?.moves.at(-1);
    const lastCell = st && lastCol !== undefined ? (st.rows - st.heights[lastCol]) * st.cols + lastCol : -1;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const owner = st ? st.board[i] : EMPTY;
      const color = owner === EMPTY ? "" : colorOf(st, owner);
      if (cell.dataset.v !== color) {
        cell.dataset.v = color;
        if (color) {
          // The disc falls from above the board to its square.
          const disc = el("span", { class: "c4-disc" });
          disc.style.setProperty("--fall", Math.floor(i / st.cols) + 1);
          cell.replaceChildren(disc);
        } else cell.replaceChildren();
      }
      cell.classList.toggle("win", line.has(i));
      cell.classList.toggle("last", i === lastCell);
    }
    for (const [col, column] of columns.entries()) {
      const free = st ? st.rows - st.heights[col] : 0;
      const next = st ? landing(st, col) : -1;
      for (const cell of column.children) cell.classList.toggle("next", Number(cell.dataset.i) === next);
      const top = st && free < st.rows ? colorOf(st, st.board[free * st.cols + col]) : "";
      column.setAttribute("aria-label", `Column ${col + 1}, ${free ? `${free} free` : "full"}${top ? `, top disc ${top}` : ""}`);
      column.setAttribute("aria-disabled", String(!myTurn || !free));
    }
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
    else if (winner === DRAW) detail = "Every column is full and nobody lined up four.";
    else if (st.reason === "timeout") detail = winner === me ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else detail = `${winner === me ? "You" : oppName} connected four ${colorOf(st, winner)} discs.`;
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${oppName}…`;
    else if (rematch.them) rematchText = `${oppName} wants a rematch!`;
    overBox.replaceChildren(
      el("h2", { class: winner === me ? "win" : "", id: "c4-result" }, title),
      el("p", { class: `detail ${phase === "aborted" ? "bad" : ""}`, id: "c4-detail" }, detail),
      el(
        "div",
        { class: "c4-actions" },
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
    note.textContent = m === 1 ? `Playing against ${oppName}. Good luck!` : `Rematch #${m - 1}. Same settings, empty board.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => toast(reason));
    match.on("start", () => {
      turnStart = performance.now();
      const first = match.state.first;
      const who = first === me ? "you start" : `${oppName} starts`;
      note.textContent = config.first === "random" ? `Coin toss (drawn by both browsers): ${who} with coral.` : `Room setting: ${who} with coral.`;
      toast(first === me ? "You go first. You're coral!" : `${oppName} goes first with coral`);
    });
    match.on("events", () => (turnStart = performance.now()));
    match.on("over", ({ winner }) => {
      if (winner === DRAW) score.draws++;
      else score.wins[winner]++;
    });
    router.start(match);
    render();
  }

  // The room's settings come from whoever created it (the robot uses ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = describeConfig(config, session.mode === "robot");
    buildBoard(dimensions(config.size));
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
