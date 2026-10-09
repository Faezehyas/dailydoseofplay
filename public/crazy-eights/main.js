// Crazy Eights page: mounts the engine shell and renders a CardMatch. The
// rules live in rules.js and the card art in art.js; this file is the view:
// the table, your hand, the suit picker, the motion and the sounds. The match
// state never waits for the screen: every deal, play and draw is queued and
// played out in order, faster when turns pile up, and at once with reduced
// motion or a hidden tab.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { CardMatch } from "../engine/card-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { makeRules, normalizeConfig, MAX_PLAYERS, SUIT_SIGNS, RANK_NAMES, suitOf, rankOf, points, cardName, toFollow, isEight, canDraw, canPass, playable } from "./rules.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { mountSettings } from "./settings.js";
import { play } from "./sounds.js";
import { symbols, faceSvg, BACK_SVG, suitSvg } from "./art.js";

// How long robots think, before each move (robotPause() scales these in tests).
const ROBOT_PACE = { forced: 420, again: 320, think: 560, option: 130, eight: 450, max: 1800 };
const FORCED_DELAY = 700; // before a draw or pass you have no choice about is made for you
const PACE = { deal: 70, dealFly: 300, fly: 420, mine: 280, draw: 360, flip: 420, between: 240, bubble: 700, gather: 520 };
const BUSY_AFTER = 450; // ms of deck work before the table says what it's waiting for
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const SUIT_NAMES = ["Spades", "Hearts", "Diamonds", "Clubs"];
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const PLACE = ["", "1st", "2nd", "3rd", "4th"];
const BUSY = {
  keys: ["Getting ready…", "Each browser makes its key"],
  shuffling: ["Shuffling the deck…", "Each browser shuffles in turn, with a proof"],
  dealing: ["Dealing…", "A card opens only with every browser's key"],
  auditing: ["Checking the game…", "Every key is shown and the game replayed"],
};

const settings = mountSettings(document.getElementById("ce-settings"), document.getElementById("lobby"));
// Read at each use, so tests can switch it mid-game.
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Robot games: robots wait for the screen to finish replaying. The view sets this.
let screenBusy = () => false;

// A robot's pause: short for a forced draw, longer for a real choice, more to pick a suit.
function robotDelay(st, me, move, face, level) {
  if (screenBusy()) return -1;
  if (document.hidden) return 40;
  const k = still() ? 0.4 : 1;
  const options = playable(st, me, face).length;
  if (move.pass || (move.draw && !options)) return (st.drew ? ROBOT_PACE.again : ROBOT_PACE.forced) * k;
  let ms = ROBOT_PACE.think + ROBOT_PACE.option * Math.min(options, 5) + Math.random() * 380 - (level === "easy" ? 120 : 0);
  if (Number.isInteger(move.suit)) ms += ROBOT_PACE.eight;
  return Math.min(ROBOT_PACE.max, ms) * k;
}

startGameShell({
  slug: "crazy-eights",
  title: "Crazy Eights",
  tagline: "Match the suit or the rank, play an 8 to change the suit, and be the first with an empty hand.",
  layout: "wide",
  minPlayers: 2,
  maxPlayers: MAX_PLAYERS,
  robots: () => settings.get().robots,
  createRobot: (session) => {
    const config = settings.get();
    return startRobot(session, {
      rules: makeRules(config),
      choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: config.level }),
      delay: (st, me, move, face) => robotDelay(st, me, move, face, config.level),
    });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const tokenMs = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--dur-${name}`)) || 200;
const easing = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--ease-${name}`).trim() || "ease-out";

// A card element: two sides that turn in 3D. face null shows the back.
function cardEl(face, { down = face === null } = {}) {
  const node = el("span", { class: `ce-card ${down ? "down" : ""}` });
  const front = el("span", { class: "side front" });
  const back = el("span", { class: "side back" });
  back.innerHTML = BACK_SVG;
  node.append(el("span", { class: "in" }, front, back));
  setFace(node, face);
  return node;
}

function setFace(node, face) {
  if (node.dataset.face === String(face)) return;
  node.dataset.face = String(face);
  node.className = node.className.replace(/\bs-\d\b/g, "").trim();
  if (face === null) return;
  node.classList.add(`s-${suitOf(face)}`);
  node.querySelector(".front").innerHTML = faceSvg(face);
}

const RANK_WORDS = ["Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"];
const cardWords = (face) => `${RANK_WORDS[rankOf(face)]} of ${SUIT_NAMES[suitOf(face)].toLowerCase()}`;

// A small card name with its suit sign, for the log and the standings.
function miniCard(face) {
  if (face === null) return el("span", { class: "mini back", "aria-hidden": "true" });
  const node = el("span", { class: `mini s-${suitOf(face)}` });
  node.innerHTML = `<span>${RANK_NAMES[rankOf(face)]}${suitSvg(suitOf(face))}</span>`;
  return node;
}

