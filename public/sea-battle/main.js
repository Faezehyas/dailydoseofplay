// Sea Battle page: mounts the engine shell and renders a match.
// All game logic lives in rules.js / match.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { play, playSample, preload } from "../engine/sound.js";
import { SeaBattleMatch } from "./match.js";
import { matchRouter } from "../engine/session.js";
import { startRobot } from "./robot.js";
import * as R from "./rules.js";

const ICON = {
  fire:
    '<svg viewBox="0 0 24 24" class="mk-fire" aria-hidden="true"><path class="fl1" d="M12 1.5c.8 3.2 4.8 5.6 4.8 10.6a4.8 4.8 0 0 1-9.6 0c0-2.4 1.1-4 2.2-5.2.2 1.7.9 2.8 2 3.2-.6-2.8-.2-5.6.6-8.6z"/><path class="fl2" d="M12 10.5c.5 1.6 2.4 2.6 2.4 4.6a2.4 2.4 0 0 1-4.8 0c0-1.4.8-2.3 1.5-3 .1.8.4 1.2.9 1.4 0-1.2-.2-2.1 0-3z"/></svg>',
  splash:
    '<svg viewBox="0 0 24 24" class="mk-splash" aria-hidden="true"><circle cx="12" cy="12" r="2.4"/><circle class="ring" cx="12" cy="12" r="5.5"/><circle class="ring2" cx="12" cy="12" r="9"/></svg>',
  gift:
    '<svg viewBox="0 0 24 24" class="mk-gift" aria-hidden="true"><rect class="g1" x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path class="g2" d="M9.2 9.6a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1-1.5 2v.6"/><circle class="g3" cx="12" cy="17.4" r="1.2"/></svg>',
  wreck:
    '<svg viewBox="0 0 24 24" class="mk-wreck" aria-hidden="true"><circle class="w1" cx="12" cy="12" r="7.5"/><path class="w2" d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/></svg>',
  clear: '<svg viewBox="0 0 24 24" class="mk-clear" aria-hidden="true"><circle cx="12" cy="12" r="2"/></svg>',
};

// Top-down warship art, drawn bow-right in a len x 1 box (100 units per
// square); vertical ships are the same drawing turned 90 degrees.
function turret(x, dir = 1) {
  const b = dir > 0 ? x + 8 : x - 38;
  return `<rect class="barrel" x="${b}" y="41.5" width="30" height="5" rx="2.5"/><rect class="barrel" x="${b}" y="53.5" width="30" height="5" rx="2.5"/><circle class="turret" cx="${x}" cy="50" r="15"/><circle class="hatch" cx="${x}" cy="50" r="5"/>`;
}
function bridge(x, w = 50) {
  return `<rect class="bridge" x="${x - w / 2}" y="31" width="${w}" height="38" rx="8"/><rect class="windows" x="${x + w / 2 - 11}" y="36" width="5" height="28" rx="2.5"/><circle class="mast" cx="${x - 5}" cy="50" r="6"/>`;
}
const funnel = (x) => `<ellipse class="funnel" cx="${x}" cy="50" rx="13" ry="11"/><ellipse class="funnel-top" cx="${x}" cy="50" rx="8" ry="6"/>`;

function shipSvg(len, vertical) {
  const W = len * 100;
  const hull = `M8 26 Q8 13 21 13 H${W - 52} C${W - 22} 13 ${W - 6} 33 ${W - 2} 50 C${W - 6} 67 ${W - 22} 87 ${W - 52} 87 H21 Q8 87 8 74 Z`;
  const deck = `M20 24 H${W - 56} C${W - 34} 24 ${W - 20} 37 ${W - 14} 50 C${W - 20} 63 ${W - 34} 76 ${W - 56} 76 H20 Z`;
  let parts;
  if (len >= 5) {
    // Carrier: flat flight deck, runway markings and an island on the side.
    parts = `<path class="flightdeck" d="M15 19 H${W - 80} L${W - 26} 50 L${W - 80} 81 H15 Z"/>
      <path class="runway" d="M32 50 H${W - 64}"/>
      <path class="runway-edge" d="M32 31 H${W - 130} M32 69 H${W - 130}"/>
      <rect class="bridge" x="${W * 0.55}" y="9" width="66" height="22" rx="5"/><circle class="mast" cx="${W * 0.55 + 16}" cy="20" r="5"/>
      <path class="plane" d="M${W * 0.28} 41 l20 9 -20 9 6 -9z M${W * 0.28 + 44} 41 l20 9 -20 9 6 -9z"/>`;
  } else if (len === 4) {
    parts = turret(W - 98) + turret(W - 150) + bridge(W - 215) + funnel(W - 268) + turret(66, -1);
  } else if (len === 3) {
    parts = turret(W - 92) + bridge(W - 158, 46) + funnel(W - 208) + turret(58, -1);
  } else {
    parts = turret(W - 76) + bridge(76, 44);
  }
  const art = `<path class="hull" d="${hull}"/><path class="deck" d="${deck}"/><path class="keel" d="M24 50 H${W - 40}"/>${parts}`;
  return vertical
    ? `<svg viewBox="0 0 100 ${W}" aria-hidden="true"><g transform="translate(100 0) rotate(90)">${art}</g></svg>`
    : `<svg viewBox="0 0 ${W} 100" aria-hidden="true">${art}</svg>`;
}

