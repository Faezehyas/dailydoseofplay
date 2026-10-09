// Backgammon page: mounts the engine shell and renders a TurnMatch.
// The rules live in rules.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { makeRules, normalizeConfig, isTimed, timeLeft, legalSteps, legalPlays, applyStep, clonePos, pipCount, BAR, OFF, CHECKERS } from "./rules.js";
import { chooseMove, inContact, startRobot } from "./robot.js";
import { mountSettings } from "./settings.js";
import { play } from "./sounds.js";

const ROBOT_DELAY = 800;
const ROBOT_RACING = 250; // the robot's pause once you let the game race your checkers home
const ROLL_DELAY = 600; // before your dice roll themselves
const PASS_DELAY = 1600; // after a passed turn, so the notice can be read
const SETTLE_DELAY = 400; // after the opponent's checkers land, before your dice roll
const BEFORE_MOVE = 250; // the opponent's dice show a moment before their checkers move
const BETWEEN_STEPS = 140;
const FLY = { min: 240, perPx: 0.9, max: 620 }; // a checker's flight time, by distance
const MY_PACE = 0.7; // your own checkers fly faster than the replayed ones
const AUTO_DELAY = 450; // between the steps the game plays for you in a race
const FORCED_DELAY = 550; // before a move you have no choice about is played for you
const CLAIM_GRACE_MS = 5000; // past the opponent's limit before we stop waiting for their forfeit
const STACK = 5; // checkers drawn on a point; a taller stack shows its count
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
// The board from your side: your home board is bottom right, and you move
// from 24 at the top right, along the top, down and along the bottom to 1.
const TOP = [13, 14, 15, 16, 17, 18, "bar-top", 19, 20, 21, 22, 23, 24, "off-top"];
const BOTTOM = [12, 11, 10, 9, 8, 7, BAR, 6, 5, 4, 3, 2, 1, OFF];

const settings = mountSettings(document.getElementById("bg-settings"), document.getElementById("lobby"));
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

function robotChoice(level) {
  return (state, me, rng, ms) => {
    if (isTimed(state) && timeLeft(state, me) < ms) return { timeout: true };
    return { ...chooseMove(state, me, rng, { level }), ms };
  };
}

// True while you let the game move for you in a race: the robot then keeps the same quick pace.
let racingForYou = false;

