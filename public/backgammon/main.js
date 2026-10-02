// Backgammon page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { makeRules, normalizeConfig, isTimed, timeLeft, legalSteps, applyStep, clonePos, pipCount, BAR, OFF, CHECKERS } from "./rules.js";
import { chooseMove } from "./robot.js";
import { mountSettings } from "./settings.js";

const ROBOT_DELAY = 600;
const ROLL_DELAY = 600; // before your dice roll themselves
const PASS_DELAY = 1600; // after a passed turn, so the notice can be read
const STEP_MS = 350; // the opponent's checkers move one step at a time
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const STACK = 5; // checkers drawn on a point; a taller stack shows its count
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
// The board from your side: your home board is bottom right, and you move
// from 24 at the top right, along the top, down and along the bottom to 1.
const TOP = [13, 14, 15, 16, 17, 18, "bar-top", 19, 20, 21, 22, 23, 24, "off-top"];
const BOTTOM = [12, 11, 10, 9, 8, 7, BAR, 6, 5, 4, 3, 2, 1, OFF];

const settings = mountSettings(document.getElementById("bg-settings"), document.getElementById("lobby"));

function robotChoice(level) {
  return (state, me, rng) => {
    if (isTimed(state) && timeLeft(state, me) < ROBOT_DELAY) return { timeout: true };
    return { ...chooseMove(state, me, rng, { level }), ms: ROBOT_DELAY };
  };
}

startGameShell({
  slug: "backgammon",
  title: "Backgammon",
  tagline: "Roll, run and hit. Bring all fifteen checkers home and off the board first.",
  createRobot: (session) => {
    const config = settings.get();
    return startTurnRobot(session, { rules: makeRules(config), choose: robotChoice(config.level), delay: ROBOT_DELAY });
  },
  onSession: (session, root, shell) => mountBackgammon(session, root, shell),
});