const WEAPON_ICON = {
  shot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  big: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 5.3L20 6l-3.5 4.6L21 14l-5.6.6L14 21l-2-5-2 5-1.4-6.4L3 14l4.5-3.4L4 6l5.8 1.3z"/></svg>',
  rain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v6M12 6v6M18 3v6M9 12v6M15 14v6M4 15v4M20 13v4"/></svg>',
  nuke: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 7.8 4.5L14.2 10.8M4.2 7.5A9 9 0 0 1 12 3M9.8 10.8 4.2 7.5M8 19.8l2.9-5.6M16 19.8l-2.9-5.6M8 19.8a9 9 0 0 0 8 0"/></svg>',
};

// The robot "thinks" this long (plus up to half again) before each shot.
const AI_DELAY = 1400;
// Seconds a shell is in the air before it lands (sound and visuals wait for it).
const FLIGHT = { shot: 0.45, big: 0.55, rain: 0.6, nuke: 1.0 };
// Real recordings (CC0, see sounds/LICENSE.txt): heavy objects hitting water,
// shells exploding on a steel hull, and bigger blasts at the waterline.
const sounds = (...names) => names.map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);
const SPLASH_HEAVY = sounds("splash-heavy-1", "splash-heavy-2");
const SPLASH_SMALL = sounds("splash-small-1", "splash-small-2");
const EXPLOSION = sounds("explosion-hit-1", "explosion-hit-2");
const BLAST = sounds("explosion-big-1", "explosion-big-2");
// Carpet bombing for missile rain: 7 booms, one every RAIN_STEP seconds, and
// each rain square lands on its boom.
const CARPET = sounds("carpet-bomb");
const RAIN_STEP = 0.17;
const splashHeavy = (gain = 0.7) => playSample(SPLASH_HEAVY, { gain, fallback: "miss" });
const explode = (gain = 0.65, opts) => playSample(EXPLOSION, { gain, fallback: "hit", ...opts });
const LAUNCH_SOUND = { shot: "launch", big: "launch-big", rain: "launch-rain", nuke: "launch-nuke" };
// Seconds per shot in friend games (papergames uses a per-turn clock too).
const TURN_SECONDS = 40;

startGameShell({
  slug: "sea-battle",
  title: "Sea Battle",
  tagline: "Hide your fleet, find theirs. Grab gifts for heavy weapons.",
  createRobot: (session) => startRobot(session, { delay: AI_DELAY }),
  onSession: (session, root, shell) => mountSeaBattle(session, root, shell),
});

function shipName(len, sunkCountOfLen) {
  if (len === 3) return sunkCountOfLen > 1 ? "second Cruiser" : "Cruiser";
  return R.SHIP_NAMES[len];
}