startGameShell({
  slug: "backgammon",
  title: "Backgammon",
  layout: "medium",
  createRobot: (session) => {
    const config = settings.get();
    const delay = (state, me) => (racingForYou && !inContact(state.pos, me) ? ROBOT_RACING : ROBOT_DELAY);
    return startRobot(session, { rules: makeRules(config), choose: robotChoice(config.level), delay });
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
  const score = { wins: [0, 0] };
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let destroyed = false;
  let turnStart = 0;
  let forfeited = false;
  let claimed = false;
  let stage = null; // your turn in progress: { pos, dice, steps }
  let selected = null; // the point whose checker you picked
  let anim = null; // the opponent's play being replayed: { pos, dice }
  let settledAt = 0; // when the last replay ended
  let hidden = new Map(); // cell key -> checkers still in the air, hidden at the top of that cell
  let flying = 0;
  let rollId = 0; // bumps on every roll, so new dice tumble once
  let diceSig = "";
  let marks = null; // the opponent's last play: { left, came } as cell key -> checkers
  let auto = null; // racing home: null = not asked yet, true = the game moves for you, false = you said no
  let autoTimer = null;
  let rollTimer = null;
  let rolling = false;

  // One session handler: "setup" is for this view, everything else goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg) => (msg.t === "setup" ? onSetup(msg) : route(msg)));

  // ---------- layout ----------
  const pills = [me, opp].map((player) => {
    const clock = el("span", { class: `clock ${player === me ? "mine" : "theirs"} mono`, role: "timer", "aria-label": player === me ? "Your clock" : `${oppName}'s clock` });
    return { clock };
  });
  const bar = playerBar(session, { onLeave: () => shell.leave() });
  bar.update({ badges: [0, 1].map(() => el("span", { class: "swatch", "aria-hidden": "true" })) });
  const status = el("p", { class: "bg-status", id: "bg-status", role: "status", "aria-live": "polite" });
  const moveBarFill = el("span");
  const moveBar = el("div", { class: "bg-movebar", "aria-hidden": "true" }, moveBarFill);
  const moveLeft = el("span", { class: "move-left mono", id: "bg-move-left", role: "timer", "aria-label": "Time left for this turn" });
  const clocks = el("div", { class: "bg-clocks", id: "bg-clocks", hidden: true }, pills[0].clock, el("div", { class: "move" }, moveBar, moveLeft), pills[1].clock);
  const board = el("div", { class: "bg-board", id: "bg-board", role: "group", "aria-label": "Board" });
  const diceBox = el("div", { class: "bg-dice", id: "bg-dice", "aria-label": "Dice" });
  const undoBtn = el("button", { class: "btn small", type: "button", id: "bg-undo", onclick: () => undo() }, "Undo");
  const confirmBtn = el("button", { class: "btn primary small", type: "button", id: "bg-confirm", onclick: () => confirm() }, "Confirm");
  const autoBtn = el("button", { class: "btn ghost small", type: "button", id: "bg-auto", hidden: true, onclick: () => setAuto(!auto) });
  const turnBar = el("div", { class: "bg-turn" }, diceBox, el("div", { class: "bg-turn-actions" }, autoBtn, undoBtn, confirmBtn));
  const offer = el(
    "div",
    { class: "bg-offer", id: "bg-offer", role: "group", "aria-label": "Race home", hidden: true },
    el("p", {}, "It's a race now: nobody can be hit any more. Want the game to move your checkers for you?"),
    el(
      "div",
      { class: "bg-offer-actions" },
      el("button", { class: "btn small", type: "button", id: "bg-auto-no", onclick: () => setAuto(false) }, "I'll move"),
      el("button", { class: "btn primary small", type: "button", id: "bg-auto-yes", onclick: () => setAuto(true) }, "Play for me"),
    ),
  );
  const configLine = el("p", { class: "bg-config", id: "bg-config" });
  const note = el("p", { class: "bg-note", id: "bg-note" });
  const result = resultPanel(session, { onLeave: () => shell.leave() });

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
      bar.node,
      status,
      clocks,
      el("div", { class: "bg-board-wrap" }, board),
      offer,
      turnBar,
      configLine,
      note,
      result.node,
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

  function applyStaged(step, forced = false) {
    const done = applyStep(stage.pos, me, step.from, step.die);
    done.forced = forced;
    stage.steps.push(done);
    stage.dice.splice(stage.dice.indexOf(step.die), 1);
    return done;
  }

  function stageStep(step, drop, forced = !!forcedNext()) {
    moveOnScreen(me, step.from, step.to, () => {
      const done = applyStaged(step, forced);
      // Keep the moved checker picked when it can go on.
      const next = steps();
      selected = done.to !== OFF && next.some((s) => s.from === done.to) ? done.to : null;
      if (next.length && next.every((s) => s.from === next[0].from)) selected = next[0].from;
      return done;
    }, drop ? 0.45 : MY_PACE, drop);
  }

  // Takes back the last step you chose (forced steps after it go too, or they
  // would come straight back); the checker, and any checker it hit, flies home.
  function undo() {
    const chosen = stage ? stage.steps.findLastIndex((s) => !s.forced) : -1;
    if (chosen < 0) return;
    const last = stage.steps[chosen];
    const keep = stage.steps.slice(0, chosen);
    const after = stage.steps.length - 1 - chosen;
    const start = topRect(last.to);
    const blot = last.hit ? topRect("bar-top") : null;
    resetStage();
    for (const s of keep) applyStaged(s, s.forced);
    if (after) {
      render();
      return play("bar");
    }
    hide(last.from, 1);
    if (last.hit) hide(last.to, 1);
    render();
    const back = (whose, from, key) =>
      fly(whose, from, topRect(key), MY_PACE).then(() => {
        hide(key, -1);
        render();
        play("bar");
      });
    back("mine", start, last.from);
    if (last.hit) back("theirs", blot, last.to);
  }

  function confirm() {
    if (!stage?.steps.length || steps().length || !match.canMove()) return;
    const move = { type: "play", steps: stage.steps.map((s) => [s.from, s.die]) };
    if (isTimed(match.state)) move.ms = Math.round(performance.now() - turnStart);
    selected = null;
    marks = null;
    match.play(move);
  }

  function pick(n) {
    if (!match || match.phase !== "playing") return;
    if (!myTurn()) return toast(`Wait for ${oppName}`);
    if (!stage || match.working) return toast("Rolling…");
    if (auto) return toast("The game is moving for you. Press Stop to move yourself.");
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
    if (cell && !dragged) pick(Number(cell.dataset.n));
    dragged = false;
  });

  // Drag a checker with a mouse or finger; a press that doesn't move is a tap.
  let drag = null;
  let dragged = false;
  const cellAt = (x, y) => {
    const cell = document.elementFromPoint(x, y)?.closest("button[data-n]");
    return cell && board.contains(cell) ? Number(cell.dataset.n) : null;
  };
  board.addEventListener("pointerdown", (e) => {
    dragged = false;
    const cell = e.target.closest("button[data-n]");
    if (!cell || e.button !== 0 || drag || auto) return;
    const from = Number(cell.dataset.n);
    if (steps().some((s) => s.from === from)) drag = { from, id: e.pointerId, x: e.clientX, y: e.clientY, node: null, over: null };
  });
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.node) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      const at = topRect(drag.from);
      if (!at || !steps().some((s) => s.from === drag.from)) return (drag = null);
      drag.size = at;
      drag.node = ghost("mine", at);
      drag.node.classList.add("held");
      hide(drag.from, 1);
      selected = drag.from;
      render();
    }
    const b = board.getBoundingClientRect();
    const x = e.clientX - b.left - board.clientLeft - drag.size.w / 2;
    const y = e.clientY - b.top - board.clientTop - drag.size.h / 2;
    Object.assign(drag.node.style, { left: `${x}px`, top: `${y}px` });
    const over = cellAt(e.clientX, e.clientY);
    if (over !== drag.over) {
      cells.get(drag.over)?.classList.remove("over");
      drag.over = over;
      if (steps().some((s) => s.from === drag.from && s.to === over)) cells.get(over).classList.add("over");
    }
  }
  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { from, node, over } = drag;
    drag = null;
    if (!node) return;
    dragged = true;
    cells.get(over)?.classList.remove("over");
    const to = e.type === "pointerup" ? cellAt(e.clientX, e.clientY) : null;
    const there = steps()
      .filter((s) => s.from === from && s.to === to)
      .sort((a, b) => a.die - b.die);
    const b = board.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const at = { x: r.left - b.left - board.clientLeft, y: r.top - b.top - board.clientTop, w: r.width, h: r.height };
    node.classList.remove("held");
    if (there.length) {
      hide(from, -1);
      return stageStep(there[0], { start: at, node });
    }
    // Not a legal point: back where it came from, still picked.
    fly("mine", at, topRect(from), 0.6, node).then(() => {
      hide(from, -1);
      render();
    });
  }
  addEventListener("pointermove", onPointerMove);
  addEventListener("pointerup", endDrag);
  addEventListener("pointercancel", endDrag);
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

  // ---------- racing home: the game can move for you ----------
  const racing = () => match?.phase === "playing" && !inContact(match.state.pos, me);

  function setAuto(on) {
    auto = on;
    selected = null;
    if (!on) {
      clearTimeout(autoTimer);
      autoTimer = null;
    }
    render();
  }

  // The next step when you have no choice: it is the only legal one, or every
  // legal way to play the rest of the turn ends in the same position.
  let forcedMemo = null;
  function forcedNext() {
    const legal = steps();
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];
    if (forcedMemo?.stage === stage && forcedMemo.n === stage.steps.length) return forcedMemo.step;
    const plays = legalPlays(stage.pos, me, stage.dice);
    const [from, die] = plays.length === 1 ? plays[0].steps[0] : [];
    const step = legal.find((s) => s.from === from && s.die === die) || null;
    forcedMemo = { stage, n: stage.steps.length, step };
    return step;
  }
  const forcedTurn = () => !!stage?.steps.length && stage.steps.every((s) => s.forced);

  // The game moves for you, one step at a time so you can watch: a step you
  // have no choice about, and the end of a turn that was forced all the way.
  // In a race with auto-play on, every step: the robot's best play from where you stand.
  function scheduleAuto() {
    if (autoTimer || !stage || !myTurn() || match.working || flying || drag) return;
    if (!auto && !forcedNext() && !(forcedTurn() && !steps().length)) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      // Busy or landing: the next render schedules it again.
      if (destroyed || !stage || !myTurn() || match.working || flying || drag) return;
      const legal = steps();
      if (!legal.length) {
        if (auto) return confirm();
        if (!forcedTurn()) return;
        toast(`Only one way to play ${rollText(match.state.roll)}, so the game played it for you.`);
        return confirm();
      }
      if (!auto) {
        const step = forcedNext();
        return step && stageStep(step, undefined, true);
      }
      const [[from, die]] = chooseMove({ rolled: true, pos: stage.pos, dice: stage.dice }, me, Math.random, { level: "hard" }).steps;
      stageStep(legal.find((s) => s.from === from && s.die === die) || legal[0]);
    }, still ? 0 : auto ? AUTO_DELAY : FORCED_DELAY);
  }

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
    const now = performance.now();
    const wait = Math.max((match.state.last?.passed ? PASS_DELAY : ROLL_DELAY) - (now - turnStart), SETTLE_DELAY - (now - settledAt));
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

  // ---------- motion ----------
  // Checkers in the air are copies ("ghosts") that fly over the board; the
  // real checker waits hidden where it lands. The game's state never waits.
  const theirKey = (n) => (n === BAR ? "bar-top" : n === OFF ? "off-top" : 25 - n);
  const pause = (ms) => new Promise((r) => setTimeout(r, still ? 0 : ms));

  function hide(key, by) {
    const n = (hidden.get(key) || 0) + by;
    if (n > 0) hidden.set(key, n);
    else hidden.delete(key);
  }

  // Where the top checker (or slab) of a cell is drawn, relative to the board.
  function topRect(key) {
    const items = cells.get(key).querySelectorAll(".checker, .slab");
    const node = items[items.length - 1];
    if (!node) return null;
    const r = node.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    return { x: r.left - b.left - board.clientLeft, y: r.top - b.top - board.clientTop, w: r.width, h: r.height };
  }

  function ghost(whose, at) {
    const node = el("span", { class: `checker ${whose} ghost`, "aria-hidden": "true" });
    Object.assign(node.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${at.w}px`, height: `${at.h}px` });
    board.append(node);
    return node;
  }

  // Lifts a checker, carries it along a low arc and sets it down (squashed
  // into a slab when it lands in a tray). Resolves once it has landed.
  function fly(whose, from, to, pace = 1, node = null) {
    if (!from || !to || still || destroyed) {
      node?.remove();
      return Promise.resolve();
    }
    node ??= ghost(whose, from);
    flying++;
    const dx = to.x + to.w / 2 - (from.x + from.w / 2);
    const dy = to.y + to.h / 2 - (from.y + from.h / 2);
    const dist = Math.hypot(dx, dy);
    const lift = Math.min(22, 6 + dist * 0.06);
    const frames = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const grow = 1 + 0.16 * Math.sin(Math.PI * t);
      const sx = grow * (1 + t * (to.w / from.w - 1));
      const sy = grow * (1 + t * (to.h / from.h - 1));
      frames.push({ transform: `translate(${dx * t}px, ${dy * t - 4 * lift * t * (1 - t)}px) scale(${sx}, ${sy})` });
    }
    const ms = Math.min(FLY.max, FLY.min + dist * FLY.perPx) * pace;
    return node
      .animate(frames, { duration: ms, easing: "cubic-bezier(.45, 0, .25, 1)", fill: "forwards" })
      .finished.catch(() => {})
      .finally(() => {
        node.remove();
        flying--;
      });
  }

  // Plays one step on the board shown. `apply()` moves the checker in the
  // position being drawn and returns { hit }; a copy flies to where it lands,
  // then a checker it hit flies to the bar.
  async function moveOnScreen(player, from, to, apply, pace, drop = {}) {
    const key = (n) => (player === me ? n : theirKey(n));
    const whose = player === me ? "mine" : "theirs";
    const barKey = player === me ? "bar-top" : BAR;
    const start = drop.start ?? topRect(key(from));
    const under = topRect(key(to));
    const done = apply();
    hide(key(to), 1);
    if (done.hit) hide(barKey, 1);
    render();
    const knocked = done.hit && under && !still ? ghost(whose === "mine" ? "theirs" : "mine", under) : null;
    await fly(whose, start, topRect(key(to)), pace, drop.node);
    hide(key(to), -1);
    render();
    play(to === OFF ? "off" : done.hit ? "hit" : "place");
    if (!done.hit) return;
    await fly(null, under, topRect(barKey), pace, knocked);
    hide(barKey, -1);
    render();
    play("bar");
  }

  // The opponent's play, one checker at a time, after a short pause.
  // Net change per cell of the opponent's play, for the last-move marks.
  function lastMove(played) {
    const left = new Map();
    const came = new Map();
    for (const s of played) {
      left.set(theirKey(s.from), (left.get(theirKey(s.from)) || 0) + 1);
      came.set(theirKey(s.to), (came.get(theirKey(s.to)) || 0) + 1);
    }
    for (const [k, n] of came) {
      const both = Math.min(n, left.get(k) || 0);
      if (both) {
        came.set(k, n - both);
        left.set(k, left.get(k) - both);
      }
    }
    return { left, came };
  }

  async function replay(base, played, roll) {
    const run = (anim = { pos: clonePos(base), dice: roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : roll.slice() });
    marks = null;
    render();
    await pause(BEFORE_MOVE);
    for (const s of played) {
      if (anim !== run || destroyed) return;
      const quick = auto && racing();
      await moveOnScreen(opp, s.from, s.to, () => {
        run.dice.splice(run.dice.indexOf(s.die), 1);
        return applyStep(run.pos, opp, s.from, s.die);
      }, quick ? MY_PACE : 1);
      await pause(quick ? BETWEEN_STEPS / 2 : BETWEEN_STEPS);
    }
    if (anim !== run) return;
    anim = null;
    settledAt = performance.now();
    marks = lastMove(played);
    render();
  }

  // ---------- render ----------
  function shownPos() {
    if (stage) return stage.pos;
    if (anim) return anim.pos;
    return match?.state?.pos;
  }

  function checkerStack(count, whose, cls = "") {
    const out = [];
    for (let i = 0; i < Math.min(count, STACK); i++) out.push(el("span", { class: `checker ${whose} ${cls}` }));
    if (count > STACK) out[STACK - 1].append(el("b", {}, String(count)));
    return out;
  }

  function renderBoard(pos) {
    const legal = auto ? [] : steps();
    const sources = new Set(legal.map((s) => s.from));
    const dests = new Set(legal.filter((s) => s.from === selected).map((s) => s.to));
    const shownMarks = anim ? null : marks;
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
      const items = cell.querySelectorAll(".checker, .slab");
      const pending = hidden.get(key) || 0;
      for (let i = Math.max(0, items.length - pending); i < items.length; i++) items[i].classList.add("pending");
      const shown = items.length - pending;
      const top = items[shown - 1];
      top?.classList.add("top");
      // Where a picked checker would land: the next free spot, or around a
      // full stack's top checker, or around the blot it would hit.
      if (dests.has(key) && cell.classList.contains("point")) {
        if (top?.classList.contains("theirs")) top.classList.add("target");
        else if (shown >= STACK) top.classList.add("target");
        else cell.append(el("span", { class: "slot", "aria-hidden": "true" }));
      }
      // The opponent's last play: an outline where each checker left, a ring on each that arrived.
      if (shownMarks && cell.classList.contains("point")) {
        const came = Math.min(shownMarks.came.get(key) || 0, shown);
        for (let i = shown - came; i < shown; i++) if (items[i].classList.contains("theirs")) items[i].classList.add("arrived");
        const gone = Math.min(shownMarks.left.get(key) || 0, STACK - shown);
        for (let i = 0; i < gone; i++) cell.append(el("span", { class: "vacated", "aria-hidden": "true" }));
      }
      cell.classList.toggle("src", sources.has(key));
      cell.classList.toggle("selected", selected === key && !(drag?.node && drag.from === key));
      cell.classList.toggle("dest", dests.has(key));
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
    if (!st || match.phase === "starting") {
      diceSig = "";
      return diceBox.replaceChildren();
    }
    const current = st.rolled || st.winner !== -1;
    const fresh = current || !!anim;
    const roll = current ? st.roll : st.last?.roll || [];
    const owner = current ? st.turn : st.last?.player;
    const whose = owner === me ? "mine" : "theirs";
    if (!roll.length) {
      diceSig = "";
      return diceBox.replaceChildren();
    }
    const faces = roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : roll.slice();
    // Grey out the dice already played in the turn you are staging.
    const left = stage ? stage.dice.slice() : anim ? anim.dice.slice() : current && st.winner === -1 ? st.dice.slice() : [];
    const classes = faces.map((v) => {
      const i = left.indexOf(v);
      if (i >= 0) left.splice(i, 1);
      return `${whose} ${i < 0 ? "used" : ""} ${fresh ? "" : "old"} ${faces.length > 2 ? "small" : ""}`;
    });
    const sig = `${rollId}|${faces}|${classes}`;
    if (sig === diceSig) return;
    const tumble = current && !still && !diceSig.startsWith(`${rollId}|`);
    diceSig = sig;
    diceBox.replaceChildren(
      ...faces.map((v, k) => {
        const die = dieFace(v, classes[k] + (tumble ? " tumble" : ""));
        if (tumble) die.style.setProperty("--spin", `${(Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 160)}deg`);
        return die;
      }),
    );
    diceBox.setAttribute("aria-label", `${owner === me ? "Your" : `${oppName}'s`} ${fresh ? "" : "last "}roll: ${rollText(roll)}`);
  }

  function renderPills(pos) {
    bar.update({
      turn: match?.phase === "playing" ? match.state.turn : -1,
      notes: [0, 1].map((player) => (pos ? `${pipCount(pos[player])} pips` : "")),
    });
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
        if (auto) return `You rolled ${rollText(st.roll)}. Moving for you…`;
        if (stage && !match.working && forcedNext()) return `You rolled ${rollText(st.roll)}. There's only one way to play it: moving for you…`;
        if (stage && !match.working && !steps().length && forcedTurn()) return "That was the only way to play it. Passing the turn…";
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
    // Coral is whoever moves first this match, on every screen.
    root.querySelector(".backgammon").dataset.you = st ? (st.first === me ? "a" : "b") : "";
    renderPills(pos);
    bar.update({ score });
    renderClocks(phase === "playing" ? performance.now() - turnStart : 0);
    status.textContent = statusText();
    status.classList.toggle("mine", phase === "playing" && st.turn === me);
    renderBoard(pos);
    renderDice();
    const staging = !!stage && phase === "playing";
    turnBar.classList.toggle("mine", staging);
    undoBtn.hidden = confirmBtn.hidden = !staging;
    undoBtn.disabled = !stage?.steps.some((s) => !s.forced) || !!auto;
    confirmBtn.disabled = !stage?.steps.length || steps().length > 0 || !!match?.working || !!auto;
    const race = racing();
    racingForYou = session.mode === "robot" && race && !!auto;
    offer.hidden = !(race && auto === null && staging && !forcedNext() && !forcedTurn());
    autoBtn.hidden = !(race && auto !== null);
    autoBtn.textContent = auto ? "Stop" : "Play for me";
    autoBtn.setAttribute("aria-label", auto ? "Stop moving for me" : "Let the game move for me");
    board.classList.toggle("done", phase === "over" || phase === "aborted");
    renderOver();
    if (phase === "playing") {
      scheduleRoll();
      scheduleAuto();
    }
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the winning checkers finish moving first.
    if ((phase !== "over" && phase !== "aborted") || (phase === "over" && (anim || flying))) return result.hide();
    const st = match.state;
    const winner = phase === "over" ? st.winner : -1;
    let reason;
    if (phase === "aborted") reason = match.abortReason || "The match was stopped.";
    else if (st.reason === "timeout") reason = winner === me ? `${oppName}'s clock ran out.` : "Your clock ran out.";
    else {
      const left = CHECKERS - st.pos[1 - winner][OFF];
      reason = `${winner === me ? "You" : oppName} bore off all fifteen checkers, with ${left} of ${winner === me ? `${oppName}'s` : "yours"} still on the board.`;
    }
    result.show({ winner, stopped: phase === "aborted", reason });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    forfeited = false;
    claimed = false;
    rolling = false;
    clearTimeout(rollTimer);
    rollTimer = null;
    stage = null;
    selected = null;
    anim = null;
    hidden = new Map();
    marks = null;
    auto = null;
    clearTimeout(autoTimer);
    autoTimer = null;
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
        if (ev.type === "roll") {
          rollId++;
          play("dice");
        }
        if (ev.type === "pass") {
          toast(player === me ? `No move with ${rollText(ev.roll)}. Your turn passes.` : `${oppName} can't move with ${rollText(ev.roll)}.`);
        } else if (ev.type === "play" && player === opp) replay(base, ev.steps, match.state.last.roll);
        else if (ev.type === "play") marks = null;
      }
      base = clonePos(match.state.pos);
      resetStage();
    });
    match.on("over", ({ winner }) => {
      score.wins[winner]++;
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
      racingForYou = false;
      clearInterval(ticker);
      clearTimeout(rollTimer);
      clearTimeout(autoTimer);
      removeEventListener("pointermove", onPointerMove);
      removeEventListener("pointerup", endDrag);
      removeEventListener("pointercancel", endDrag);
      for (const off of offs) off();
    },
  };
}