function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const seats = session.players.map((p) => p.seat);
  const around = Array.from({ length: count }, (_, i) => (me + i) % count); // me, then clockwise
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  const robotGame = session.mode === "robot";
  const score = Array(count).fill(0);
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let gen = 0; // bumps on every new match, so old animations stop
  let rematch = { me: false, them: false, seats: [] };
  let destroyed = false;
  let ended = false;
  let queue = Promise.resolve();
  let pending = 0;
  let current = null; // the event being played out
  let view = null; // the table as drawn: { hands, stock, discard, suit, named, top, dir, arriving }
  let log = [];
  let cuedTurn = "";
  let forcedKey = "";
  let forcedTimer = null;
  let deadline = 0;
  let deadlineKey = "";
  let autoKey = "";
  let lastTick = 0;
  let celebrated = false;
  let picking = null; // the slot of the 8 waiting for a suit
  let focusSlot = null;
  let shuffleAnims = [];
  let shuffleSound = -Infinity;
  let abortInfo = null;
  let previous = null; // the match before a rematch, whose verdict may still be on its way
  let busyShown = { what: null, since: 0 };
  let busyTimer = null;
  const four = () => settings.get().fourColor;

  // One session handler: "setup" is for this view (and only from the room's creator), the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const pills = around.map((p) => {
    const where = el("small", { class: "where mono" });
    const node = el(
      "span",
      { class: `who p-${p}`, dataset: { seat: p } },
      el("span", { class: "dot", "aria-hidden": "true" }),
      el("span", { class: "label" }, el("span", { class: "name" }, p === me ? myName : session.players[p].name), where),
    );
    return { node, where };
  });
  const players = el("div", { class: `ce-players ${count > 2 ? "many" : ""}` }, count === 2 ? [pills[0].node, el("span", { class: "vs" }, "vs"), pills[1].node] : pills.map((p) => p.node));
  const leaveBtn = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: () => shell.leave() }, "Leave");
  const scoreBox = el("dl", { class: "ce-score", id: "ce-score", "aria-label": "Wins" });
  const status = el("p", { class: "ce-status", id: "ce-status", role: "status", "aria-live": "polite" });

  // Opponents round the table: the next player on your left, then across, then on your right.
  const POS = { 2: ["top"], 3: ["top", "top"], 4: ["left", "top", "right"] }[count];
  const opps = around.slice(1).map((p, i) => {
    const fan = el("div", { class: "ce-fan", "aria-hidden": "true" });
    const countEl = el("span", { class: "count mono" }, "0");
    const pill = el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, session.players[p].name), countEl);
    const node = el("div", { class: `ce-seat p-${p} pos-${POS[i]}`, dataset: { seat: p } }, fan, pill);
    return { p, node, fan, countEl, cards: new Map() };
  });
  const seatOf = (p) => opps.find((o) => o.p === p);

  const stockCards = [cardEl(null), cardEl(null), cardEl(null)];
  const riffleCards = Array.from({ length: 8 }, () => cardEl(null));
  const riffle = el("div", { class: "ce-riffle", hidden: true, "aria-hidden": "true" }, riffleCards);
  const stockLeft = el("span", { class: "left mono" });
  const stockBtn = el("button", { class: "ce-stock", id: "ce-stock", type: "button", "aria-label": "Draw a card", onclick: () => drawNow() }, ...stockCards, stockLeft);
  const pile = el("div", { class: "ce-pile", id: "ce-pile", role: "img", "aria-label": "Discard pile" });
  const suitBadge = el("div", { class: "ce-suit-badge", id: "ce-suit", hidden: true, "aria-live": "polite" });
  const busyChip = el("div", { class: "ce-busy", id: "ce-busy", hidden: true }, el("span", { class: "spinner", "aria-hidden": "true" }), el("span"));
  const dirArrow = el("span", { class: "arrow", "aria-hidden": "true" });
  dirArrow.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M20.5 3.5v5.4h-5.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const dirText = el("span");
  const dirChip = el("div", { class: "ce-dir", id: "ce-dir", hidden: true }, dirArrow, dirText);
  const centre = el(
    "div",
    { class: "ce-centre" },
    el("div", { class: "ce-stack" }, stockBtn, riffle),
    el("div", { class: "ce-stack" }, pile),
    el("span", { class: "ce-stock-label" }, "Stock"),
    el("span", { class: "ce-pile-label" }, "Discard"),
    suitBadge,
    dirChip,
    busyChip,
  );
  const handIn = el("div", { class: "ce-hand-in" });
  const hand = el("div", { class: "ce-hand", id: "ce-hand", role: "group", "aria-label": "Your hand" }, handIn);
  const myCount = el("span", { class: "count mono" }, "0");
  const handHint = el("p", { class: "ce-hand-hint", id: "ce-hand-hint" });
  const meArea = el("div", { class: `ce-me p-${me}` }, hand, el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, myName), myCount), handHint);
  const table = el("div", { class: `ce-table ${count === 4 ? "four-seats" : ""}`, id: "ce-table" }, el("div", { class: "ce-opps" }, opps.map((o) => o.node)), centre, meArea);
  const flyLayer = el("div", { class: "ce-fly", "aria-hidden": "true" });
  const picker = el("div", { class: "ce-picker", id: "ce-picker", hidden: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "ce-picker-title" });
  const overBox = el("div", { class: "ce-over", id: "ce-over", hidden: true, role: "dialog", "aria-labelledby": "ce-result" });
  const tableWrap = el("div", { class: "ce-table-wrap" }, table, flyLayer, picker, overBox);

  const drawBtn = el("button", { class: "btn primary", type: "button", id: "ce-draw", onclick: () => drawNow() }, "Draw");
  const passBtn = el("button", { class: "btn", type: "button", id: "ce-pass", onclick: () => passNow() }, "Pass");
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "ce-timer", id: "ce-timer", hidden: true, role: "timer", "aria-label": "Time to move" }, el("span", { class: "bar" }, timerFill), timerText);
  const hint = el("p", { class: "ce-hint", id: "ce-hint" });
  const logList = el("ol", { class: "ce-log", id: "ce-log", "aria-label": "Recent moves" });
  const configLine = el("p", { class: "ce-config", id: "ce-config" });
  const note = el("p", { class: "ce-note", id: "ce-note" });
  const symbolHost = el("div", { "aria-hidden": "true" });
  symbolHost.innerHTML = symbols();

  const rootBox = el(
    "div",
    { class: "crazy-eights", dataset: { you: me === 0 ? "a" : me === 1 ? "b" : "", seat: me } },
    symbolHost,
    el("div", { class: "ce-top" }, players, leaveBtn),
    scoreBox,
    status,
    el("div", { class: "ce-main" }, tableWrap, el("div", { class: "ce-side" }, el("div", { class: "ce-actions" }, el("div", { class: "ce-buttons" }, drawBtn, passBtn), timer, hint), logList)),
    configLine,
    note,
  );
  root.append(rootBox);

  // ---------- the table as drawn ----------
  const emptyView = () => ({ hands: seats.map(() => []), stock: 52, discard: [], suit: -1, named: false, top: -1, dir: 1, arriving: new Set() });
  function viewFromState() {
    const st = match.state;
    return { hands: st.hands.map((h) => h.slice()), stock: st.stock.length, discard: st.discard.slice(), suit: st.suit, named: st.named, top: st.top, dir: st.dir, arriving: new Set() };
  }
  const faceOf = (slot) => match?.face(slot) ?? null;

  // My hand, by suit (alternating colours) then rank.
  const ORDER = [0, 1, 3, 2];
  const sortKey = (slot) => {
    const f = faceOf(slot);
    return f === null ? 1000 + slot : ORDER[suitOf(f)] * 13 + ((rankOf(f) + 12) % 13);
  };
  const handCards = new Map(); // slot -> button

  function myPlayable() {
    const d = decision();
    if (!d || d.player !== me || match.working || picking !== null) return [];
    return playable(match.state, me, faceOf);
  }

  function renderHand() {
    const slots = view.hands[me].slice().sort((a, b) => sortKey(a) - sortKey(b));
    const plays = new Set(myPlayable());
    const mine = !!myDecision();
    // The focused card may be leaving: focus then moves to the card that takes its place.
    let had = handIn.contains(document.activeElement) ? Number(document.activeElement.dataset.slot) : null;
    const at = had === null ? -1 : [...handIn.children].indexOf(document.activeElement);
    for (const [slot, btn] of handCards) {
      if (!slots.includes(slot)) {
        btn.remove();
        handCards.delete(slot);
      }
    }
    if (had !== null && !slots.includes(had)) had = focusSlot = slots[Math.min(at, slots.length - 1)] ?? null;
    for (const [i, slot] of slots.entries()) {
      let btn = handCards.get(slot);
      if (!btn) {
        btn = el("button", { class: "ce-hcard", type: "button", dataset: { slot } }, cardEl(faceOf(slot)));
        handCards.set(slot, btn);
      }
      const face = faceOf(slot);
      const card = btn.firstChild;
      setFace(card, face);
      card.classList.toggle("down", face === null);
      btn.classList.toggle("playable", plays.has(slot));
      btn.classList.toggle("dim", mine && !plays.has(slot) && face !== null);
      btn.style.opacity = view.arriving.has(slot) ? "0" : "";
      btn.setAttribute("aria-label", face === null ? "A card, still being dealt" : `${cardWords(face)}${plays.has(slot) ? ", plays" : ""}`);
      btn.style.zIndex = String(i + 1);
      if (handIn.children[i] !== btn) handIn.insertBefore(btn, handIn.children[i] ?? null);
    }
    // One tab stop for the hand: the focused card, else the first playable one.
    if (focusSlot === null || !handCards.has(focusSlot)) focusSlot = [...plays][0] ?? slots[0] ?? null;
    for (const [slot, btn] of handCards) btn.tabIndex = slot === focusSlot ? 0 : -1;
    layoutHand(slots, plays);
    if (had !== null && handCards.has(had) && document.activeElement !== handCards.get(had)) handCards.get(had).focus({ preventScroll: true });
    myCount.textContent = String(slots.length);
  }

  // Fans the hand along a shallow arc; a hand too big for the row scrolls inside it instead.
  function layoutHand(slots, plays) {
    const n = slots.length;
    const W = hand.clientWidth;
    const cw = stockBtn.offsetWidth || 60;
    const min = cw * 0.4;
    let step = n > 1 ? Math.min(cw * 0.72, (W - cw - 12) / (n - 1)) : 0;
    const scroll = n > 1 && step < min;
    if (scroll) step = min;
    const total = cw + step * (n - 1);
    handIn.style.width = scroll ? `${Math.ceil(total + 16)}px` : "100%";
    const x0 = scroll ? 8 : (W - total) / 2;
    const angle = scroll ? 0 : Math.min(3.2, 26 / Math.max(n, 1));
    slots.forEach((slot, i) => {
      const btn = handCards.get(slot);
      const k = i - (n - 1) / 2;
      const lift = plays.has(slot) ? -12 : 0;
      const dip = scroll ? 0 : Math.abs(k) ** 1.6 * 1.2;
      btn.style.transform = `translate(${(x0 + i * step).toFixed(1)}px, ${(dip + lift).toFixed(1)}px) rotate(${(k * angle).toFixed(2)}deg)`;
      // A new card starts in its place, rather than sliding in from the left edge.
      if (!btn.dataset.placed) {
        btn.dataset.placed = "1";
        btn.style.transition = "none";
        void btn.offsetWidth;
        btn.style.transition = "";
      }
    });
  }

  function renderSeats() {
    for (const o of opps) {
      const slots = view.hands[o.p];
      for (const [slot, card] of o.cards) {
        if (!slots.includes(slot)) {
          card.remove();
          o.cards.delete(slot);
        }
      }
      const n = slots.length;
      const shown = slots.slice(-14); // a big hand shows its last 14 backs
      const W = o.fan.clientWidth || 120;
      const ow = stockBtn.offsetWidth ? (stockBtn.offsetWidth * 0.45) : 30;
      const step = shown.length > 1 ? Math.min(ow * 0.42, (W - ow) / (shown.length - 1)) : 0;
      shown.forEach((slot, i) => {
        let card = o.cards.get(slot);
        if (!card) {
          card = cardEl(null);
          o.cards.set(slot, card);
        }
        if (o.fan.children[i] !== card) o.fan.insertBefore(card, o.fan.children[i] ?? null);
        const k = i - (shown.length - 1) / 2;
        card.style.transform = `translateX(${(k * step).toFixed(1)}px) translateY(${(Math.abs(k) * 0.8).toFixed(1)}px) rotate(${(k * 3).toFixed(1)}deg)`;
        card.style.opacity = view.arriving.has(slot) ? "0" : "";
      });
      for (const [slot, card] of o.cards) if (!shown.includes(slot)) {
        card.remove();
        o.cards.delete(slot);
      }
      o.countEl.textContent = String(n);
      o.node.querySelector(".pill").setAttribute("aria-label", `${session.players[o.p].name}: ${plural(n, "card")}`);
    }
  }

  // A pile card's tilt, the same for a slot on every render.
  const tilt = (slot) => ((slot * 37) % 15) - 7;
  function renderCentre() {
    const left = view.stock;
    stockBtn.classList.toggle("empty", left === 0);
    stockCards.forEach((c, i) => {
      c.style.transform = `translate(${-i * 1.5}px, ${-i * 1.5}px)`;
      c.hidden = left <= i;
    });
    stockLeft.textContent = left ? `${left}` : "empty";
    stockBtn.setAttribute("aria-label", left ? `Draw a card (${plural(left, "card")} in the stock)` : "The stock is empty");
    const top = view.discard.slice(-3);
    const want = top.map((slot) => String(slot));
    if ([...pile.children].map((c) => c.dataset.slot).join() !== want.join()) {
      pile.replaceChildren(
        ...top.map((slot) => {
          const card = cardEl(faceOf(slot));
          card.dataset.slot = slot;
          return card;
        }),
      );
    }
    for (const card of pile.children) {
      const slot = Number(card.dataset.slot);
      const face = faceOf(slot);
      setFace(card, face);
      card.classList.toggle("down", face === null);
      card.style.transform = `rotate(${tilt(slot)}deg)`;
      card.style.opacity = view.arriving.has(slot) ? "0" : "";
    }
    const topFace = view.discard.length ? faceOf(view.discard.at(-1)) : null;
    pile.setAttribute("aria-label", topFace === null ? "Discard pile" : `Discard pile: ${cardName(topFace)} on top`);
    if (view.suit >= 0) {
      suitBadge.hidden = false;
      suitBadge.className = `ce-suit-badge s-${view.suit} ${view.named ? "named" : ""}`;
      suitBadge.innerHTML = `${suitSvg(view.suit)}<span>${view.named ? `${SUIT_NAMES[view.suit]}, named` : SUIT_NAMES[view.suit]}</span>`;
      suitBadge.setAttribute("aria-label", `Suit to follow: ${SUIT_NAMES[view.suit]}${view.named ? ", named by an 8" : ""}`);
    } else suitBadge.hidden = true;
    // With aces turning play round, which way it goes: towards the player after you.
    dirChip.hidden = !(config?.actions && count > 2 && view.suit >= 0);
    dirChip.classList.toggle("ccw", view.dir === -1);
    dirText.textContent = `${view.dir === 1 ? "Clockwise" : "Anticlockwise"}: ${nameOf((me + view.dir + count) % count)} after you`;
    // The deck's own work, once it has taken a moment (quick deals don't flicker).
    const busy = match?.busy && match.phase !== "over" ? match.busy : null;
    if (busy !== busyShown.what) {
      busyShown = { what: busy, since: performance.now() };
      clearTimeout(busyTimer);
      if (busy) busyTimer = setTimeout(() => !destroyed && renderCentre(), BUSY_AFTER + 20);
    }
    const showBusy = busy && (match.phase === "starting" || performance.now() - busyShown.since >= BUSY_AFTER);
    busyChip.hidden = !showBusy;
    busyChip.classList.toggle("float", match?.phase !== "starting");
    if (showBusy) busyChip.lastChild.textContent = BUSY[busy][1];
    animateShuffle(busy === "shuffling");
  }

  // ---------- motion ----------
  const live = (g) => g === gen && !destroyed;
  const fast = () => still() || document.hidden;
  const pace = () => (pending > 5 ? 0.4 : pending > 2 ? 0.65 : 1);
  const wait = (ms, g) => new Promise((r) => (fast() || !live(g) ? r() : setTimeout(r, ms)));

  function rectIn(node) {
    const r = node.getBoundingClientRect();
    const o = flyLayer.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  // A card flies from one place to another along a low arc, turning over if asked.
  async function fly(face, from, to, { ms, turn = null, spin = 0, g }) {
    if (fast() || !live(g) || !from || !to || !to.w) return;
    if (face === null) turn = null; // not known yet: it turns over where it lands, once it is
    const card = cardEl(face, { down: turn === "up" || face === null });
    card.style.width = `${to.w}px`;
    card.style.height = `${to.h}px`;
    flyLayer.append(card);
    const s0 = from.w / to.w || 1;
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - Math.min(60, Math.abs(to.x - from.x) * 0.15 + 18);
    const at = (x, y, s, r) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${s.toFixed(3)})`;
    const motion = card.animate(
      [
        { transform: at(from.x + (from.w - to.w) / 2, from.y + (from.h - to.h) / 2, s0, 0) },
        { transform: at(mx, my, (s0 + 1) / 2 * 1.06, spin / 2), offset: 0.5 },
        { transform: at(to.x, to.y, 1, spin) },
      ],
      { duration: ms, easing: easing("out"), fill: "forwards" },
    );
    if (turn) {
      const inner = card.querySelector(".in");
      const [a, b] = turn === "up" ? ["rotateY(180deg)", "rotateY(0deg)"] : ["rotateY(0deg)", "rotateY(180deg)"];
      inner.animate([{ transform: a }, { transform: b }], { duration: ms * 0.55, delay: ms * 0.2, easing: easing("out"), fill: "forwards" });
    }
    try {
      await motion.finished;
    } catch {}
    card.remove();
  }

  // Where a seat's cards come from and go to.
  function seatRect(p, slot) {
    if (p === me) {
      const btn = slot !== undefined && handCards.get(slot);
      return btn ? rectIn(btn.firstChild) : rectIn(hand);
    }
    const o = seatOf(p);
    const card = slot !== undefined && o.cards.get(slot);
    return rectIn(card || o.fan.lastChild || o.fan);
  }
  const stockRect = () => rectIn(stockCards[0]);
  const pileRect = () => rectIn(pile);

  function bubble(p, text, g, ms = PACE.bubble) {
    if (!live(g)) return;
    const host = p === me ? meArea : seatOf(p).node;
    const node = el("span", { class: `ce-bubble p-${p}` }, text);
    host.append(node);
    const end = () => node.remove();
    if (fast()) return setTimeout(end, 900);
    node.animate([{ transform: "translate(-50%, 6px) scale(.6)", opacity: 0 }, { transform: "translate(-50%, -6px) scale(1)", opacity: 1, offset: 0.25 }, { transform: "translate(-50%, -10px) scale(1)", opacity: 1, offset: 0.8 }, { transform: "translate(-50%, -18px) scale(.95)", opacity: 0 }], {
      duration: ms * 1.6,
      easing: easing("out"),
    }).finished.then(end, end);
  }

  // Pips of the named suit burst from the pile; a ring spreads under them.
  function suitBurst(suit, g) {
    if (fast() || !live(g)) return;
    const r = pileRect();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const ring = el("span", { class: "ce-fx ring" });
    ring.style.transform = `translate(${cx}px, ${cy}px)`;
    flyLayer.append(ring);
    ring.animate([{ transform: `translate(${cx}px, ${cy}px) scale(.4)`, opacity: 1 }, { transform: `translate(${cx}px, ${cy}px) scale(2.6)`, opacity: 0 }], { duration: tokenMs("slow") * 2.2, easing: easing("out") }).finished.then(() => ring.remove(), () => ring.remove());
    const n = 10;
    for (let i = 0; i < n; i++) {
      const node = el("span", { class: `ce-fx s-${suit}` });
      node.innerHTML = suitSvg(suit);
      flyLayer.append(node);
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const d = 60 + Math.random() * 50;
      node
        .animate(
          [
            { transform: `translate(${cx}px, ${cy}px) scale(.3)`, opacity: 1 },
            { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d}px) scale(1.1) rotate(${(Math.random() - 0.5) * 90}deg)`, opacity: 1, offset: 0.6 },
            { transform: `translate(${cx + Math.cos(a) * d * 1.25}px, ${cy + Math.sin(a) * d * 1.25 + 14}px) scale(.8)`, opacity: 0 },
          ],
          { duration: 900 + Math.random() * 300, easing: easing("out") },
        )
        .finished.then(() => node.remove(), () => node.remove());
    }
  }

  // Confetti in the winner's colour (and the others'), from where they sit.
  function confetti(p, g) {
    if (fast() || !live(g)) return;
    const r = p === me ? rectIn(hand) : seatRect(p);
    const W = flyLayer.clientWidth;
    for (let i = 0; i < 46; i++) {
      const node = el("span", { class: `ce-fx confetti p-${i % 3 ? p : seats[i % count]}` });
      flyLayer.append(node);
      const x0 = r.x + r.w / 2;
      const y0 = r.y + r.h / 2;
      const x1 = Math.max(10, Math.min(W - 10, x0 + (Math.random() - 0.5) * W * 0.9));
      const up = 90 + Math.random() * 120;
      node
        .animate(
          [
            { transform: `translate(${x0}px, ${y0}px) rotate(0deg)`, opacity: 1 },
            { transform: `translate(${(x0 + x1) / 2}px, ${y0 - up}px) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.35 },
            { transform: `translate(${x1}px, ${y0 + 160 + Math.random() * 120}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
          ],
          { duration: 1500 + Math.random() * 700, easing: "cubic-bezier(.2,.6,.4,1)" },
        )
        .finished.then(() => node.remove(), () => node.remove());
    }
  }

  // The deck riffles over the stock while it is being shuffled: a loading indicator, so it runs only then.
  function animateShuffle(on) {
    const moving = on && !fast();
    if (moving && !shuffleAnims.length) {
      riffle.hidden = false;
      const d = tokenMs("slow") * 3.6;
      shuffleAnims = riffleCards.map((c, i) => {
        const side = i % 2 ? 1 : -1; // the two halves of the deck
        const lift = -2 - Math.floor(i / 2) * 1.5;
        const out = `translate(${side * 58}%, ${lift - 6}px) rotate(${side * 10}deg)`;
        return c.animate(
          [
            { transform: `translate(0, ${-i}px)` },
            { transform: out, offset: 0.3 },
            { transform: out, offset: 0.42 + i * 0.02 },
            { transform: `translate(${side * 6}%, ${-i - 3}px) rotate(${side * 2}deg)`, offset: 0.62 + i * 0.03 },
            { transform: `translate(0, ${-i}px)` },
          ],
          { duration: d, iterations: Infinity, easing: easing("out") },
        );
      });
    } else if (!moving && shuffleAnims.length) {
      shuffleAnims.forEach((a) => a.cancel());
      shuffleAnims = [];
      riffle.hidden = true;
    }
    if (on && performance.now() - shuffleSound > 1500) {
      shuffleSound = performance.now();
      play("shuffle");
    }
  }

  // ---------- playing events out ----------
  async function gatherDiscard(n, g, k) {
    const under = view.discard.slice(0, -1);
    if (!n || !under.length) return;
    const from = pileRect();
    view.discard = view.discard.slice(-1);
    view.stock += under.length;
    render();
    play("gather");
    addLog({ kind: "reshuffle", text: `The discard pile was shuffled into a new stock (${plural(under.length, "card")})` });
    await Promise.all(under.slice(-5).map((slot, i) => wait(i * 50, g).then(() => fly(faceOf(slot), from, stockRect(), { ms: PACE.gather * k, turn: "down", g }))));
  }

  // Moves `slot` from the stock to player p's hand.
  async function dealTo(p, slot, g, ms, sound = "deal") {
    const from = stockRect();
    view.stock = Math.max(0, view.stock - 1);
    view.hands[p].push(slot);
    view.arriving.add(slot);
    render();
    if (sound) play(sound);
    await fly(p === me ? faceOf(slot) : null, from, seatRect(p, slot), { ms, turn: p === me && faceOf(slot) !== null ? "up" : null, g });
    view.arriving.delete(slot);
    if (live(g)) render();
  }

  async function animate(ev, g) {
    const k = pace();
    current = ev;
    if (ev.type === "deal") {
      view = emptyView();
      render();
      const rounds = Math.max(...ev.hands.map((h) => h.length));
      const flights = [];
      // Dealt at once (reduced motion, a hidden tab): one flick, not a burst.
      const sound = fast() ? null : "deal";
      if (!sound) play("deal");
      let i = 0;
      for (let r = 0; r < rounds; r++) {
        for (let j = 0; j < count; j++) {
          const p = (ev.first + j) % count;
          const slot = ev.hands[p][r];
          if (slot === undefined) continue;
          flights.push(wait(i++ * PACE.deal * k, g).then(() => live(g) && dealTo(p, slot, g, PACE.dealFly * k, sound)));
        }
      }
      await Promise.all(flights);
    } else if (ev.type === "flip") {
      const from = stockRect();
      view.stock = Math.max(0, view.stock - 1);
      view.discard.push(ev.slot);
      view.arriving.add(ev.slot);
      render();
      play("play");
      await fly(faceOf(ev.slot), from, pileRect(), { ms: PACE.flip * k, turn: "up", spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
    } else if (ev.type === "bury") {
      const from = pileRect();
      view.discard = view.discard.filter((s) => s !== ev.slot);
      view.stock += 1;
      render();
      addLog({ kind: "bury", face: ev.face, text: `An 8 can't start the pile: ${cardName(ev.face)} goes to the bottom of the stock` });
      await wait(250 * k, g);
      await fly(ev.face, from, stockRect(), { ms: PACE.flip * k, turn: "down", g });
    } else if (ev.type === "starter") {
      view.top = ev.face;
      view.suit = suitOf(ev.face);
      view.named = false;
      addLog({ kind: "starter", face: ev.face, text: `${cardName(ev.face)} starts the discard pile` });
      render();
      await wait(PACE.between * k, g);
    } else if (ev.type === "play") {
      const p = ev.player;
      const from = seatRect(p, ev.slot);
      view.hands[p] = view.hands[p].filter((s) => s !== ev.slot);
      view.discard.push(ev.slot);
      view.arriving.add(ev.slot);
      render();
      await fly(ev.face, from, pileRect(), { ms: (p === me ? PACE.mine : PACE.fly) * k, turn: p === me ? null : "up", spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
      view.top = ev.face;
      view.suit = ev.suit;
      view.named = ev.eight;
      render();
      play("play");
      addLog({ player: p, face: ev.face, text: describePlay(ev) });
      if (ev.eight) {
        play("eight", { suit: ev.suit }, 0.05);
        suitBurst(ev.suit, g);
        bubble(p, `${SUIT_SIGNS[ev.suit]} ${SUIT_NAMES[ev.suit]}!`, g);
        await wait(380 * k, g);
      }
      const left = view.hands[p].length;
      if (left === 1) {
        play("last", {}, 0.15);
        bubble(p, "Last card!", g, 900);
      }
      if (ev.action === "skip") {
        play("skip");
        bubble(ev.victim, "Skipped", g);
        await wait(320 * k, g);
      } else if (ev.action === "reverse") {
        play("reverse");
        view.dir = ev.dir;
        render();
        if (!fast() && !dirChip.hidden) dirArrow.animate([{ transform: "rotate(0deg)" }, { transform: `rotate(${ev.dir * 360}deg)` }], { duration: tokenMs("slow") * 2, easing: easing("out") });
        if (count === 2) bubble(p, "Again!", g);
        await wait(320 * k, g);
      } else if (ev.action === "two") {
        play("two");
        bubble(ev.victim, `Takes ${ev.dealt.length}`, g);
        await gatherDiscard(ev.shuffled, g, k);
        for (const slot of ev.dealt) await dealTo(ev.victim, slot, g, PACE.draw * k, "draw");
      }
    } else if (ev.type === "draw") {
      const p = ev.player;
      await gatherDiscard(ev.shuffled, g, k);
      if (ev.slot !== undefined) await dealTo(p, ev.slot, g, PACE.draw * k, "draw");
      addLog({ player: p, draw: true, text: p === me ? "You drew a card" : `${nameOf(p)} drew a card` });
    } else if (ev.type === "pass") {
      play("pass");
      bubble(ev.player, "Pass", g);
      addLog({ player: ev.player, text: `${nameOf(ev.player)} passed` });
      await wait(PACE.bubble * 0.6 * k, g);
    }
    current = null;
    await wait(PACE.between * k, g);
  }

  function enqueue(ev) {
    const g = gen;
    pending++;
    queue = queue
      .then(() => (live(g) ? animate(ev, g) : null))
      .catch((err) => console.error(err))
      .finally(() => {
        if (!live(g)) return; // a rematch started: its own queue and count took over
        pending--;
        if (!pending) {
          current = null;
          view = viewFromState();
          for (const robot of window.ddp.robots || []) robot.poke?.();
        }
        render();
      });
  }

  // ---------- log ----------
  function describePlay(ev) {
    const who = nameOf(ev.player);
    let text = `${who} played ${cardName(ev.face)}`;
    if (ev.eight) text += ` and named ${SUIT_NAMES[ev.suit].toLowerCase()}`;
    if (ev.action === "two") text += `: ${nameOf(ev.victim)} ${ev.victim === me ? "take" : "takes"} ${ev.dealt.length} and ${ev.victim === me ? "miss" : "misses"} a turn`;
    if (ev.action === "skip") text += `: ${nameOf(ev.victim)} ${ev.victim === me ? "are" : "is"} skipped`;
    if (ev.action === "reverse") text += count === 2 ? ": another turn" : ": play goes the other way";
    return text;
  }

  function addLog(entry) {
    // Draws in a row by one player make one line.
    const last = log[0];
    if (entry.draw && last?.draw && last.player === entry.player) {
      last.n = (last.n || 1) + 1;
      last.text = entry.player === me ? `You drew ${last.n} cards` : `${nameOf(entry.player)} drew ${last.n} cards`;
    } else log = [entry, ...log].slice(0, 6);
    logList.replaceChildren(
      ...log.map((e, i) =>
        el(
          "li",
          { class: `${e.player === undefined ? "" : `p-${e.player}`} ${e.kind || ""} ${i ? "" : "fresh"}` },
          e.face !== undefined ? miniCard(e.face) : e.draw ? miniCard(null) : null,
          el("span", {}, e.text),
        ),
      ),
    );
  }

  // ---------- whose decision it is ----------
  // The player who must act now, on this screen (after the replay catches up).
  function decision() {
    if (!match || match.phase !== "playing" || pending || ended) return null;
    return { player: match.state.turn };
  }
  const myDecision = () => {
    const d = decision();
    return d && d.player === me ? d : null;
  };
  // Why you may not draw (or pass) right now, or "" if you may.
  function drawRefusal() {
    const st = match.state;
    if (!canDraw(st)) return st.drew && st.draw === "one" ? "You've drawn your card: play it or pass" : "There's nothing left to draw";
    if (st.strict && myPlayable().length) return "You have a card that plays";
    return "";
  }
  function passRefusal() {
    const st = match.state;
    if (!canPass(st)) return st.draw === "one" ? "Draw a card first" : "Draw until you can play";
    if (st.strict && !(st.draw === "one" && st.drew) && myPlayable().length) return "You have a card that plays";
    return "";
  }

  // ---------- input ----------
  function ready() {
    if (!match || match.phase !== "playing") return false;
    if (match.state.turn !== me) {
      toast(`Wait for ${nameOf(match.state.turn)}`);
      return false;
    }
    return !!myDecision() && match.canMove() && picking === null;
  }

  function playSlot(slot) {
    if (!ready()) return;
    const face = faceOf(slot);
    if (!myPlayable().includes(slot)) {
      const st = match.state;
      play("nope");
      nudge(handCards.get(slot));
      return toast(`Play ${toFollow(st)}`);
    }
    clearTimeout(forcedTimer);
    if (isEight(face)) return openPicker(slot);
    match.play({ play: slot });
  }

  function drawNow() {
    if (!ready()) return;
    const why = drawRefusal();
    if (why) {
      play("nope");
      return toast(why);
    }
    clearTimeout(forcedTimer);
    match.play({ draw: true });
  }

  function passNow() {
    if (!ready()) return;
    const why = passRefusal();
    if (why) {
      play("nope");
      return toast(why);
    }
    clearTimeout(forcedTimer);
    match.play({ pass: true });
  }

  function nudge(node) {
    if (!node || fast()) return;
    node.firstChild.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }], { duration: tokenMs("slow"), easing: easing("out") });
  }

  hand.addEventListener("click", (e) => {
    const btn = e.target.closest(".ce-hcard");
    if (btn) {
      focusSlot = Number(btn.dataset.slot);
      playSlot(focusSlot);
    }
  });
  hand.addEventListener("keydown", (e) => {
    const btn = e.target.closest(".ce-hcard");
    if (!btn) return;
    const list = [...handIn.children];
    const i = list.indexOf(btn);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -i, End: list.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const target = list[Math.max(0, Math.min(list.length - 1, i + step))];
    focusSlot = Number(target.dataset.slot);
    for (const b of list) b.tabIndex = b === target ? 0 : -1;
    target.focus();
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  // D draws and P passes, wherever focus is (but not while typing).
  function onKey(e) {
    if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || picking !== null) return;
    if (e.key === "d" || e.key === "D") drawNow();
    else if (e.key === "p" || e.key === "P") passNow();
  }
  addEventListener("keydown", onKey);

  // ---------- the suit picker ----------
  function openPicker(slot) {
    picking = slot;
    const rest = view.hands[me].filter((s) => s !== slot).map(faceOf).filter((f) => f !== null && !isEight(f));
    const n = [0, 1, 2, 3].map((s) => rest.filter((f) => suitOf(f) === s).length);
    const best = n.indexOf(Math.max(...n));
    const buttons = [0, 1, 2, 3].map((s) => {
      const btn = el("button", { class: `ce-pick s-${s} ${s === best ? "best" : ""}`, type: "button", dataset: { suit: s }, "aria-label": `${SUIT_NAMES[s]}${n[s] ? `, you hold ${n[s]}` : ""}` });
      btn.innerHTML = `${suitSvg(s)}<span>${SUIT_NAMES[s]}</span>`;
      btn.addEventListener("click", () => pickSuit(s));
      return btn;
    });
    picker.replaceChildren(
      el(
        "div",
        { class: "ce-picker-card" },
        el("h2", { id: "ce-picker-title" }, `Play ${cardName(faceOf(slot))}: name a suit`),
        el("div", { class: "ce-picker-suits", role: "group", "aria-label": "Suits" }, buttons),
        el("button", { class: "btn small ghost", type: "button", onclick: () => closePicker() }, "Cancel"),
      ),
    );
    picker.hidden = false;
    picker.onkeydown = (e) => {
      if (e.key === "Escape") return closePicker();
      if (e.key === "Tab") {
        // Modal: Tab cycles through the picker's own buttons.
        const all = [...picker.querySelectorAll("button")];
        const i = all.indexOf(document.activeElement);
        e.preventDefault();
        return all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length].focus();
      }
      const i = buttons.indexOf(document.activeElement);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (step && i >= 0) {
        e.preventDefault();
        buttons[(i + step + 4) % 4].focus();
      } else if (/^[1-4]$/.test(e.key)) pickSuit(Number(e.key) - 1);
    };
    buttons[best].focus();
    render();
  }

  function closePicker() {
    const slot = picking;
    picking = null;
    picker.hidden = true;
    picker.replaceChildren();
    render();
    handCards.get(slot)?.focus({ preventScroll: true });
  }

  function pickSuit(suit) {
    const slot = picking;
    picking = null;
    picker.hidden = true;
    picker.replaceChildren();
    const next = handCards.get(slot)?.nextElementSibling ?? handCards.get(slot)?.previousElementSibling;
    if (slot !== null && match.canMove()) match.play({ play: slot, suit });
    render();
    next?.focus({ preventScroll: true });
  }

  // ---------- render ----------
  function renderScore() {
    const item = (p) => el("div", { class: `p-${p} ${p === me ? "mine" : ""}` }, el("dt", {}, p === me ? "You" : nameOf(p)), el("dd", {}, String(score[p])));
    scoreBox.replaceChildren(...around.map(item));
  }

  function statusText() {
    if (ended) return "The game has ended.";
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    if (match.phase === "aborted") return "Match stopped.";
    if (match.phase === "starting") return BUSY[match.busy]?.[0] ?? "Getting ready…";
    if (current?.type === "deal" || current?.type === "flip" || current?.type === "bury") return "Dealing…";
    if (match.phase === "over" || pending) {
      if (pending) return status.textContent || "…";
      const w = st.winner;
      if (st.ended === "blocked") return w === me ? "Nobody can move: you have the fewest cards. You win!" : `Nobody can move: ${nameOf(w)} has the fewest cards.`;
      if (st.ended === "long") return w === me ? "The game went on too long: you have the fewest cards. You win!" : `The game went on too long: ${nameOf(w)} has the fewest cards.`;
      return w === me ? "Your hand is empty. You win!" : `${nameOf(w)} played their last card.`;
    }
    const d = decision();
    if (!d) return "…";

    if (d.player !== me) return `${nameOf(d.player)}'s turn${st.drew ? " (drawing)" : ""}…`;
    if (picking !== null) return "Name a suit for your 8.";
    const plays = myPlayable().length;
    if (!plays) {
      if (canDraw(st)) return st.drew ? "Still nothing that plays: drawing again…" : "Nothing plays: drawing for you…";
      if (canPass(st)) return st.drew ? "That one doesn't play: passing…" : "Nothing to draw and nothing plays: passing…";
    }
    if (st.drew && st.draw === "one") return `Play a card, or pass.`;
    return `Your turn: play ${toFollow(st)}.`;
  }

  function where(p) {
    if (!view) return "";
    const n = view.hands[p].length;
    return plural(n, "card");
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = ended ? "ended" : match?.phase || "setup";
    rootBox.dataset.phase = phase;
    rootBox.classList.toggle("four-colour", four());
    const d = decision();
    const turnOf = current?.player ?? (phase === "playing" ? st?.turn : undefined);
    for (const [i, p] of around.entries()) {
      pills[i].node.classList.toggle("active", turnOf === p && phase === "playing");
      pills[i].where.textContent = view && st ? where(p) : "";
    }
    for (const o of opps) o.node.classList.toggle("active", turnOf === o.p && phase === "playing");
    meArea.classList.toggle("active", turnOf === me && phase === "playing");
    renderScore();
    status.textContent = statusText();
    status.className = `ce-status ${d ? `p-${d.player}` : ""} ${d?.player === me ? "mine" : ""}`;
    if (view) {
      renderSeats();
      renderCentre();
      renderHand();
    }
    const mine = myDecision();
    const canAct = !!mine && match.canMove() && picking === null;
    const drawWhy = canAct ? drawRefusal() : "x";
    const passWhy = canAct ? passRefusal() : "x";
    drawBtn.disabled = !canAct || !!drawWhy;
    passBtn.disabled = !canAct || !!passWhy;
    passBtn.hidden = !st || !(canAct && canPass(st));
    stockBtn.disabled = !canAct;
    stockBtn.classList.toggle("armed", canAct && !drawWhy);
    const plays = canAct ? myPlayable().length : 0;
    hint.textContent = !st || phase !== "playing" ? "" : mine ? (plays ? "Tap a glowing card. Keys: arrows, Enter; D draws, P passes." : "") : d ? `${nameOf(d.player)}'s turn` : "";
    handHint.textContent = mine && plays ? `${plural(plays, "card")} can go on ${cardName(st.top)}${st.named ? ` (${SUIT_NAMES[st.suit].toLowerCase()} named)` : ""}` : "";
    renderTimer();
    renderOver();
    setTabAlert(mine ? "Your turn" : null);
    if (mine) {
      const key = `${m}:${st.moves}`;
      if (cuedTurn !== key && st.drew === 0) {
        cuedTurn = key;
        play("turn");
        // A hand too big for its row: bring a card that plays into view.
        const first = hand.querySelector(".ce-hcard.playable");
        if (first && hand.scrollWidth > hand.clientWidth) hand.scrollTo({ left: Math.max(0, first.offsetLeft + new DOMMatrix(getComputedStyle(first).transform).m41 - hand.clientWidth / 3), behavior: "auto" });
      }
      autoMove();
    }
  }

  // Nothing you hold plays: draw (or pass) is the only move, so it's made for you.
  function autoMove() {
    const st = match.state;
    if (!match.canMove() || picking !== null || myPlayable().length) return;
    const move = canDraw(st) ? { draw: true } : canPass(st) ? { pass: true } : null;
    const key = `${m}:${st.moves}:${st.drew}`;
    if (!move || forcedKey === key) return;
    forcedKey = key;
    const g = gen;
    clearTimeout(forcedTimer);
    forcedTimer = setTimeout(() => {
      if (live(g) && myDecision() && match.canMove() && `${m}:${match.state.moves}:${match.state.drew}` === key && !myPlayable().length) match.play(move);
    }, fast() ? 0 : FORCED_DELAY);
  }

  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    timer.hidden = !secs || !d;
    if (timer.hidden) return;
    const key = `${m}:${match.state.moves}:${match.state.drew}`;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (secs * 1000))).toFixed(3)})`;
    timer.className = `ce-timer p-${d.player} ${left < 5000 ? "low" : ""}`;
    timerText.textContent = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
    if (d.player === me && left <= 3000 && left > 0) {
      const sec = Math.ceil(left / 1000);
      if (sec !== lastTick) {
        lastTick = sec;
        play("tick");
      }
    }
  }

  // Your time ran out: the game moves for you (a stalled player would hold up everyone).
  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !config?.moveSeconds) return;
    renderTimer();
    const d = decision();
    if (!d) return;
    const left = deadline - performance.now();
    if (d.player === me && left <= 0 && autoKey !== deadlineKey && match.canMove()) {
      autoKey = deadlineKey;
      if (picking !== null) closePicker();
      const move = timeoutMove(match.state, me, faceOf);
      toast(move.play !== undefined ? "Time's up: played for you" : move.draw ? "Time's up: drew for you" : "Time's up: passed for you");
      match.play(move);
    } else if (d.player !== me && left <= -CLAIM_GRACE_MS) {
      status.textContent = `Waiting for ${nameOf(d.player)}'s browser…`;
    }
  }
  const ticker = setInterval(tick, 200);

  // Who said what when a match stops: "<seat> <reason>", naming `about` when set.
  function abortText() {
    const { reason, seat, about } = abortInfo || { reason: match.abortReason };
    const prefix = "stopped the match: ";
    const text = about !== undefined && reason.startsWith(prefix) ? `${prefix}${nameOf(about)} ${reason.slice(prefix.length)}` : reason;
    if (seat === undefined) return text.charAt(0).toUpperCase() + text.slice(1);
    return `${nameOf(seat)} ${text}`;
  }

  // Everyone's place: the winner, then the fewest penalty points once the audit shows the hands, else the fewest cards.
  function standings() {
    const st = match.state;
    const known = st.hands.every((h) => h.every((slot) => faceOf(slot) !== null));
    const pts = (p) => st.hands[p].reduce((sum, slot) => sum + (faceOf(slot) === null ? 0 : points(faceOf(slot))), 0);
    const rest = seats.filter((p) => p !== st.winner).sort((a, b) => (known ? pts(a) - pts(b) : 0) || st.hands[a].length - st.hands[b].length || a - b);
    return { order: [st.winner, ...rest], known, pts };
  }

  const verdictText = (v) => `${v.seat === undefined ? "" : `${nameOf(v.seat)} `}${v.reason}.`;

  function verdictLine() {
    if (match.phase === "aborted") return null;
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "ce-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle proved, and the game replays the same with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "ce-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    return el("p", { class: "verdict", id: "ce-verdict" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Checking every shuffle and replaying the game…");
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the last card land first.
    if (ended || (phase !== "over" && phase !== "aborted") || (phase === "over" && pending)) {
      overBox.hidden = true;
      if (overBox.firstChild) overBox.replaceChildren();
      return;
    }
    const st = match.state;
    if (overBox.hidden) {
      overBox.hidden = false;
      tableWrap.scrollIntoView?.({ block: "nearest", behavior: still() ? "auto" : "smooth" });
      if (phase === "over" && !celebrated) {
        celebrated = true;
        play(st.winner === me ? "win" : "lose");
        confetti(st.winner, gen);
      }
    }
    let title;
    let detail = null;
    let list = null;
    if (phase === "aborted") {
      title = "Match stopped";
      detail = el("p", { class: "detail bad", id: "ce-detail" }, abortText());
    } else {
      const w = st.winner;
      const { order, known, pts } = standings();
      const myPlace = order.indexOf(me) + 1;
      title = w === me ? "You win!" : count > 2 ? `${nameOf(w)} wins · you're ${PLACE[myPlace]}` : `${nameOf(w)} wins`;
      detail = el("p", { class: "detail", id: "ce-detail" }, st.ended === "blocked" ? "Nobody could move, so the fewest cards won." : st.ended === "long" ? "The game went on too long, so the fewest cards won." : `${w === me ? "You" : nameOf(w)} went out in ${plural(st.plays[w], "play")}.`);
      list = el(
        "ol",
        { class: "ce-standings", id: "ce-standings" },
        order.map((p, i) => {
          const slots = st.hands[p];
          const facts = slots.length ? `${plural(slots.length, "card")}${known ? ` · ${pts(p)} pts` : ""}` : "out";
          return el(
            "li",
            { class: `p-${p} ${p === me ? "mine" : ""}` },
            el("span", { class: "place" }, PLACE[i + 1]),
            el("span", { class: "who" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, p === me ? "You" : session.players[p].name)),
            el("small", { class: "mono" }, facts),
            slots.length && slots.some((s) => faceOf(s) !== null)
              ? el("span", { class: "ce-left", "aria-label": `Cards left: ${slots.map((s) => (faceOf(s) === null ? "hidden" : cardName(faceOf(s)))).join(", ")}` }, slots.map((s) => miniCard(faceOf(s))))
              : null,
          );
        }),
      );
    }
    let rematchText = "";
    if (rematch.me) rematchText = `Waiting for ${listOf(seats.filter((p) => !rematch.seats?.includes(p)).map(nameOf))}…`;
    else if (rematch.them) rematchText = wantsRematch();
    overBox.replaceChildren(
      el(
        "div",
        { class: "ce-over-card" },
        el("h2", { class: st?.winner === me && phase === "over" ? "win" : "", id: "ce-result" }, title),
        list,
        detail,
        verdictLine(),
        el(
          "div",
          { class: "ce-actions-over" },
          el("button", { class: "btn primary", type: "button", id: "rematch", disabled: rematch.me, onclick: () => session.requestRematch() }, rematch.them && !rematch.me ? "Accept rematch" : "Rematch"),
          el("button", { class: "btn", type: "button", onclick: () => shell.leave() }, "Leave"),
        ),
        rematchText && el("p", { class: "rematch-status", id: "rematch-status" }, rematchText),
      ),
    );
  }

  function wantsRematch() {
    const voters = (rematch.seats || []).filter((p) => p !== me);
    return `${listOf(voters.map(nameOf))} ${voters.length === 1 ? "wants" : "want"} a rematch!`;
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    gen += 1;
    rematch = { me: false, them: false, seats: [] };
    clearTimeout(forcedTimer);
    pending = 0;
    queue = Promise.resolve();
    current = null;
    view = emptyView();
    log = [];
    cuedTurn = "";
    forcedKey = "";
    deadlineKey = "";
    autoKey = "";
    celebrated = false;
    picking = null;
    picker.hidden = true;
    abortInfo = null;
    logList.replaceChildren();
    flyLayer.replaceChildren();
    handCards.forEach((b) => b.remove());
    handCards.clear();
    const rivals = listOf(around.slice(1).map(nameOf));
    note.textContent = m === 1 ? `Playing against ${rivals}. Good luck!` : `Rematch #${m - 1}. A fresh deck, shuffled by everyone.`;
    const mt = new CardMatch({ send: (msg) => session.send(msg), me, players: count, rules, m });
    previous = match;
    match = mt;
    window.ddp.match = mt; // browser tests read this
    let dealt = false;
    mt.on("update", () => {
      if (mt !== match) return;
      if (!dealt && mt.state) {
        dealt = true;
        enqueue({ type: "deal", hands: mt.state.hands.map((h) => h.slice()), first: mt.state.first });
      }
      render();
    });
    mt.on("invalid", (reason) => {
      if (mt !== match) return;
      play("nope");
      toast(reason);
    });
    mt.on("start", () => {
      if (mt !== match) return;
      const first = mt.state.first;
      const who = first === me ? "you go first" : `${nameOf(first)} goes first`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.first === "random" ? `Coin toss (drawn by ${count === 2 ? "both" : "all"} browsers): ${who}.` : `Room setting: ${who}.`);
    });
    mt.on("events", ({ events }) => {
      if (mt !== match) return;
      for (const ev of events) enqueue(ev);
    });
    mt.on("over", ({ winner }) => {
      score[winner]++;
    });
    mt.on("abort", (info) => {
      if (mt === match) abortInfo = info;
    });
    // A rematch can start before this verdict arrives; keep listening to the old match.
    mt.on("verified", (verdict) => {
      if (mt === match) return render();
      const text = verdict.ok ? "Last game: fair play verified" : `Last game didn't check out: ${verdictText(verdict)}`;
      note.textContent = text;
      toast(text);
    });
    router.start(mt);
    render();
  }

  function describeConfig(c) {
    const parts = [c.draw === "until" ? "draw until you can play" : "draw one, then pass", c.strict ? "draw only when nothing plays" : "draw any time", c.actions ? "action cards on" : "no action cards"];
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s to move`);
    if (robotGame) parts.push(`${LEVEL_NAME[c.level]} ${count > 2 ? "robots" : "robot"}`);
    return parts.join(" · ");
  }

  // The room's settings come from whoever created it (robots use ours).
  function begin(c) {
    if (config) return;
    config = normalizeConfig(c);
    rules = makeRules(config);
    configLine.textContent = describeConfig(config);
    newMatch();
  }
  function onSetup(msg) {
    if (me !== 0) begin(msg.config);
  }

  // A player left: the engine ends the game for everyone; say so plainly, and whether the game got checked.
  function onEnd(reason, seat) {
    if (reason === "self") return;
    ended = true;
    gen++;
    clearTimeout(forcedTimer);
    animateShuffle(false);
    // Just after a rematch started, the game to report on is the one before.
    const judged = match?.phase === "starting" && previous ? previous : match;
    const phase = judged?.phase;
    const verdict = judged?.verdict;
    render();
    queueMicrotask(() => {
      const card = root.querySelector("#ended .card");
      if (!card) return;
      const gone = session.players[seat]?.name ?? "A player";
      let check;
      if (verdict?.ok) check = el("p", { class: "verdict ok" }, "✓ The last game was verified as fair before they left.");
      else if (verdict) check = el("p", { class: "verdict" }, `The last game didn't check out: ${verdictText(verdict)}`);
      else if (phase === "over") check = el("p", { class: "verdict" }, `${gone} left before the audit finished, so this game couldn't be verified.`);
      else check = el("p", { class: "verdict" }, "The game stopped before the end, so it wasn't checked.");
      const st = judged?.state;
      const rows =
        st && count > 2
          ? el(
              "ul",
              {},
              seats.map((p) => el("li", { class: `p-${p} ${p === seat ? "gone" : ""}` }, el("span", { class: "dot", "aria-hidden": "true" }), `${nameOf(p)}: ${plural(st.hands[p].length, "card")}${p === seat ? " (left)" : ""}`)),
            )
          : null;
      card.querySelector(".notice")?.after(
        el(
          "div",
          { class: "ce-ended crazy-eights", id: "ce-ended" },
          count > 2 ? el("p", {}, `Crazy Eights needs every player's keys to read a card, so the game is over for all ${count} of you.`) : null,
          rows,
          check,
        ),
      );
    });
  }

  screenBusy = () => pending > 0;
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const resize = new ResizeObserver(() => view && render());
  resize.observe(table);
  const offs = [
    offMsg,
    session.on("end", onEnd),
    session.on("rematch", (votes) => {
      rematch = votes;
      if (votes.them && !votes.me) toast(wantsRematch().replace("!", ""));
      render();
    }),
    session.on("rematch-start", () => config && newMatch()),
  ];
  view = emptyView();
  if (robotGame) begin(settings.get());
  else if (me === 0) {
    const c = settings.get();
    session.send({ t: "setup", config: c });
    begin(c);
  } else render();

  return {
    destroy() {
      destroyed = true;
      gen++;
      screenBusy = () => false;
      clearInterval(ticker);
      clearTimeout(forcedTimer);
      clearTimeout(busyTimer);
      animateShuffle(false);
      resize.disconnect();
      setTabAlert(null);
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
    },
  };
}
