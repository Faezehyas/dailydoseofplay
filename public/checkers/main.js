// Checkers page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { makeRules, normalizeConfig, legalMoves, capturedBy, countPieces, isTimed, timeLeft, owner, isKing, isJump, isDark, EMPTY, DRAW, QUIET_LIMIT } from "./rules.js";
import { chooseMove } from "./robot.js";
import { mountSettings, normalizeLevel } from "./settings.js";
import { playMove } from "./sounds.js";

const CROWN_SVG =
  '<svg viewBox="0 0 24 24" class="crown" aria-hidden="true"><path d="M4 17.5h16l1.2-9.3-5.1 3.7L12 5.5l-4.1 6.4-5.1-3.7z"/></svg>';
const ROBOT_DELAY = 600;
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard" };

const settings = mountSettings(document.getElementById("ck-settings"), document.getElementById("lobby"));

startGameShell({
  slug: "checkers",
  title: "Checkers",
  tagline: "Hop, capture, crown a king. Leave your friend without a piece to move.",
  layout: "narrow",
  createRobot: (session) => {
    const { level, ...config } = settings.get();
    return startTurnRobot(session, {
      rules: makeRules(config),
      choose: (state, me, rng) => ({ ...chooseMove(state, me, rng, { level }), ms: ROBOT_DELAY }),
      delay: ROBOT_DELAY,
    });
  },
  onSession: (session, root, shell) => mountCheckers(session, root, shell),
});

const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function describeConfig(c, level) {
  const parts = ["8 × 8 checkers"];
  const m = c.moveSeconds;
  parts.push(m ? (m % 60 ? `${m} s a move` : `${m / 60} min a move`) : "no move limit");
  parts.push(c.gameSeconds ? `${c.gameSeconds / 60} min each` : "no game clock");
  if (level) parts.push(`${LEVEL_NAMES[level]} robot`);
  return parts.join(" · ");
}

const startsWith = (path, prefix) => path.length >= prefix.length && prefix.every((sq, k) => path[k] === sq);