function mountSeaBattle(session, root, shell) {
  preload([...SPLASH_HEAVY, ...SPLASH_SMALL, ...EXPLOSION, ...BLAST, ...CARPET]);
  const me = session.index;
  const opp = R.other(me);
  const oppName = session.opponent.name;
  const router = matchRouter(session);
  let match = null;
  let m = 0;
  let fleet = null;
  let weapon = "shot";
  let destroyed = false;
  let lastAgain = false;
  let selectedShip = -1;
  let dragging = false;
  let rematchVotes = { me: false, them: false };
  const score = [0, 0]; // wins per player across rematches
  let lastShots = [new Set(), new Set()]; // board -> squares of the latest volley at it
  let lastTurnSeen = -1;
  const landsAt = [0, 0]; // per board: when the shell in flight lands (ms)
  const turnSeconds = session.mode === "friend" ? Number(window.ddpTurnSeconds) || TURN_SECONDS : 0;
  let timerKey = "";
  let timerId = null;
  let deadline = 0;
  let lastTick = -1;
  const offs = [];

  // ---------- layout ----------
  const status = el("p", { class: "sb-status", id: "sb-status", role: "status", "aria-live": "polite" });
  const players = el("div", { class: "sb-players" });
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: confirmLeave }, "Leave");
  const top = el("div", { class: "sb-top" }, players, leaveBtn);
  const clock = el("span", { class: "sb-clock", id: "sb-clock", hidden: true, "aria-live": "off" });

  const ownBoard = createBoard("Your fleet", false);
  const enemyBoard = createBoard(`${oppName}'s waters`, true);
  ownBoard.wrap.classList.add("own");
  enemyBoard.wrap.classList.add("enemy");

  const shuffleBtn = el("button", { class: "btn", type: "button", id: "shuffle", onclick: shuffle }, "Shuffle");
  const rotateBtn = el("button", { class: "btn", type: "button", id: "rotate", onclick: () => rotateShip(selectedShip) }, "Rotate");
  const readyBtn = el("button", { class: "btn primary", type: "button", id: "ready", onclick: onReady }, "Ready");
  const placeBar = el(
    "div",
    { class: "sb-place" },
    el("p", { class: "hint" }, "Drag ships to move them; press R while dragging to rotate. Or tap a ship to rotate it. Ships can't touch side by side."),
    el("div", { class: "sb-actions" }, shuffleBtn, rotateBtn, readyBtn),
  );
  const weaponsBar = el("div", { class: "sb-weapons", role: "toolbar", "aria-label": "Weapons" });
  const log = el("ol", { class: "sb-log", id: "sb-log", "aria-label": "Battle log" });
  const overBox = el("div", { class: "sb-over", id: "sb-over", hidden: true });

  root.append(
    el(
      "div",
      { class: "sea-battle" },
      top,
      el("div", { class: "sb-statusrow" }, status, clock),
      placeBar,
      overBox,
      el("div", { class: "sb-boards" }, enemyBoard.wrap, ownBoard.wrap),
      weaponsBar,
      log,
    ),
  );

  // ---------- board component ----------
  function createBoard(label, interactive) {
    const title = el("h2", { class: "board-title" }, label);
    const fleetInfo = el("div", { class: "fleet-left" });
    const cols = el("div", { class: "labels cols", "aria-hidden": "true" }, ..."ABCDEFGHIJ".split("").map((ch) => el("span", {}, ch)));
    const rows = el("div", { class: "labels rows", "aria-hidden": "true" }, ...Array.from({ length: 10 }, (_, i) => el("span", {}, String(i + 1))));
    const shipsLayer = el("div", { class: "layer ships" });
    const cellsLayer = el("div", { class: "layer cells", role: interactive ? "grid" : "img", "aria-label": label });
    const cells = [];
    for (let i = 0; i < R.CELLS; i++) {
      const cell = interactive
        ? el("button", { type: "button", class: "cell", dataset: { i }, "aria-label": R.cellName(i) })
        : el("div", { class: "cell", dataset: { i } });
      cell.style.gridArea = `${R.rowOf(i) + 1} / ${R.colOf(i) + 1}`;
      cell.dataset.v = "";
      cell.dataset.s = "";
      cells.push(cell);
      cellsLayer.append(cell);
    }
    const board = el("div", { class: "board" }, shipsLayer, cellsLayer);
    const frame = el("div", { class: "board-frame" }, el("span"), cols, rows, board);
    const wrap = el("section", { class: "board-wrap" }, el("div", { class: "board-head" }, title, fleetInfo), frame);
    return { wrap, board, cells, shipsLayer, cellsLayer, fleetInfo, title };
  }

  function shipEl(ship, cls) {
    const node = el("div", { class: `ship len${ship.len} ${ship.vertical ? "v" : "h"} ${cls || ""}` });
    node.innerHTML = shipSvg(ship.len, ship.vertical);
    placeShipEl(node, ship);
    return node;
  }
  function placeShipEl(node, ship) {
    node.style.gridRow = `${ship.r + 1} / span ${ship.vertical ? ship.len : 1}`;
    node.style.gridColumn = `${ship.c + 1} / span ${ship.vertical ? 1 : ship.len}`;
    node.classList.toggle("v", ship.vertical);
    node.classList.toggle("h", !ship.vertical);
  }
  const shipFromCells = (cells) => {
    const s = [...cells].sort((a, b) => a - b);
    return { r: R.rowOf(s[0]), c: R.colOf(s[0]), len: s.length, vertical: s.length > 1 && s[1] - s[0] === R.SIZE };
  };

  // showGifts: only the board you fire at shows gifts (yours to collect).
  function paintCells(view, board, last = new Set(), showGifts = false) {
    const giftAt = new Map(board && showGifts ? board.gifts.map((g) => [g.cell, g.type]) : []);
    const sunkAt = new Set(board ? board.sunk.flatMap((x) => x.cells) : []);
    for (let i = 0; i < R.CELLS; i++) {
      const v = board ? board.cells[i] : R.UNKNOWN;
      const gift = giftAt.has(i);
      const sunk = sunkAt.has(i);
      const key = `${v}${gift ? "g" : ""}${sunk ? "s" : ""}${last.has(i) ? "l" : ""}`;
      const cell = view.cells[i];
      if (cell.dataset.v === key) continue;
      const fresh = cell.dataset.s !== "" && cell.dataset.s !== String(v) && (v === R.HIT || v === R.MISS);
      cell.dataset.v = key;
      cell.dataset.s = String(v);
      cell.className = "cell";
      if (v === R.HIT) cell.classList.add(sunk ? "sunk" : "hit");
      else if (v === R.MISS) cell.classList.add("miss");
      else if (v === R.CLEAR) cell.classList.add("clear");
      if (gift) cell.classList.add("gift");
      if (last.has(i)) cell.classList.add("last");
      if (fresh) cell.classList.add("fresh");
      cell.innerHTML =
        v === R.HIT ? (sunk ? ICON.wreck : ICON.fire) : v === R.MISS ? ICON.splash : v === R.CLEAR ? ICON.clear : gift ? ICON.gift : "";
      if (view === enemyBoard) {
        const what = v === R.HIT ? (sunk ? "sunk" : "hit") : v === R.MISS ? "miss" : v === R.CLEAR ? "clear water" : gift ? "mystery gift" : "unexplored";
        cell.setAttribute("aria-label", `${R.cellName(i)}, ${what}`);
      }
    }
  }

  function fleetLeft(view, board) {
    const left = board ? R.remainingShips(board) : [...R.FLEET];
    view.fleetInfo.replaceChildren(
      ...R.FLEET.map((len) => {
        const k = left.indexOf(len);
        if (k >= 0) left.splice(k, 1);
        return el("span", { class: `pip len${len} ${k >= 0 ? "" : "gone"}`, title: `${R.SHIP_NAMES[len]} (${len})${k >= 0 ? "" : ", sunk"}` });
      }),
    );
  }

  // ---------- render ----------
  function render() {
    if (destroyed || !match) return;
    const phase = match.phase;
    const st = match.state;
    const placing = phase === "placing";
    root.querySelector(".sea-battle").dataset.phase = phase;

    players.replaceChildren(
      el(
        "span",
        { class: `who me ${st && st.turn === me && phase === "playing" ? "active" : ""}` },
        session.me.name === "You" ? "You" : `${session.me.name} (you)`,
        el("b", { class: "score", id: "score-me", title: "Wins" }, String(score[me])),
      ),
      el("span", { class: "vs" }, "vs"),
      el(
        "span",
        { class: `who ${st && st.turn === opp && phase === "playing" ? "active" : ""}` },
        el("b", { class: "score", id: "score-opp", title: "Wins" }, String(score[opp])),
        oppName,
      ),
    );

    // Status line
    let text = "";
    if (phase === "placing") {
      if (!match.locked) text = match.peer ? `${oppName} is ready. Place your fleet and press Ready.` : "Place your fleet, then press Ready.";
      else if (!match.peer) text = `Waiting for ${oppName} to place their ships…`;
      else text = "Tossing a coin to see who starts…";
    } else if (phase === "playing") {
      if (st.turn === me) {
        text = match.pending ? "Firing…" : lastAgain ? "Hit! Fire again." : "Your turn: fire at the enemy waters.";
      }
      else text = `${oppName} is aiming…`;
    } else if (phase === "over") {
      text = st.winner === me ? "You won! The enemy fleet is sunk." : `${oppName} won this round.`;
    } else if (phase === "aborted") {
      text = "Match stopped.";
    }
    status.textContent = text;
    status.className = `sb-status ${phase === "playing" && st.turn === me ? "mine" : ""}`;

    // Placement controls
    placeBar.hidden = !placing;
    readyBtn.disabled = match.locked;
    shuffleBtn.disabled = match.locked;
    rotateBtn.disabled = match.locked || selectedShip < 0;
    readyBtn.textContent = match.locked ? "Ready ✓" : "Ready";
    enemyBoard.wrap.hidden = placing;

    // Own board: ships + incoming fire (left alone while a ship is being dragged)
    if (!dragging) ownBoard.shipsLayer.replaceChildren(
      ...fleet.map((ship, k) => {
        const node = shipEl(ship, k === selectedShip && placing ? "selected" : "");
        node.dataset.k = k;
        if (placing && !match.locked) {
          node.classList.add("draggable");
          node.tabIndex = 0;
          node.setAttribute("role", "button");
          node.setAttribute("aria-label", `${R.SHIP_NAMES[ship.len]}, ${ship.len} squares at ${R.cellName(R.idx(ship.r, ship.c))}, ${ship.vertical ? "vertical" : "horizontal"}. Arrow keys move, R rotates.`);
          node.addEventListener("pointerdown", (e) => startDrag(e, k));
          node.addEventListener("keydown", (e) => keyMove(e, k));
        }
        if (st && st.boards[me].sunk.some((s) => s.cells.join() === R.shipCells(ship).sort((a, b) => a - b).join())) node.classList.add("sunk");
        return node;
      }),
    );
    paintCells(ownBoard, st && st.boards[me], lastShots[me]);
    ownBoard.wrap.classList.toggle("placing", placing);

    // Enemy board: sunk ships, revealed fleet at the end, our fire
    if (st) {
      const board = st.boards[opp];
      const shipNodes = board.sunk.map((s) => shipEl(shipFromCells(s.cells), "sunk"));
      if (phase === "over" && match.peerFleet && match.verdict?.ok) {
        const sunkKeys = new Set(board.sunk.map((s) => s.cells.join()));
        for (const ship of match.peerFleet) {
          if (!sunkKeys.has(R.shipCells(ship).sort((a, b) => a - b).join())) shipNodes.push(shipEl(ship, "revealed"));
        }
      }
      enemyBoard.shipsLayer.replaceChildren(...shipNodes);
      paintCells(enemyBoard, board, lastShots[opp], true);
      fleetLeft(enemyBoard, board);
      fleetLeft(ownBoard, st.boards[me]);
    } else {
      fleetLeft(ownBoard, null);
    }
    const myTurn = match.canFire();
    enemyBoard.wrap.classList.toggle("armed", myTurn);
    enemyBoard.cellsLayer.classList.toggle("rain", myTurn && weapon === "rain");
    setTabAlert(phase === "playing" && st.turn === me ? "Your turn" : null);
    if (phase === "playing" && st.turn !== lastTurnSeen) {
      lastTurnSeen = st.turn;
      if (st.turn === me) {
        play("turn");
        follow(enemyBoard);
      }
    }
    syncTimer();

    renderWeapons();
    renderOver();
  }

  // ---------- turn clock (friend games) ----------
  function syncTimer() {
    const st = match.state;
    const active = turnSeconds && match.phase === "playing" ? st.turn : -1;
    // A new clock for every shot opportunity, including "hit, fire again".
    const key = active === -1 ? "" : `${match.m}:${st.moves}:${active}`;
    if (key === timerKey) return;
    timerKey = key;
    clearInterval(timerId);
    if (active === -1) {
      clock.hidden = true;
      return;
    }
    deadline = Date.now() + turnSeconds * 1000;
    lastTick = -1;
    clock.hidden = false;
    tickClock(active);
    timerId = setInterval(() => tickClock(active), 250);
  }

  function tickClock(active) {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    clock.textContent = `${active === me ? "Your shot" : `${oppName}`}: ${left}s`;
    clock.classList.toggle("mine", active === me);
    clock.classList.toggle("low", left <= 10);
    if (active === me && left <= 5 && left > 0 && left !== lastTick) {
      lastTick = left;
      play("tick");
    }
    if (left > 0) return;
    clearInterval(timerId);
    if (active === me && match.canFire()) {
      const free = R.unexplored(match.state.boards[opp]);
      if (!free.length) return;
      toast("Time's up! A random shot was fired for you.");
      match.fire("shot", free[Math.floor(Math.random() * free.length)]);
    }
  }

  // On phones the two boards don't fit on one screen: keep the action in view.
  function follow(view) {
    if (innerWidth >= 760) return;
    const r = view.board.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= innerHeight) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    view.wrap.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "nearest" });
  }

  function confirmLeave() {
    const live = session.mode === "friend" && match && (match.phase === "playing" || match.phase === "placing");
    if (live && !confirm(`Leave the game? ${oppName} will be told you left.`)) return;
    shell.leave();
  }

  function renderWeapons() {
    const st = match.state;
    if (!st || match.phase !== "playing") {
      weaponsBar.hidden = true;
      return;
    }
    weaponsBar.hidden = false;
    const inv = st.inventory[me];
    if (weapon !== "shot" && !(inv[weapon] > 0)) weapon = "shot";
    const myTurn = match.canFire();
    weaponsBar.replaceChildren(
      ...Object.keys(R.WEAPONS).map((w) => {
        const count = w === "shot" ? "∞" : inv[w];
        const owned = w === "shot" || inv[w] > 0;
        const btn = el(
          "button",
          {
            type: "button",
            class: `weapon ${weapon === w ? "selected" : ""} ${owned ? "" : "empty"}`,
            dataset: { w },
            disabled: !owned || !myTurn,
            "aria-pressed": weapon === w ? "true" : "false",
            title: `${R.WEAPONS[w].label}: ${R.WEAPONS[w].help}`,
            onclick: () => {
              weapon = w;
              render();
            },
          },
          el("span", { class: "w-icon" }),
          el("span", { class: "w-label" }, R.WEAPONS[w].label),
          el("span", { class: "w-count" }, String(count)),
        );
        btn.querySelector(".w-icon").innerHTML = WEAPON_ICON[w];
        return btn;
      }),
    );
    if (weapon === "rain" && myTurn) {
      weaponsBar.append(
        el("button", { class: "btn primary launch", type: "button", id: "launch-rain", title: R.WEAPONS.rain.help, onclick: () => match.fire("rain") }, "Launch rain"),
      );
    }
  }

  function renderOver() {
    const phase = match.phase;
    if (phase !== "over" && phase !== "aborted") {
      overBox.hidden = true;
      return;
    }
    overBox.hidden = false;
    const won = phase === "over" && match.state.winner === me;
    let verdict;
    if (phase === "aborted") verdict = el("p", { class: "verdict bad" }, match.abortReason || "The match was stopped.");
    else if (!match.verdict) verdict = el("p", { class: "verdict" }, el("span", { class: "spinner" }), `Checking ${oppName}'s fleet against their locked-in commitment…`);
    else if (match.verdict.ok) verdict = el("p", { class: "verdict ok", id: "verdict" }, `✓ Fair play verified: every answer from ${oppName} matched the fleet they locked in.`);
    else verdict = el("p", { class: "verdict bad", id: "verdict" }, `⚠ ${oppName}'s answers don't add up: ${match.verdict.reason}.`);

    let rematchText = "";
    if (rematchVotes.me) rematchText = `Waiting for ${oppName}…`;
    else if (rematchVotes.them) rematchText = `${oppName} wants a rematch!`;
    overBox.replaceChildren(
      el("h2", { class: won ? "win" : "" }, phase === "aborted" ? "Match stopped" : won ? "Victory!" : "Defeat"),
      verdict,
      el(
        "div",
        { class: "sb-actions" },
        el("button", { class: "btn primary", type: "button", id: "rematch", disabled: rematchVotes.me, onclick: () => session.requestRematch() }, rematchVotes.them && !rematchVotes.me ? "Accept rematch" : "Rematch"),
        el("button", { class: "btn", type: "button", onclick: () => shell.leave() }, "Leave"),
      ),
      rematchText && el("p", { class: "rematch-status", id: "rematch-status" }, rematchText),
    );
  }

  function addLog(text, cls = "") {
    log.prepend(el("li", { class: cls }, text));
    while (log.children.length > 8) log.lastChild.remove();
  }

  // ---------- placement ----------
  function shuffle() {
    if (match.locked) return;
    fleet = R.randomFleet(Math.random);
    selectedShip = -1;
    match.setFleet(fleet);
    render();
  }

  function tryMove(k, candidate) {
    if (match.locked) return false;
    const others = fleet.filter((_, j) => j !== k);
    if (!R.canPlace(others, candidate)) return false;
    fleet = fleet.map((s, j) => (j === k ? candidate : s));
    match.setFleet(fleet);
    return true;
  }

  function rotateShip(k) {
    if (k < 0 || match.locked) return;
    const ship = fleet[k];
    const turned = { ...ship, vertical: !ship.vertical };
    // Try in place, then nudged back inside the board.
    const tries = [turned];
    for (let d = 1; d < ship.len; d++) tries.push(turned.vertical ? { ...turned, r: turned.r - d } : { ...turned, c: turned.c - d });
    if (!tries.some((t) => tryMove(k, t))) toast("No room to rotate this ship here");
    render();
  }

  function keyMove(e, k) {
    if (match.locked || dragging) return;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (moves[e.key]) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      tryMove(k, { ...fleet[k], r: fleet[k].r + dr, c: fleet[k].c + dc });
    } else if (e.key === "r" || e.key === "R" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      rotateShip(k);
    } else return;
    selectedShip = k;
    render();
    ownBoard.shipsLayer.querySelector(`[data-k="${k}"]`)?.focus();
  }

  function cellAt(view, x, y) {
    const rect = view.board.getBoundingClientRect();
    return {
      r: Math.floor(((y - rect.top) / rect.height) * R.SIZE),
      c: Math.floor(((x - rect.left) / rect.width) * R.SIZE),
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function startDrag(e, k) {
    if (match.locked || e.button > 0) return;
    e.preventDefault();
    const node = e.currentTarget;
    node.setPointerCapture?.(e.pointerId);
    const origin = fleet[k];
    const others = fleet.filter((_, j) => j !== k);
    const grab = cellAt(ownBoard, e.clientX, e.clientY);
    let vertical = origin.vertical;
    // Which square of the ship is under the pointer.
    let off = {
      r: clamp(grab.r - origin.r, 0, vertical ? origin.len - 1 : 0),
      c: clamp(grab.c - origin.c, 0, vertical ? 0 : origin.len - 1),
    };
    let pointer = { x: e.clientX, y: e.clientY };
    let moved = false;
    let candidate = origin;
    dragging = true;
    node.classList.add("dragging");
    const update = () => {
      const at = cellAt(ownBoard, pointer.x, pointer.y);
      const next = {
        ...origin,
        vertical,
        r: clamp(at.r - off.r, 0, R.SIZE - (vertical ? origin.len : 1)),
        c: clamp(at.c - off.c, 0, R.SIZE - (vertical ? 1 : origin.len)),
      };
      if (next.r === candidate.r && next.c === candidate.c && next.vertical === candidate.vertical) return;
      moved = moved || next.r !== origin.r || next.c !== origin.c || next.vertical !== origin.vertical;
      candidate = next;
      placeShipEl(node, candidate);
      node.classList.toggle("bad", !R.canPlace(others, candidate));
    };
    const onMove = (ev) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      update();
    };
    // R while dragging rotates the ship around the square you're holding.
    const onKey = (ev) => {
      if (ev.key !== "r" && ev.key !== "R") return;
      ev.preventDefault();
      ev.stopPropagation();
      vertical = !vertical;
      off = { r: off.c, c: off.r };
      node.innerHTML = shipSvg(origin.len, vertical);
      update();
    };
    const onUp = () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
      removeEventListener("keydown", onKey, true);
      dragging = false;
      if (match.locked) return render(); // Ready was pressed mid-drag: snap back
      if (!moved) {
        if (selectedShip === k) rotateShip(k);
        selectedShip = k;
      } else if (!tryMove(k, candidate)) {
        toast("Ships can't overlap or touch side by side");
      } else {
        selectedShip = k;
      }
      render();
    };
    node.addEventListener("pointermove", onMove);
    node.addEventListener("pointerup", onUp);
    node.addEventListener("pointercancel", onUp);
    addEventListener("keydown", onKey, true);
  }

  function onReady() {
    match.ready();
    if (match.locked) fleet = match.fleet; // show exactly the fleet that was locked in
    selectedShip = -1;
    render();
  }

  // ---------- firing ----------
  function clearAim() {
    for (const c of enemyBoard.cells) c.classList.remove("aim");
  }
  function showAim(i) {
    clearAim();
    if (!match.canFire() || weapon === "rain") return;
    const board = match.state.boards[opp];
    const cells = weapon === "shot" ? (board.cells[i] === R.UNKNOWN ? [i] : []) : R.aimedCells(board, weapon, i);
    for (const c of cells) enemyBoard.cells[c].classList.add("aim");
  }
  enemyBoard.cellsLayer.addEventListener("pointerover", (e) => {
    const cell = e.target.closest(".cell");
    if (cell) showAim(Number(cell.dataset.i));
  });
  enemyBoard.cellsLayer.addEventListener("focusin", (e) => {
    const cell = e.target.closest(".cell");
    if (cell) showAim(Number(cell.dataset.i));
  });
  enemyBoard.cellsLayer.addEventListener("pointerleave", clearAim);
  enemyBoard.cellsLayer.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell || !match.canFire()) return;
    const i = Number(cell.dataset.i);
    const board = match.state.boards[opp];
    // Rain isn't aimed, so a tap on a square (say, a gift) must not launch it.
    if (weapon === "rain") return toast("Missile rain falls on 7 random squares. Press Launch rain.");
    if (weapon === "shot" && board.cells[i] !== R.UNKNOWN) return toast("Already explored. Pick another square.");
    if (weapon !== "shot" && R.aimedCells(board, weapon, i).length === 0) return toast("Nothing left to hit there.");
    clearAim();
    match.fire(weapon, i);
  });

  // ---------- match lifecycle ----------
  function describe(shooter, weaponUsed, events) {
    const mine = shooter === me;
    const who = mine ? "You" : oppName;
    const hits = events.filter((e) => e.type === "hit").length;
    const misses = events.filter((e) => e.type === "miss").length;
    const w = weaponUsed === "shot" ? "" : ` (${R.WEAPONS[weaponUsed].label})`;
    let line;
    if (hits + misses === 1) line = `${who} fired at ${R.cellName(events.find((e) => e.type === "hit" || e.type === "miss").cell)}${w}: ${hits ? "hit!" : "miss."}`;
    else line = `${who} fired${w}: ${hits} hit${hits === 1 ? "" : "s"}, ${misses} miss${misses === 1 ? "" : "es"}.`;
    addLog(line, mine ? "mine" : "theirs");
    for (const e of events) {
      if (e.type === "sunk") {
        const board = match.state.boards[mine ? opp : me];
        const same = board.sunk.filter((s) => s.len === e.ship.len).length;
        const name = shipName(e.ship.len, same);
        const text = mine ? `You sank ${oppName}'s ${name}!` : `${oppName} sank your ${name}.`;
        addLog(text, "big");
        toast(text);
      } else if (e.type === "gift" && mine) {
        const text = `Gift! You got a ${R.WEAPONS[e.gift].label}.`;
        addLog(text, "gift");
        toast(text);
      }
    }
  }

  // The shell lands: impact sounds and, for heavy weapons, a blast on the board.
  function land(board, w, events) {
    const view = board === me ? ownBoard : enemyBoard;
    const sunk = events.some((e) => e.type === "sunk");
    const hits = events.filter((e) => e.type === "hit");
    if (w === "nuke") {
      play("nuke");
      playSample(BLAST, { gain: 0.7, rate: 0.5, jitter: 0.03 }); // slowed down: a deep, real roar
    } else if (w === "rain") {
      // No pitch jitter: it would pull the booms off their squares.
      const carpet = playSample(CARPET, { gain: 0.8, jitter: 0 });
      events
        .filter((e) => e.type === "hit" || e.type === "miss")
        .forEach((e, k) =>
          setTimeout(() => {
            if (e.type === "hit") explode(0.4, { rate: 1.15, jitter: 0.12, fallback: "rain-hit" });
            else if (!carpet) playSample(SPLASH_SMALL, { gain: 0.45, jitter: 0.12, fallback: "rain-miss" });
          }, k * RAIN_STEP * 1000),
        );
    } else if (w === "big") {
      if (hits.length && playSample(BLAST, { gain: 0.7, fallback: "hit-big" })) explode(0.4, { fallback: null });
      else if (!hits.length) splashHeavy(0.85);
    } else hits.length ? explode() : splashHeavy();
    if (sunk) {
      // A second, deeper blast as the ship blows apart; it groans and goes under.
      const at = w === "nuke" ? 900 : 250;
      setTimeout(() => playSample(BLAST, { gain: 0.55, rate: 0.8, fallback: "sink" }) && play("groan"), at);
      setTimeout(() => splashHeavy(0.45), at + 500);
    }
    if (events.some((e) => e.type === "gift" && e.by === me)) setTimeout(() => play("gift"), 300);
    if (w === "nuke" || w === "big") {
      const shots = events.filter((e) => e.type === "hit" || e.type === "miss").map((e) => e.cell);
      const r = shots.reduce((s, i) => s + R.rowOf(i), 0) / Math.max(1, shots.length);
      const c = shots.reduce((s, i) => s + R.colOf(i), 0) / Math.max(1, shots.length);
      view.board.style.setProperty("--bx", `${(c + 0.5) * 10}%`);
      view.board.style.setProperty("--by", `${(r + 0.5) * 10}%`);
      const cls = w === "nuke" ? "nuked" : "blasted";
      view.board.classList.remove(cls);
      void view.board.offsetWidth; // restart the animation
      view.board.classList.add(cls);
      setTimeout(() => view.board.classList.remove(cls), w === "nuke" ? 1800 : 700);
    }
  }

  function newMatch() {
    m += 1;
    fleet = R.randomFleet(Math.random);
    weapon = "shot";
    lastAgain = false;
    selectedShip = -1;
    lastShots = [new Set(), new Set()];
    lastTurnSeen = -1;
    rematchVotes = { me: false, them: false };
    match = new SeaBattleMatch({ send: (msg) => session.send(msg), me, fleet, m });
    window.ddp.match = match; // for debugging and browser tests
    match.on("update", render);
    match.on("peer-ready", () => toast(`${oppName} is ready`));
    match.on("start", ({ first }) => {
      addLog(`Coin toss (drawn by both browsers): ${first === me ? "you start" : `${oppName} starts`}.`);
      toast(first === me ? "You go first!" : `${oppName} goes first`);
    });
    match.on("fired", ({ by, weapon: w, cells }) => {
      const target = by === me ? enemyBoard : ownBoard;
      if (by === opp) follow(ownBoard);
      const flight = FLIGHT[w] ?? FLIGHT.shot;
      landsAt[R.other(by)] = performance.now() + flight * 1000;
      target.board.style.setProperty("--impact-delay", `${flight}s`);
      for (const c of target.cells) c.style.removeProperty("--impact-delay");
      cells.forEach((c, k) => {
        // Missile rain lands square by square, in step with its carpet of booms.
        if (w === "rain") target.cells[c].style.setProperty("--impact-delay", `${flight + k * RAIN_STEP}s`);
        target.cells[c].classList.add("incoming");
      });
      play(LAUNCH_SOUND[w] ?? "launch");
    });
    match.on("events", ({ shooter, weapon: w, events }) => {
      const board = R.other(shooter);
      lastShots[board] = new Set(events.filter((e) => e.type === "hit" || e.type === "miss").map((e) => e.cell));
      lastAgain = shooter === me && events.some((e) => e.type === "again");
      const wait = Math.max(0, landsAt[board] - performance.now());
      const current = match;
      setTimeout(() => {
        if (destroyed || match !== current) return; // a rematch started meanwhile
        land(board, w, events);
        describe(shooter, w, events);
      }, wait);
    });
    match.on("gifts", (spawned) => {
      if (spawned.some((g) => g.board === opp)) addLog(`A mystery gift popped up in ${oppName}'s waters. Hit it to win a weapon!`, "gift");
    });
    match.on("over", ({ winner }) => {
      score[winner] += 1;
      const wait = Math.max(0, ...landsAt.map((t) => t - performance.now()));
      const current = match;
      setTimeout(() => {
        if (destroyed || match !== current) return;
        addLog(winner === me ? "You sank the whole fleet!" : `${oppName} sank your whole fleet.`, "big");
        play(winner === me ? "win" : "lose");
      }, wait + 600);
    });
    match.on("verified", () => render());
    match.on("abort", ({ reason }) => {
      match.abortReason = reason;
      addLog(reason, "bad");
    });
    match.on("invalid", (reason) => toast(reason));
    log.replaceChildren();
    addLog(m === 1 ? `Match against ${oppName}. Good luck!` : `Rematch #${m - 1}. Fresh fleets, new coin toss.`);
    router.start(match);
    render();
  }

  offs.push(
    session.on("rematch", (votes) => {
      rematchVotes = votes;
      if (votes.them && !votes.me) toast(`${oppName} wants a rematch`);
      render();
    }),
    session.on("rematch-start", newMatch),
  );
  newMatch();

  return {
    destroy() {
      destroyed = true;
      clearInterval(timerId);
      setTabAlert(null);
      for (const off of offs) off();
    },
  };
}
