// Gomoku page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { makeRules, normalizeConfig, stoneOf, isTimed, timeLeft, EMPTY, DRAW, SIZE } from "./rules.js";
import { chooseMove } from "./robot.js";
import { settings } from "./settings.js";

const ROBOT_DELAY = 600;
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const COLUMNS = "ABCDEFGHJKLMNOP"; // board coordinates skip I, as on Go boards
const STARS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];
const COUNT_WORD = { 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine" };

startGameShell({
  slug: "gomoku",
  title: "Gomoku",
  layout: "medium",
  settings,
  createRobot: (session) =>
    startTurnRobot(session, {
      rules: makeRules(settings.get()),
      choose: (state, me, rng) => ({ ...chooseMove(state, me, rng), ms: ROBOT_DELAY }),
      delay: ROBOT_DELAY,
    }),
  onSession: (session, root, shell) => mountGomoku(session, root, shell),
});

const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function describeConfig(c) {
  const parts = [`${SIZE} × ${SIZE}, five in a row`];
  parts.push(c.moveSeconds ? `${c.moveSeconds} s a move` : "no move limit");
  parts.push(c.gameSeconds ? `${c.gameSeconds / 60} min each` : "no game clock");
  return parts.join(" · ");
}

const pointName = (i) => `${COLUMNS[i % SIZE]}${SIZE - Math.floor(i / SIZE)}`;

function gridSvg() {
  const lines = [];
  for (let k = 0; k < SIZE; k++) {
    lines.push(`<line x1="0.5" y1="${k + 0.5}" x2="${SIZE - 0.5}" y2="${k + 0.5}"/>`, `<line x1="${k + 0.5}" y1="0.5" x2="${k + 0.5}" y2="${SIZE - 0.5}"/>`);
  }
  const stars = STARS.map(([r, c]) => `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="0.12"/>`).join("");
  return `<svg class="gmk-grid" viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">${lines.join("")}${stars}</svg>`;
}

function mountGomoku(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const score = { wins: [0, 0], draws: 0 };
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let destroyed = false;
  let turnStart = 0;
  let forfeited = false;
  let claimed = false;
  let focusCell = (SIZE * SIZE - 1) / 2;

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg)));

  // ---------- layout ----------
  const pills = [me, opp].map((player) => {
    const stone = el("span", { class: "pill-stone", dataset: { v: "" } });
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"} mono`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    return { stone, clock };
  });
  const bar = playerBar(session, { onLeave: () => shell.leave() });
  bar.update({ badges: { [me]: pills[0].stone, [opp]: pills[1].stone } });
  const status = el("p", { class: "gmk-status", id: "gmk-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "gmk-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left mono", id: "gmk-move-left", role: "timer", "aria-label": "Time left for this move" });
  const clocks = el("div", { class: "gmk-clocks", id: "gmk-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const cells = Array.from({ length: SIZE * SIZE }, (_, i) =>
    el("button", { type: "button", class: "gmk-cell", tabindex: i === focusCell ? "0" : "-1", dataset: { i, v: "" }, "aria-label": `${pointName(i)}, empty` }),
  );
  const board = el("div", { class: "gmk-board", id: "gmk-board", role: "group", "aria-label": "Board, 15 by 15. Arrow keys move between points." }, ...cells);
  board.insertAdjacentHTML("afterbegin", gridSvg());
  const configLine = el("p", { class: "gmk-config", id: "gmk-config" });
  const note = el("p", { class: "gmk-note", id: "gmk-note" });
  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "paper", highlight: (match.state.line || []).map((i) => cells[i]), board }),
  });

  root.append(
    el(
      "div",
      { class: "gomoku" },
      bar.node,
      status,
      clocks,
      el("div", { class: "gmk-board-wrap" }, board),
      configLine,
      note,
      result.node,
    ),
  );

  // ---------- input ----------
  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".gmk-cell");
    if (!cell || !match || match.phase !== "playing") return;
    const i = Number(cell.dataset.i);
    moveFocus(i, false);
    if (!match.canMove()) return toast(match.state.turn === opp ? `Wait for ${oppName}` : "One moment…");
    if (match.state.board[i] !== EMPTY) return toast("That point is taken");
    const move = { cell: i };
    if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
    match.play(move);
  });
  // Arrow keys move between points (one tab stop for the whole board); Enter or Space plays.
  board.addEventListener("keydown", (e) => {
    const cell = e.target.closest(".gmk-cell");
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!cell || !step) return;
    e.preventDefault();
    const i = Number(cell.dataset.i);
    const r = (Math.floor(i / SIZE) + step[0] + SIZE) % SIZE;
    const c = ((i % SIZE) + step[1] + SIZE) % SIZE;
    moveFocus(r * SIZE + c, true);
  });
  function moveFocus(i, focus) {
    cells[focusCell].tabIndex = -1;
    focusCell = i;
    cells[i].tabIndex = 0;
    if (focus) cells[i].focus();
  }

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
      const { stone } = pills[k];
      const v = st ? stoneOf(st, player) : "";
      stone.dataset.v = v;
      stone.setAttribute("aria-label", v ? (v === "first" ? "solid stones, moves first" : "ringed stones") : "stones not decided");
    }
  }

  const runWord = (st) => COUNT_WORD[st.line?.length] || "five";

  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who starts…" : "Getting ready…";
      case "playing":
        return st.turn === me ? (st.moves.length ? "Your turn. Place a stone." : "Your turn. Play anywhere.") : `${oppName} is thinking…`;
      case "over":
        if (st.winner === DRAW) return "It's a draw. The board is full.";
        if (st.reason === "timeout") return st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
        return st.winner === me ? `You win with ${runWord(st)} in a row!` : `${oppName} wins this round.`;
      default:
        return "Match stopped.";
    }
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    root.querySelector(".gomoku").dataset.phase = phase;
    // Coral is whoever moves first this match, on every screen.
    root.querySelector(".gomoku").dataset.you = st ? (st.first === me ? "a" : "b") : "";
    renderPills();
    bar.update({ score });
    renderClocks(phase === "playing" ? performance.now() - turnStart : 0);
    status.textContent = statusText();
    status.classList.toggle("mine", phase === "playing" && st.turn === me);

    const myTurn = !!match?.canMove();
    board.classList.toggle("armed", myTurn);
    board.dataset.me = st ? stoneOf(st, me) : "";
    const line = new Set(st?.line || []);
    const last = st?.moves.at(-1);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const owner = st ? st.board[i] : EMPTY;
      const v = owner === EMPTY ? "" : stoneOf(st, owner);
      if (cell.dataset.v !== v) cell.dataset.v = v;
      cell.classList.toggle("win", line.has(i));
      cell.classList.toggle("last", last === i);
      const who = owner === EMPTY ? "empty" : owner === me ? "your stone" : `${oppName}'s stone`;
      cell.setAttribute("aria-label", `${pointName(i)}, ${who}${line.has(i) ? ", winning line" : last === i ? ", last move" : ""}`);
      cell.setAttribute("aria-disabled", String(!myTurn || owner !== EMPTY));
    }
    board.classList.toggle("done", phase === "over" || phase === "aborted");
    board.classList.toggle("lined", line.size > 0);
    renderOver();
  }

  function renderOver() {
    const phase = match?.phase;
    if (phase !== "over" && phase !== "aborted") return result.hide();
    const st = match.state;
    const winner = phase === "over" ? st.winner : -1;
    let reason;
    if (phase === "aborted") reason = match.abortReason || "The match was stopped.";
    else if (winner === DRAW) reason = "Every point is filled and nobody made five. Well defended, both of you.";
    else if (st.reason === "timeout") reason = winner === me ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else reason = `${winner === me ? "You" : oppName} lined up ${runWord(st)} stones.`;
    result.show({ winner: winner === DRAW ? -1 : winner, stopped: phase === "aborted", reason });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
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
      note.textContent = config.first === "random" ? `Coin toss (drawn by both browsers): ${who} with the solid stones.` : `Room setting: ${who} with the solid stones.`;
      toast(first === me ? "You go first with the solid stones" : `${oppName} goes first`);
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
    configLine.textContent = describeConfig(config);
    newMatch();
  }
  function onSetup(msg) {
    if (me === 1) begin(msg.config);
  }

  const offs = [
    offMsg,
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