function mountCheckers(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const flip = me === 1; // each player sees their own men at the bottom
  const score = { me: 0, them: 0, draws: 0 };
  let config = null;
  let level = null;
  let rules = null;
  let match = null;
  let m = 0;
  let rematch = { me: false, them: false };
  let destroyed = false;
  let turnStart = 0;
  let forfeited = false;
  let claimed = false;
  let picked = null; // the squares chosen so far this turn: [from, landing, ...]
  let focusSq = null;
  let noteText = "";

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg)));

  // ---------- layout ----------
  const pills = [me, opp].map((player) => {
    const disc = el("span", { class: "pill-disc" });
    const node = el("span", { class: `who ${player === me ? "me" : ""}` }, disc, el("span", { class: "name" }, player === me ? myName : oppName));
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"} mono`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    return { node, disc, clock };
  });
  const players = el("div", { class: "ck-players" }, pills[0].node, el("span", { class: "vs" }, "vs"), pills[1].node);
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
  const scoreBox = el("dl", { class: "ck-score", id: "ck-score", "aria-label": "Score" });
  const status = el("p", { class: "ck-status", id: "ck-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "ck-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left mono", id: "ck-move-left", role: "timer", "aria-label": "Time left for this move" });
  const clocks = el("div", { class: "ck-clocks", id: "ck-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const board = el("div", { class: "ck-board", id: "ck-board", role: "group", "aria-label": "Board" });
  const configLine = el("p", { class: "ck-config", id: "ck-config" });
  const note = el("p", { class: "ck-note", id: "ck-note" });
  const overBox = el("div", { class: "ck-over", id: "ck-over", hidden: true });

  // Visual position v (row-major, from this player's side) <-> board square.
  const toSq = (v) => (flip ? 63 - v : v);
  const cells = new Map(); // board square -> button, dark squares only
  for (let v = 0; v < 64; v++) {
    const sq = toSq(v);
    if (!isDark(sq)) {
      board.append(el("div", { class: "ck-sq light", "aria-hidden": "true" }));
      continue;
    }
    const name = `Row ${(v >> 3) + 1}, column ${(v & 7) + 1}`;
    const cell = el("button", { type: "button", class: "ck-sq dark", tabindex: "-1", dataset: { sq, name, v: "" } });
    cells.set(sq, cell);
    board.append(cell);
  }

  root.append(
    el(
      "div",
      { class: "checkers" },
      el("div", { class: "ck-top" }, players, leaveBtn),
      scoreBox,
      status,
      clocks,
      el("div", { class: "ck-board-wrap" }, board),
      configLine,
      note,
      overBox,
    ),
  );

  // ---------- input ----------
  const myMoves = () => (match?.phase === "playing" && match.state.turn === me ? legalMoves(match.state.board, me) : []);

  function send(path) {
    const move = { path };
    if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
    picked = null;
    match.play(move);
  }

  function choose(sq) {
    if (!match || match.phase !== "playing") return;
    const st = match.state;
    if (!match.canMove()) return toast(st.turn === opp ? `Wait for ${oppName}` : "One moment…");
    const legal = myMoves();
    if (picked) {
      const ways = legal.filter((m) => startsWith(m, picked));
      const next = ways.filter((m) => m[picked.length] === sq);
      if (next.length) {
        picked = [...picked, sq];
        const done = ways.find((m) => m.length === picked.length && m[picked.length - 1] === sq);
        return done ? send(done) : render();
      }
      // A tap on the final square of exactly one way plays the whole jump.
      const ends = ways.filter((m) => m[m.length - 1] === sq);
      if (ends.length === 1 && sq !== picked[0]) return send(ends[0]);
      if (picked.length > 1) {
        if (sq === picked[0]) {
          picked = null;
          return render();
        }
        return toast("Keep jumping: tap the next landing square");
      }
    }
    const piece = st.board[sq];
    if (piece !== EMPTY && owner(piece) === me) {
      if (picked?.[0] === sq) picked = null;
      else if (legal.some((m) => m[0] === sq)) picked = [sq];
      else return toast(isJump(legal[0]) ? "You must capture: pick a piece that can jump" : "That piece can't move");
      return render();
    }
    toast(picked ? "That piece can't move there" : "Pick one of your pieces");
  }

  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".ck-sq.dark");
    if (!cell) return;
    focusSq = Number(cell.dataset.sq);
    choose(focusSq);
  });
  // Arrow keys move between dark squares; Enter or Space picks (native button); Escape lets go.
  board.addEventListener("keydown", (e) => {
    const cell = e.target.closest(".ck-sq.dark");
    if (!cell) return;
    if (e.key === "Escape") {
      if (picked) {
        picked = null;
        render();
      }
      return;
    }
    const v = toSq(Number(cell.dataset.sq));
    let r = v >> 3;
    let c = v & 7;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") c = (c + (e.key === "ArrowLeft" ? 6 : 2)) % 8;
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      r = (r + (e.key === "ArrowUp" ? 7 : 1)) % 8;
      c ^= 1;
    } else return;
    e.preventDefault();
    focusSq = toSq(r * 8 + c);
    renderFocus();
    cells.get(focusSq).focus();
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
      picked = null;
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
    moveBar.classList.toggle("low", left < 10_000);
    moveLeft.textContent = playing && st.moveMs ? `${Math.ceil(left / 1000)} s` : "";
  }

  // ---------- render ----------
  const colorOf = (st, player) => (player === st.first ? "a" : "b");
  const pieceName = (st, piece) => `${owner(piece) === me ? "your" : `${oppName}'s`} ${isKing(piece) ? "king" : "man"}`;

  function renderPills() {
    const st = match?.state;
    for (const [k, player] of [me, opp].entries()) {
      const { node, disc } = pills[k];
      const left = st ? countPieces(st.board, player) : 12;
      node.classList.toggle("active", match?.phase === "playing" && st.turn === player);
      disc.dataset.c = st ? colorOf(st, player) : "";
      disc.textContent = String(left);
      disc.setAttribute("aria-label", `${left} pieces left${st ? (player === st.first ? ", moves first" : ", moves second") : ""}`);
    }
  }

  function renderScore() {
    const item = (label, n, cls) => el("div", { class: cls }, el("dt", {}, label), el("dd", {}, String(n)));
    scoreBox.replaceChildren(item("You", score.me, "mine"), item("Draws", score.draws, "draws"), item(oppName, score.them, "theirs"));
  }

  function statusText(legal) {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who starts…" : "Getting ready…";
      case "playing":
        if (st.turn !== me) return `${oppName} is thinking…`;
        if (picked?.length > 1) return "Keep jumping!";
        return legal.length && isJump(legal[0]) ? "Your turn. You must capture." : "Your turn.";
      case "over":
        if (st.winner === DRAW) return "It's a draw.";
        if (st.reason === "timeout") return st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
        return st.winner === me ? "You win!" : `${oppName} wins this round.`;
      default:
        return "Match stopped.";
    }
  }

  function renderFocus(movable = new Set()) {
    if (!cells.has(focusSq)) focusSq = [...movable][0] ?? cells.keys().next().value;
    for (const [sq, cell] of cells) cell.tabIndex = sq === focusSq ? 0 : -1;
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    root.querySelector(".checkers").dataset.phase = phase;
    // Coral is whoever moves first this match, on every screen.
    root.querySelector(".checkers").dataset.you = st ? (st.first === me ? "a" : "b") : "";
    const legal = myMoves();
    if (!legal.length || (picked && !legal.some((m) => startsWith(m, picked)))) picked = null;
    renderPills();
    renderScore();
    renderClocks(phase === "playing" ? performance.now() - turnStart : 0);
    status.textContent = statusText(legal);
    status.classList.toggle("mine", phase === "playing" && st.turn === me);
    const quiet = st && phase === "playing" && st.quiet >= QUIET_LIMIT - 10;
    note.textContent = quiet ? `No capture or new king for ${st.quiet} turns: a draw at ${QUIET_LIMIT}.` : noteText;

    const movable = new Set(legal.map((m) => m[0]));
    const ways = picked ? legal.filter((m) => startsWith(m, picked) && m.length > picked.length) : [];
    const targets = new Set(ways.map((m) => m[picked.length]));
    // Where a multi-jump would end: tapping there plays it all at once.
    const lastSquares = ways.map((m) => m[m.length - 1]);
    const ends = new Set(lastSquares.filter((sq) => !targets.has(sq) && sq !== picked[0] && lastSquares.indexOf(sq) === lastSquares.lastIndexOf(sq)));
    const taking = new Set(picked ? capturedBy(picked) : []);
    const last = st?.moves.at(-1);
    const lastCaptured = new Set(last ? capturedBy(last) : []);
    const lastMover = last ? owner(st.board[last.at(-1)]) : -1;
    board.classList.toggle("armed", legal.length > 0);
    board.classList.toggle("done", phase === "over" || phase === "aborted");
    for (const [sq, cell] of cells) {
      // While a jump is being picked, its piece is drawn where it has got to.
      let piece = st ? st.board[sq] : EMPTY;
      if (picked?.length > 1) {
        if (sq === picked[0]) piece = EMPTY;
        if (sq === picked.at(-1)) piece = st.board[picked[0]];
      }
      const ghost = piece === EMPTY && lastCaptured.has(sq) ? 1 - lastMover : -1;
      const fresh = last && sq === last.at(-1);
      const key = st ? `${piece}|${ghost}|${fresh ? st.moves.length : ""}|${st.first}` : "";
      if (cell.dataset.v !== key) {
        cell.dataset.v = key;
        cell.replaceChildren();
        if (piece !== EMPTY) {
          const disc = el("span", { class: `piece ${colorOf(st, owner(piece))} ${isKing(piece) ? "king" : ""} ${fresh ? "landed" : ""}` });
          if (isKing(piece)) disc.innerHTML = CROWN_SVG;
          cell.append(disc);
        } else if (ghost !== -1) {
          cell.append(el("span", { class: `piece ghost ${colorOf(st, ghost)}` }));
        }
      }
      const isPicked = picked?.at(-1) === sq;
      cell.classList.toggle("can", !picked && movable.has(sq));
      cell.classList.toggle("picked", isPicked);
      cell.classList.toggle("target", targets.has(sq));
      cell.classList.toggle("end", ends.has(sq));
      cell.classList.toggle("taking", taking.has(sq));
      cell.classList.toggle("trail", !!picked && picked.includes(sq) && !isPicked);
      cell.classList.toggle("last", !picked && !!last?.includes(sq));
      let label = `${cell.dataset.name}, ${piece === EMPTY ? "empty" : pieceName(st, piece)}`;
      if (isPicked) label += ", picked";
      else if (targets.has(sq)) label += ", move here";
      else if (ends.has(sq)) label += ", jump all the way here";
      else if (!picked && movable.has(sq)) label += ", can move";
      if (taking.has(sq)) label += ", being captured";
      cell.setAttribute("aria-label", label);
      cell.setAttribute("aria-disabled", String(!(movable.has(sq) || targets.has(sq) || ends.has(sq) || isPicked)));
    }
    renderFocus(movable);
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
    else if (winner === DRAW) detail = `${QUIET_LIMIT} turns in a row with no capture and no new king.`;
    else if (st.reason === "timeout") detail = winner === me ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else if (st.reason === "captured") detail = winner === me ? `You captured all of ${oppName}'s pieces.` : `${oppName} captured all your pieces.`;
    else detail = winner === me ? `${oppName} has no legal move left.` : "You have no legal move left.";
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${oppName}…`;
    else if (rematch.them) rematchText = `${oppName} wants a rematch!`;
    overBox.replaceChildren(
      el("h2", { class: winner === me ? "win" : "", id: "ck-result" }, title),
      el("p", { class: `detail ${phase === "aborted" ? "bad" : ""}`, id: "ck-detail" }, detail),
      el(
        "div",
        { class: "ck-actions" },
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
    picked = null;
    noteText = m === 1 ? `Playing against ${oppName}. Good luck!` : `Rematch #${m - 1}. Same settings, fresh board.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, rules, m });
    window.ddp.match = match; // browser tests read this
    match.on("update", render);
    match.on("invalid", (reason) => toast(reason));
    match.on("start", () => {
      turnStart = performance.now();
      const first = match.state.first;
      const who = first === me ? "you move first" : `${oppName} moves first`;
      noteText = config.first === "random" ? `Coin toss (drawn by both browsers): ${who}.` : `Room setting: ${who}.`;
      toast(first === me ? "You move first" : `${oppName} moves first`);
    });
    match.on("events", ({ events }) => {
      turnStart = performance.now();
      const moved = events.find((e) => e.type === "moved");
      if (moved) playMove(moved, moved.player === me);
      if (moved?.crowned && match.state.winner === -1) toast(moved.player === me ? "Crowned! Your piece is now a king" : `${oppName} crowned a king`);
    });
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
    configLine.textContent = describeConfig(config, level);
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
  if (session.mode === "robot") {
    const { level: chosen, ...c } = settings.get();
    level = normalizeLevel(chosen);
    begin(c);
  } else if (me === 0) {
    const c = normalizeConfig(settings.get());
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
