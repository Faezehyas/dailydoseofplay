// Sea Battle page: mounts the engine shell and renders a match.
// All game logic lives in rules.js / match.js; this file is view + input.
import { startGameShell } from "../engine/lobby.js";
import { el, toast } from "../engine/shell.js";
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
    '<svg viewBox="0 0 24 24" class="mk-gift" aria-hidden="true"><rect class="g1" x="4" y="10" width="16" height="10" rx="1.6"/><rect class="g2" x="3" y="7" width="18" height="4" rx="1.2"/><rect class="g3" x="11" y="7" width="2" height="13"/><path class="g3" d="M12 7c-3-5-8-4-7-1 1 2.5 7 1 7 1zm0 0c3-5 8-4 7-1-1 2.5-7 1-7 1z"/></svg>',
  clear: '<svg viewBox="0 0 24 24" class="mk-clear" aria-hidden="true"><circle cx="12" cy="12" r="2"/></svg>',
};

const WEAPON_ICON = {
  shot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>',
  missile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3l7 7-8 8-4-4 5-11zM9 14l-5 5M7 12l-3 1M12 17l-1 3"/></svg>',
  big: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.2 5.3L20 6l-3.5 4.6L21 14l-5.6.6L14 21l-2-5-2 5-1.4-6.4L3 14l4.5-3.4L4 6l5.8 1.3z"/></svg>',
  rain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3v6M12 6v6M18 3v6M9 12v6M15 14v6M4 15v4M20 13v4"/></svg>',
  nuke: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 7.8 4.5L14.2 10.8M4.2 7.5A9 9 0 0 1 12 3M9.8 10.8 4.2 7.5M8 19.8l2.9-5.6M16 19.8l-2.9-5.6M8 19.8a9 9 0 0 0 8 0"/></svg>',
};