const clockText = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const secondsText = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`);

function describeConfig(c, robot) {
  const parts = [c.moveSeconds ? `${secondsText(c.moveSeconds)} a turn` : "no turn limit", c.gameSeconds ? `${c.gameSeconds / 60} min each` : "no game clock"];
  if (robot) parts.push(`${LEVEL_NAME[c.level]} robot`);
  return parts.join(" · ");
}

const rollText = (roll) => (roll[0] === roll[1] ? `double ${roll[0]}s` : `${roll[0]} and ${roll[1]}`);

function dieFace(value, cls) {
  const spots = { 1: [5], 2: [3, 7], 3: [3, 5, 7], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] }[value];
  return el("span", { class: `die ${cls}`, role: "img", "aria-label": `${value}${cls.includes("used") ? ", played" : ""}` }, spots.map((s) => el("i", { style: `grid-area: s${s}` })));
}

function mountBackgammon(session, root, shell) {
  const me = session.index;
  const opp = 1 - me;
  const oppName = session.opponent.name;
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const score = { me: 0, them: 0 };
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let rematch = { me: false, them: false };
  let destroyed = false;
  let turnStart = 0;
  let forfeited = false;
  let claimed = false;
  let stage = null; // your turn in progress: { pos, dice, steps }
  let selected = null; // the point whose checker you picked
  let anim = null; // the opponent's play being replayed: { frames, steps, k, timer }
  let marks = new Set(); // the opponent's last play, as cell keys
  let rollTimer = null;
  let rolling = false;

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg)));

  // ---------- layout ----------
  const pills = [me, opp].map((player) => {
    const pips = el("small", { class: "pips" });
    const node = el(
      "span",
      { class: `who ${player === me ? "me" : "them"}` },
      el("span", { class: "swatch", "aria-hidden": "true" }),
      el("span", { class: "label" }, el("span", { class: "name" }, player === me ? myName : oppName), pips),
    );
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"}`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    return { node, pips, clock };
  });
  const players = el("div", { class: "bg-players" }, pills[0].node, el("span", { class: "vs" }, "vs"), pills[1].node);
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
  const scoreBox = el("dl", { class: "bg-score", id: "bg-score", "aria-label": "Score" });
  const status = el("p", { class: "bg-status", id: "bg-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "bg-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left", id: "bg-move-left", role: "timer", "aria-label": "Time left for this turn" });
  const clocks = el("div", { class: "bg-clocks", id: "bg-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const board = el("div", { class: "bg-board", id: "bg-board", role: "group", "aria-label": "Board" });
  const diceBox = el("div", { class: "bg-dice", id: "bg-dice", "aria-label": "Dice" });
  const undoBtn = el("button", { class: "btn small", type: "button", id: "bg-undo", onclick: () => undo() }, "Undo");
  const confirmBtn = el("button", { class: "btn primary small", type: "button", id: "bg-confirm", onclick: () => confirm() }, "Confirm");
  const turnBar = el("div", { class: "bg-turn" }, diceBox, el("div", { class: "bg-turn-actions" }, undoBtn, confirmBtn));
  const configLine = el("p", { class: "bg-config", id: "bg-config" });
  const note = el("p", { class: "bg-note", id: "bg-note" });
  const overBox = el("div", { class: "bg-over", id: "bg-over", hidden: true });

  // Every cell of the board, keyed by your point number (BAR, OFF) or "bar-top"/"off-top" for the opponent's.
  const cells = new Map();
  for (const [row, keys] of [TOP, BOTTOM].entries()) {
    for (const [col, key] of keys.entries()) {
      const kind = key === BAR || key === "bar-top" ? "bar" : key === OFF || key === "off-top" ? "tray" : "point";
      const mine = typeof key === "number";
      const attrs = { class: `bg-cell ${kind} ${row ? "bottom" : "top"}`, style: `grid-area: ${row ? 3 : 1} / ${col + 1}` };
      if (kind === "point") attrs.class += ` ${key % 2 ? "odd" : "even"}`;
      const cell = mine ? el("button", { ...attrs, type: "button", dataset: { n: key, row, col } }) : el("div", { ...attrs, "aria-hidden": "true" });
      cells.set(key, cell);
      board.append(cell);
    }
  }

  root.append(
    el(
      "div",
      { class: "backgammon" },
      el("div", { class: "bg-top" }, players, leaveBtn),
      scoreBox,
      status,
      clocks,
      el("div", { class: "bg-board-wrap" }, board),
      turnBar,
      configLine,
      note,
      overBox,
    ),
  );

  // ---------- turn in progress ----------
  const myTurn = () => match?.phase === "playing" && match.state.turn === me;
  const steps = () => (stage && !match.working ? legalSteps(stage.pos, me, stage.dice) : []);

  function resetStage() {
    const st = match.state;
    stage = myTurn() && st.rolled ? { pos: clonePos(st.pos), dice: st.dice.slice(), steps: [] } : null;
    selected = null;
  }

  function stageStep(step) {
    const done = applyStep(stage.pos, me, step.from, step.die);
    stage.steps.push(done);
    stage.dice.splice(stage.dice.indexOf(step.die), 1);
    // Keep the moved checker picked when it can go on.
    const next = steps();
    selected = done.to !== OFF && next.some((s) => s.from === done.to) ? done.to : null;
    if (next.length && next.every((s) => s.from === next[0].from)) selected = next[0].from;
    render();
  }

  function undo() {
    if (!stage?.steps.length) return;
    const keep = stage.steps.slice(0, -1);
    resetStage();
    for (const s of keep) stageStep(s);
    selected = null;
    render();
  }

  function confirm() {
    if (!stage?.steps.length || steps().length || !match.canMove()) return;
    const move = { type: "play", steps: stage.steps.map((s) => [s.from, s.die]) };
    if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
    selected = null;
    match.play(move);
  }

  function pick(n) {
    if (!match || match.phase !== "playing") return;
    if (!myTurn()) return toast(`Wait for ${oppName}`);
    if (!stage || match.working) return toast("Rolling…");
    const legal = steps();
    if (!legal.length) return toast("Press Confirm to end your turn, or Undo");
    if (selected !== null) {
      const there = legal.filter((s) => s.from === selected && s.to === n).sort((a, b) => a.die - b.die);
      if (there.length) return stageStep(there[0]);
      if (n === selected) {
        selected = null;
        return render();
      }
    }
    if (legal.some((s) => s.from === n)) {
      selected = n;
      return render();
    }
    if (stage.pos[me][BAR] && n !== BAR) return toast("Bring your checker on the bar back in first");
    toast(selected !== null ? "That checker can't go there" : "No checker of yours can move from there");
  }

  // ---------- input ----------
  board.addEventListener("click", (e) => {
    const cell = e.target.closest("button[data-n]");
    if (cell) pick(Number(cell.dataset.n));
  });
  // Arrow keys move around the board; Enter or Space picks (native button); Escape lets go.
  board.addEventListener("keydown", (e) => {
    const cell = e.target.closest("button[data-n]");
    if (!cell) return;
    if (e.key === "Escape" && selected !== null) {
      selected = null;
      return render();
    }
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!step) return;
    e.preventDefault();
    let row = Number(cell.dataset.row);
    let col = Number(cell.dataset.col);
    for (let k = 0; k < 14; k++) {
      if (step[0]) row = 1 - row;
      else col = (col + step[1] + 14) % 14;
      const next = cells.get((row ? BOTTOM : TOP)[col]);
      if (next?.tagName === "BUTTON") return next.focus();
      if (step[0]) return;
    }
  });

  // ---------- clocks and the automatic roll ----------
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

  function scheduleRoll() {
    if (rollTimer || rolling || anim || !myTurn() || match.state.rolled) return;
    const wait = (match.state.last?.passed ? PASS_DELAY : ROLL_DELAY) - (performance.now() - turnStart);
    rollTimer = setTimeout(() => {
      rollTimer = null;
      // Busy or replaying: the next render schedules it again.
      if (destroyed || rolling || anim || !match.canMove() || match.state.rolled) return;
      rolling = true;
      const move = { type: "roll" };
      if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
      match.play(move);
    }, Math.max(0, wait));
  }

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

  // ---------- the opponent's play, step by step ----------
  const theirKey = (n) => (n === BAR ? "bar-top" : n === OFF ? "off-top" : 25 - n);

  function replay(base, played) {
    const frames = [clonePos(base)];
    for (const s of played) {
      const next = clonePos(frames.at(-1));
      applyStep(next, opp, s.from, s.die);
      frames.push(next);
    }
    clearInterval(anim?.timer);
    anim = { frames, steps: played, k: 0 };
    marks = new Set();
    anim.timer = setInterval(() => {
      if (destroyed) return clearInterval(anim?.timer);
      anim.k++;
      if (anim.k >= anim.frames.length) {
        clearInterval(anim.timer);
        anim = null;
        marks = new Set(played.flatMap((s) => [theirKey(s.from), theirKey(s.to)]));
      }
      render();
    }, STEP_MS);
  }

  // ---------- render ----------
  function shownPos() {
    if (stage) return stage.pos;
    if (anim) return anim.frames[anim.k];
    return match?.state?.pos;
  }

  function checkerStack(count, whose, cls = "") {
    const out = [];
    for (let i = 0; i < Math.min(count, STACK); i++) out.push(el("span", { class: `checker ${whose} ${cls}` }));
    if (count > STACK) out[STACK - 1].append(el("b", {}, String(count)));
    return out;
  }

  function renderBoard(pos) {
    const legal = steps();
    const sources = new Set(legal.map((s) => s.from));
    const dests = new Set(legal.filter((s) => s.from === selected).map((s) => s.to));
    const moving = anim && anim.k > 0 ? anim.steps[anim.k - 1] : null;
    const hot = new Set(moving ? [theirKey(moving.from), theirKey(moving.to)] : marks);
    for (const [key, cell] of cells) {
      let label;
      if (!pos) {
        cell.replaceChildren();
        continue;
      }
      if (key === "bar-top" || key === "off-top") {
        const n = pos[opp][key === "bar-top" ? BAR : OFF];
        cell.replaceChildren(...(key === "bar-top" ? checkerStack(n, "theirs") : trayStack(n, "theirs")));
      } else if (key === BAR) {
        const n = pos[me][BAR];
        cell.replaceChildren(...checkerStack(n, "mine"));
        label = n ? `Your bar: ${n} checker${n > 1 ? "s" : ""}` : "Your bar: empty";
      } else if (key === OFF) {
        const n = pos[me][OFF];
        cell.replaceChildren(...trayStack(n, "mine"));
        label = `Borne off: ${n} of yours`;
      } else {
        const mine = pos[me][key];
        const theirs = pos[opp][25 - key];
        cell.replaceChildren(...(mine ? checkerStack(mine, "mine") : checkerStack(theirs, "theirs")));
        label = `Point ${key}: ${mine ? `${mine} of yours` : theirs ? `${theirs} of ${oppName}'s` : "empty"}`;
      }
      cell.classList.toggle("src", sources.has(key));
      cell.classList.toggle("selected", selected === key);
      cell.classList.toggle("dest", dests.has(key));
      cell.classList.toggle("hot", hot.has(key));
      if (cell.tagName === "BUTTON") {
        if (dests.has(key)) label += key === OFF ? ", bear off here" : ", move here";
        else if (selected === key) label += ", picked";
        else if (sources.has(key)) label += ", can move";
        cell.setAttribute("aria-label", label);
        cell.setAttribute("aria-disabled", String(!sources.has(key) && !dests.has(key)));
      }
    }
    board.classList.toggle("armed", sources.size > 0);
  }

  function trayStack(count, whose) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(el("span", { class: `slab ${whose}` }));
    if (count) out.push(el("b", { class: "tray-count" }, String(count)));
    return out;
  }

  function renderDice() {
    const st = match?.state;
    if (!st || match.phase === "starting") return diceBox.replaceChildren();
    const current = st.rolled || st.winner !== -1;
    const fresh = current || !!anim;
    const roll = current ? st.roll : st.last?.roll || [];
    const owner = current ? st.turn : st.last?.player;
    const whose = owner === me ? "mine" : "theirs";
    if (!roll.length) return diceBox.replaceChildren();
    const faces = roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : roll.slice();
    // Grey out the dice already played in the turn you are staging.
    const left = stage ? stage.dice.slice() : current && st.winner === -1 ? st.dice.slice() : [];
    diceBox.replaceChildren(
      ...faces.map((v) => {
        const i = left.indexOf(v);
        if (i >= 0) left.splice(i, 1);
        return dieFace(v, `${whose} ${i < 0 ? "used" : ""} ${fresh ? "" : "old"} ${faces.length > 2 ? "small" : ""}`);
      }),
    );
    diceBox.setAttribute("aria-label", `${owner === me ? "Your" : `${oppName}'s`} ${fresh ? "" : "last "}roll: ${rollText(roll)}`);
  }

  function renderPills(pos) {
    for (const [k, player] of [me, opp].entries()) {
      const { node, pips } = pills[k];
      node.classList.toggle("active", match?.phase === "playing" && match.state.turn === player);
      pips.textContent = pos ? `${pipCount(pos[player])} pips` : "";
    }
  }

  function renderScore() {
    const item = (label, n, cls) => el("div", { class: cls }, el("dt", {}, label), el("dd", {}, String(n)));
    scoreBox.replaceChildren(item("You", score.me, "mine"), item(oppName, score.them, "theirs"));
  }

  function statusText() {
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    switch (match.phase) {
      case "starting":
        return config.first === "random" ? "Tossing a coin to see who starts…" : "Getting ready…";
      case "playing":
        if (st.turn === opp) return st.rolled ? `${oppName} rolled ${rollText(st.roll)} and is moving…` : anim ? `${oppName} is moving…` : `${oppName} is rolling…`;
        if (!st.rolled) return anim ? `${oppName} is moving…` : "Your turn. Rolling the dice…";
        if (!steps().length && stage?.steps.length) return "All played. Press Confirm, or Undo to change it.";
        if (stage?.pos[me][BAR]) return `You rolled ${rollText(st.roll)}. Bring your checker back in.`;
        return selected !== null ? "Now pick where it goes." : `You rolled ${rollText(st.roll)}. Pick a checker to move.`;
      case "over":
        if (st.reason === "timeout") return st.winner === me ? `${oppName} ran out of time. You win!` : "You ran out of time.";
        return st.winner === me ? "All fifteen of yours are off. You win!" : `${oppName} bore off all fifteen first.`;
      default:
        return "Match stopped.";
    }
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = match?.phase || "setup";
    const pos = shownPos();
    root.querySelector(".backgammon").dataset.phase = phase;
    renderPills(pos);
    renderScore();
    renderClocks(phase === "playing" ? performance.now() - turnStart : 0);
    status.textContent = statusText();
    status.classList.toggle("mine", phase === "playing" && st.turn === me);
    renderBoard(pos);
    renderDice();
    const staging = !!stage && phase === "playing";
    turnBar.classList.toggle("mine", staging);
    undoBtn.hidden = confirmBtn.hidden = !staging;
    undoBtn.disabled = !stage?.steps.length;
    confirmBtn.disabled = !stage?.steps.length || steps().length > 0 || !!match?.working;
    board.classList.toggle("done", phase === "over" || phase === "aborted");
    renderOver();
    if (phase === "playing") scheduleRoll();
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the winning checkers finish moving first.
    if ((phase !== "over" && phase !== "aborted") || (phase === "over" && anim)) {
      overBox.hidden = true;
      if (overBox.firstChild) overBox.replaceChildren();
      return;
    }
    overBox.hidden = false;
    const st = match.state;
    const winner = phase === "over" ? st.winner : -1;
    const title = phase === "aborted" ? "Match stopped" : winner === me ? "Victory!" : "Defeat";
    let detail;
    if (phase === "aborted") detail = match.abortReason || "The match was stopped.";
    else if (st.reason === "timeout") detail = winner === me ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else {
      const left = CHECKERS - st.pos[1 - winner][OFF];
      detail = `${winner === me ? "You" : oppName} bore off all fifteen checkers, with ${left} of ${winner === me ? `${oppName}'s` : "yours"} still on the board.`;
    }
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${oppName}…`;
    else if (rematch.them) rematchText = `${oppName} wants a rematch!`;
    overBox.replaceChildren(
      el("h2", { class: winner === me ? "win" : "", id: "bg-result" }, title),
      el("p", { class: `detail ${phase === "aborted" ? "bad" : ""}`, id: "bg-detail" }, detail),
      el(
        "div",
        { class: "bg-actions" },
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
    rolling = false;
    clearTimeout(rollTimer);
    rollTimer = null;
    stage = null;
    selected = null;
    clearInterval(anim?.timer);
    anim = null;
    marks = new Set();
    note.textContent = m === 1 ? `Playing against ${oppName}. Good luck!` : `Rematch #${m - 1}. Same settings, fresh board.`;
    match = new TurnMatch({ send: (msg) => session.send(msg), me, rules, m });
    window.ddp.match = match; // browser tests read this
    let base = null;
    match.on("update", render);
    match.on("invalid", (reason) => {
      rolling = false;
      toast(reason);
    });
    match.on("start", () => {
      turnStart = performance.now();
      base = clonePos(match.state.pos);
      const first = match.state.first;
      const who = first === me ? "you start" : `${oppName} starts`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.first === "random" ? `Coin toss (drawn by both browsers): ${who}.` : `Room setting: ${who}.`);
      toast(first === me ? "You go first" : `${oppName} goes first`);
    });
    match.on("events", ({ player, events }) => {
      turnStart = performance.now();
      rolling = false;
      for (const ev of events) {
        if (ev.type === "pass") {
          toast(player === me ? `No move with ${rollText(ev.roll)}. Your turn passes.` : `${oppName} can't move with ${rollText(ev.roll)}.`);
        } else if (ev.type === "play" && player === opp) replay(base, ev.steps);
        else if (ev.type === "play") marks = new Set();
      }
      base = clonePos(match.state.pos);
      resetStage();
    });
    match.on("over", ({ winner }) => {
      if (winner === me) score.me++;
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
    configLine.textContent = describeConfig(config, session.mode === "robot");
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
      clearInterval(anim?.timer);
      clearTimeout(rollTimer);
      for (const off of offs) off();
    },
  };
}