const AI_DELAY = 650;

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
  const offs = [];

  // ---------- layout ----------
  const status = el("p", { class: "sb-status", id: "sb-status", role: "status", "aria-live": "polite" });
  const players = el("div", { class: "sb-players" });
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
  const top = el("div", { class: "sb-top" }, players, leaveBtn);

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
    el("p", { class: "hint" }, "Drag ships to move them, tap a ship to rotate it. Ships can't touch side by side."),
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
      status,
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
      cells.push(cell);
      cellsLayer.append(cell);
    }
    const board = el("div", { class: "board" }, shipsLayer, cellsLayer);
    const frame = el("div", { class: "board-frame" }, el("span"), cols, rows, board);
    const wrap = el("section", { class: "board-wrap" }, el("div", { class: "board-head" }, title, fleetInfo), frame);
    return { wrap, board, cells, shipsLayer, cellsLayer, fleetInfo, title };
  }

  function shipEl(ship, cls) {
    const node = el("div", { class: `ship ${ship.vertical ? "v" : "h"} ${cls || ""}` });
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

  function paintCells(view, board, { gifts = true } = {}) {
    const giftAt = new Map(gifts && board ? board.gifts.map((g) => [g.cell, g.type]) : []);
    for (let i = 0; i < R.CELLS; i++) {
      const v = board ? board.cells[i] : R.UNKNOWN;
      const key = `${v}${giftAt.has(i) ? "g" : ""}`;
      const cell = view.cells[i];
      if (cell.dataset.v === key) continue;
      const fresh = cell.dataset.v !== "" && (v === R.HIT || v === R.MISS);
      cell.dataset.v = key;
      cell.className = "cell";
      if (v === R.HIT) cell.classList.add("hit");
      else if (v === R.MISS) cell.classList.add("miss");
      else if (v === R.CLEAR) cell.classList.add("clear");
      if (giftAt.has(i)) cell.classList.add("gift");
      if (fresh) cell.classList.add("fresh");
      cell.innerHTML = v === R.HIT ? ICON.fire : v === R.MISS ? ICON.splash : v === R.CLEAR ? ICON.clear : giftAt.has(i) ? ICON.gift : "";
      if (view === enemyBoard) {
        const what = v === R.HIT ? "hit" : v === R.MISS ? "miss" : v === R.CLEAR ? "clear water" : giftAt.has(i) ? "gift" : "unexplored";
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
      el("span", { class: `who me ${st && st.turn === me && phase === "playing" ? "active" : ""}` }, session.me.name === "You" ? "You" : `${session.me.name} (you)`),
      el("span", { class: "vs" }, "vs"),
      el("span", { class: `who ${st && st.turn === opp && phase === "playing" ? "active" : ""}` }, oppName),
    );

    // Status line
    let text = "";
    if (phase === "placing") {
      if (!match.locked) text = match.peer ? `${oppName} is ready. Place your fleet and press Ready.` : "Place your fleet, then press Ready.";
      else if (!match.peer) text = `Waiting for ${oppName} to place their ships…`;
      else text = "Tossing a coin to see who starts…";
    } else if (phase === "playing") {
      if (st.turn === me) text = match.pending ? "Firing…" : lastAgain ? "Hit! Fire again." : "Your turn: fire at the enemy waters.";
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
    paintCells(ownBoard, st && st.boards[me]);
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
      paintCells(enemyBoard, board);
      fleetLeft(enemyBoard, board);
      fleetLeft(ownBoard, st.boards[me]);
    } else {
      fleetLeft(ownBoard, null);
    }
    const myTurn = match.canFire();
    enemyBoard.wrap.classList.toggle("armed", myTurn);
    enemyBoard.cellsLayer.classList.toggle("rain", myTurn && weapon === "rain");

    renderWeapons();
    renderOver();
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
    const theirs = st.inventory[opp];
    const theirCount = R.GIFT_TYPES.reduce((s, w) => s + theirs[w], 0);
    if (theirCount) weaponsBar.append(el("span", { class: "their-arsenal" }, `${oppName} holds ${theirCount} weapon${theirCount > 1 ? "s" : ""}`));
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
    if (match.locked) return;
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

  function startDrag(e, k) {
    if (match.locked || e.button > 0) return;
    e.preventDefault();
    const node = e.currentTarget;
    node.setPointerCapture?.(e.pointerId);
    const origin = fleet[k];
    const grab = cellAt(ownBoard, e.clientX, e.clientY);
    const offR = grab.r - origin.r;
    const offC = grab.c - origin.c;
    let moved = false;
    let candidate = origin;
    dragging = true;
    node.classList.add("dragging");
    const onMove = (ev) => {
      const at = cellAt(ownBoard, ev.clientX, ev.clientY);
      const next = { ...origin, r: at.r - offR, c: at.c - offC };
      if (next.r === candidate.r && next.c === candidate.c) return;
      moved = moved || next.r !== origin.r || next.c !== origin.c;
      candidate = next;
      if (R.shipInBounds(candidate)) placeShipEl(node, candidate);
      node.classList.toggle("bad", !R.canPlace(fleet.filter((_, j) => j !== k), candidate));
    };
    const onUp = () => {
      node.removeEventListener("pointermove", onMove);
      node.removeEventListener("pointerup", onUp);
      node.removeEventListener("pointercancel", onUp);
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
    const cells = weapon === "shot" || weapon === "missile" ? (board.cells[i] === R.UNKNOWN ? [i] : []) : R.aimedCells(board, weapon, i);
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
    if (weapon === "rain") return void match.fire("rain");
    if ((weapon === "shot" || weapon === "missile") && board.cells[i] !== R.UNKNOWN) return toast("Already explored. Pick another square.");
    if (weapon !== "shot" && weapon !== "missile" && R.aimedCells(board, weapon, i).length === 0) return toast("Nothing left to hit there.");
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
      } else if (e.type === "gift") {
        const text = mine ? `Gift! You got a ${R.WEAPONS[e.gift].label}.` : `${oppName} picked up a ${R.WEAPONS[e.gift].label}.`;
        addLog(text, "gift");
        toast(text);
      }
    }
    lastAgain = events.some((e) => e.type === "again" && e.player === me);
  }

  function newMatch() {
    m += 1;
    fleet = R.randomFleet(Math.random);
    weapon = "shot";
    lastAgain = false;
    selectedShip = -1;
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
      if (w === "rain") for (const c of cells) (by === me ? enemyBoard : ownBoard).cells[c].classList.add("incoming");
    });
    match.on("events", ({ shooter, weapon: w, events }) => describe(shooter, w, events));
    match.on("gifts", (spawned) => {
      addLog("Gifts popped up on both boards. Hit one to win a weapon!", "gift");
    });
    match.on("over", ({ winner }) => {
      addLog(winner === me ? "You sank the whole fleet!" : `${oppName} sank your whole fleet.`, "big");
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
      for (const off of offs) off();
    },
  };
}
