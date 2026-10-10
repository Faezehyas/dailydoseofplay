// The card table's pieces, shared by the card games: cards, the other
// players' seats, the stock and its riffle, the deck's work, your hand, flying
// cards and the animation queue (see "The shared table" in ARCHITECTURE.md).
// Each part has the class pc-<part> (cards.css) and <prefix>-<part> (the game's).
import { el } from "../shell.js";
import { suitOf, rankOf, RANK_NAMES } from "./faces.js";
import { symbols, faceSvg, BACK_SVG, suitSvg } from "./art.js";

// What the deck is doing, while the match is busy: the status line, then the table's chip.
export const DECK_WORK = {
  keys: ["Getting ready…", "Each browser makes its key"],
  shuffling: ["Shuffling the deck…", "Each browser shuffles in turn, with a proof"],
  dealing: ["Dealing…", "A card opens only with every browser's key"],
  auditing: ["Checking the game…", "Every key is shown and the game replayed"],
};
const BUSY_AFTER = 450; // ms of deck work before the table says what it's waiting for

export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const tokenMs = (name) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--dur-${name}`)) || 200;
export const easing = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--ease-${name}`).trim() || "ease-out";

// play(name) plays the game's sounds; animate(ev, g) plays one queued event; done(idle) follows each.
export function cardTable({ prefix, play, animate, done }) {
  const cls = (part, more = "") => `pc-${part} ${prefix}-${part}${more ? ` ${more}` : ""}`;
  let gen = 0;
  let pending = 0;
  let queue = Promise.resolve();
  let destroyed = false;
  let shuffleAnims = [];
  let shuffleSound = -Infinity;

  // ---------- cards ----------
  // A card element: two sides that turn in 3D. face null shows the back.
  function cardEl(face, { down = face === null } = {}) {
    const node = el("span", { class: `${cls("card")} ${down ? "down" : ""}` });
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
    if (face === null) return void (node.querySelector(".front").innerHTML = "");
    node.classList.add(`s-${suitOf(face)}`);
    node.querySelector(".front").innerHTML = faceSvg(face);
  }

  // A small card name with its suit sign, for logs and lists; a back when hidden.
  function miniCard(face) {
    if (face === null) return el("span", { class: "pc-mini back", "aria-hidden": "true" });
    const node = el("span", { class: `pc-mini s-${suitOf(face)}` });
    node.innerHTML = `<span>${RANK_NAMES[rankOf(face)]}${suitSvg(suitOf(face))}</span>`;
    return node;
  }

  // The shapes every card uses: append once to the game.
  const symbolHost = el("div", { "aria-hidden": "true" });
  symbolHost.innerHTML = symbols();

  // ---------- the stock, with the riffle while the deck is shuffled ----------
  const stockCards = [cardEl(null), cardEl(null), cardEl(null)];
  const riffleCards = Array.from({ length: 8 }, () => cardEl(null));
  const riffle = el("div", { class: cls("riffle"), hidden: true, "aria-hidden": "true" }, riffleCards);
  const stockLeft = el("span", { class: "left mono" });
  let stock = null;
  let stockLabel = (left) => (left ? `${left} cards in the stock` : "The stock is empty");
  // onClick makes it a button (drawing); label(left) is what it says to a screen reader.
  function makeStock({ onClick, label } = {}) {
    if (label) stockLabel = label;
    stock = onClick
      ? el("button", { class: cls("stock"), id: `${prefix}-stock`, type: "button", onclick: onClick }, ...stockCards, stockLeft)
      : el("div", { class: cls("stock"), id: `${prefix}-stock`, role: "img" }, ...stockCards, stockLeft);
    return stock;
  }
  const cardWidth = () => stock?.offsetWidth || 0;

  function renderStock(left) {
    stock.classList.toggle("empty", left === 0);
    stockCards.forEach((c, i) => {
      c.style.transform = `translate(${-i * 1.5}px, ${-i * 1.5}px)`;
      c.hidden = left <= i;
    });
    stockLeft.textContent = left ? `${left}` : "empty";
    stock.setAttribute("aria-label", stockLabel(left));
  }

  // The deck riffles over the stock while it is being shuffled: a loading indicator, so it runs only then.
  function shuffling(on) {
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

  // ---------- the deck's work, once it has taken a moment (quick deals don't flicker) ----------
  const busyChip = el("div", { class: cls("busy"), id: `${prefix}-busy`, hidden: true }, el("span", { class: "spinner", "aria-hidden": "true" }), el("span"));
  let busyShown = { what: null, since: 0 };
  let busyTimer = null;
  // what: match.busy, or null; starting: before the first deal (shown at once,
  // under the piles); redraw: called when the moment has passed.
  function renderBusy(what, { starting, redraw }) {
    if (what !== busyShown.what) {
      busyShown = { what, since: performance.now() };
      clearTimeout(busyTimer);
      if (what) busyTimer = setTimeout(() => !destroyed && redraw(), BUSY_AFTER + 20);
    }
    const show = what && (starting || performance.now() - busyShown.since >= BUSY_AFTER);
    busyChip.hidden = !show;
    busyChip.classList.toggle("float", !starting);
    if (show) busyChip.lastChild.textContent = DECK_WORK[what][1];
    shuffling(what === "shuffling");
  }

  // ---------- the other players: a fan of backs and a pill ----------
  function makeSeat({ p, name, pos }) {
    const fan = el("div", { class: cls("fan"), "aria-hidden": "true" });
    const countEl = el("span", { class: "count mono" }, "0");
    const pill = el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, name), countEl);
    const node = el("div", { class: `${cls("seat")} p-${p} pos-${pos}`, dataset: { seat: p } }, fan, pill);
    const cards = new Map();
    // slots: the hand; arriving: slots still in the air (hidden here); face(slot), if given,
    // turns up the cards everyone knows (one taken from a pile).
    function render(slots, arriving, label, face = () => null) {
      for (const [slot, card] of cards) {
        if (!slots.includes(slot)) {
          card.remove();
          cards.delete(slot);
        }
      }
      const shown = slots.slice(-14); // a big hand shows its last 14 backs
      const W = fan.clientWidth || 120;
      const ow = cardWidth() ? cardWidth() * 0.45 : 30;
      const step = shown.length > 1 ? Math.min(ow * 0.42, (W - ow) / (shown.length - 1)) : 0;
      shown.forEach((slot, i) => {
        let card = cards.get(slot);
        if (!card) {
          card = cardEl(null);
          cards.set(slot, card);
        }
        const f = face(slot);
        setFace(card, f);
        card.classList.toggle("down", f === null);
        if (fan.children[i] !== card) fan.insertBefore(card, fan.children[i] ?? null);
        const k = i - (shown.length - 1) / 2;
        card.style.transform = `translateX(${(k * step).toFixed(1)}px) translateY(${(Math.abs(k) * 0.8).toFixed(1)}px) rotate(${(k * 3).toFixed(1)}deg)`;
        card.style.opacity = arriving.has(slot) ? "0" : "";
      });
      for (const [slot, card] of cards) {
        if (!shown.includes(slot)) {
          card.remove();
          cards.delete(slot);
        }
      }
      countEl.textContent = String(slots.length);
      pill.setAttribute("aria-label", label);
    }
    // Where its cards come from and go to.
    const rect = (slot) => rectIn((slot !== undefined && cards.get(slot)) || fan.lastChild || fan);
    return { p, node, fan, pill, countEl, cards, render, rect };
  }

  // ---------- your hand ----------
  const handIn = el("div", { class: cls("hand-in") });
  const hand = el("div", { class: cls("hand"), id: `${prefix}-hand`, role: "group", "aria-label": "Your hand" }, handIn);
  const handCards = new Map(); // slot -> button
  const handMarks = []; // one per group, under its cards
  let focusSlot = null;
  let onPick = () => {};
  let onMove = null;
  let shown = { slots: [], lifted: new Set(), groups: null };

  // look(slot, face): { lift, classes, label }; first: the tab stop when none is set;
  // groups: runs of slots set apart and marked (given, the hand lies flat).
  function renderHand(slots, { face, arriving, look, first, groups = null }) {
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
    const lifted = new Set();
    for (const [i, slot] of slots.entries()) {
      let btn = handCards.get(slot);
      if (!btn) {
        btn = el("button", { class: cls("hcard"), type: "button", dataset: { slot } }, cardEl(face(slot)));
        handCards.set(slot, btn);
      }
      const f = face(slot);
      const card = btn.firstChild;
      setFace(card, f);
      card.classList.toggle("down", f === null);
      const { lift = false, classes = {}, label } = look(slot, f);
      if (lift) lifted.add(slot);
      for (const [name, on] of Object.entries(classes)) btn.classList.toggle(name, on);
      btn.style.opacity = arriving.has(slot) ? "0" : "";
      btn.setAttribute("aria-label", label);
      btn.style.zIndex = String(i + 1);
      if (handIn.children[i] !== btn) handIn.insertBefore(btn, handIn.children[i] ?? null);
    }
    // One tab stop for the hand: the focused card, else the first one asked for.
    if (focusSlot === null || !handCards.has(focusSlot)) focusSlot = first ?? slots[0] ?? null;
    for (const [slot, btn] of handCards) btn.tabIndex = slot === focusSlot ? 0 : -1;
    shown = { slots: slots.slice(), lifted, groups };
    if (!drag?.moved) layoutHand(slots, lifted, groups);
    if (had !== null && handCards.has(had) && document.activeElement !== handCards.get(had)) handCards.get(had).focus({ preventScroll: true });
  }

  // Fans the hand along a shallow arc; a hand too big for the row scrolls inside it instead.
  // With groups (null: none) the hand lies flat, each group set apart with a mark under it.
  function layoutHand(slots, lifted, groups = null, hold = null) {
    const flat = groups !== null;
    groups ??= [];
    const n = slots.length;
    const W = hand.clientWidth;
    const cw = cardWidth() || 60;
    const min = cw * 0.4;
    // Cards in one group sit closer; a gap before each group's first card and after its last.
    const groupOf = new Map(groups.flatMap((g, j) => g.map((slot) => [slot, j])));
    const inGroup = slots.map((slot, i) => i > 0 && groupOf.has(slot) && groupOf.get(slot) === groupOf.get(slots[i - 1]));
    const gapAt = slots.map((slot, i) => (i > 0 && !inGroup[i] && (groupOf.has(slot) || groupOf.has(slots[i - 1])) ? 1 : 0));
    const gaps = gapAt.reduce((a, b) => a + b, 0);
    const TIGHT = 0.72;
    const units = slots.reduce((u, _, i) => u + (i ? (inGroup[i] ? TIGHT : 1) : 0), 0);
    let gap = groups.length ? Math.max(10, cw * 0.45) : 0;
    let step = n > 1 ? Math.min(cw * 0.72, (W - cw - 12 - gap * gaps) / units) : 0;
    // Tight: narrow the gaps before the row has to scroll.
    if (n > 1 && step < min && gaps) {
      gap = Math.max(6, (W - cw - 12 - min * units) / gaps);
      step = Math.min(cw * 0.72, (W - cw - 12 - gap * gaps) / units);
    }
    const scroll = n > 1 && step < min;
    if (scroll) step = min;
    const total = cw + step * units + gap * gaps;
    handIn.style.width = scroll ? `${Math.ceil(total + 16)}px` : "100%";
    hand.classList.toggle("scrolls", scroll);
    const x0 = scroll ? 8 : (W - total) / 2;
    const angle = scroll || flat ? 0 : Math.min(3.2, 26 / Math.max(n, 1));
    const xs = [];
    let x = x0;
    slots.forEach((slot, i) => {
      if (i) x += step * (inGroup[i] ? TIGHT : 1) + gapAt[i] * gap;
      xs.push(x);
      const btn = handCards.get(slot);
      if (slot === hold) return;
      const k = i - (n - 1) / 2;
      const lift = lifted.has(slot) ? -12 : 0;
      const dip = scroll || flat ? 0 : Math.abs(k) ** 1.6 * 1.2;
      btn.style.transform = `translate(${x.toFixed(1)}px, ${(dip + lift).toFixed(1)}px) rotate(${(k * angle).toFixed(2)}deg)`;
      // A new card starts in its place, rather than sliding in from the left edge.
      if (!btn.dataset.placed) {
        btn.dataset.placed = "1";
        btn.style.transition = "none";
        void btn.offsetWidth;
        btn.style.transition = "";
      }
    });
    // The marks: one under each group, as wide as its cards.
    while (handMarks.length < groups.length) handMarks.push(handIn.appendChild(el("span", { class: cls("meld-mark"), "aria-hidden": "true" })));
    handMarks.forEach((mark, j) => {
      const g = groups[j];
      const a = g && slots.indexOf(g[0]);
      const b = g && slots.indexOf(g.at(-1));
      mark.hidden = !g || a < 0 || b < 0;
      if (mark.hidden) return;
      mark.style.width = `${(xs[b] - xs[a] + cw).toFixed(1)}px`;
      mark.style.transform = `translateX(${xs[a].toFixed(1)}px)`;
    });
    return xs;
  }

  hand.addEventListener("click", (e) => {
    const btn = e.target.closest(".pc-hcard");
    if (btn && !dragged) {
      focusSlot = Number(btn.dataset.slot);
      onPick(focusSlot);
    }
    dragged = false;
  });

  // Rearranging (when the game asks for it): drag a card along the row, or Shift and an arrow key.
  let drag = null; // { slot, btn, id, x0, start, at, moved }
  let dragged = false; // a drag just ended: the click that follows isn't a press
  hand.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".pc-hcard");
    if (!onMove || !btn || e.button !== 0) return;
    const slot = Number(btn.dataset.slot);
    const at = shown.slots.indexOf(slot);
    drag = { slot, btn, id: e.pointerId, start: e.clientX, x0: new DOMMatrix(getComputedStyle(btn).transform).m41, at, moved: false };
  });
  hand.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    // Let go outside the hand: the drag is over.
    if (!e.buttons && e.pointerType === "mouse") return endDrag(e, false);
    const dx = e.clientX - drag.start;
    if (!drag.moved) {
      if (Math.abs(dx) < 8) return;
      drag.moved = true;
      drag.btn.setPointerCapture?.(e.pointerId);
      drag.btn.classList.add("dragging");
    }
    const rest = shown.slots.filter((s) => s !== drag.slot);
    const cw = cardWidth() || 60;
    // Where it would land: among the others, laid out evenly while it moves.
    const xs = layoutHand(rest, new Set(), []);
    const x = Math.max(0, Math.min(handIn.offsetWidth - cw, drag.x0 + dx)); // within the row
    drag.at = xs.filter((p) => p + cw / 2 < x + cw / 2).length;
    const order = [...rest.slice(0, drag.at), drag.slot, ...rest.slice(drag.at)];
    layoutHand(order, new Set(), [], drag.slot);
    drag.btn.style.transform = `translate(${x.toFixed(1)}px, -14px) rotate(-3deg)`;
  });
  function endDrag(e, drop) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    dragged = true;
    setTimeout(() => (dragged = false), 0);
    d.btn.classList.remove("dragging");
    if (drop && d.at !== shown.slots.indexOf(d.slot)) onMove(d.slot, d.at, "drag");
    else layoutHand(shown.slots, shown.lifted, shown.groups);
  }
  hand.addEventListener("pointerup", (e) => endDrag(e, true));
  hand.addEventListener("lostpointercapture", (e) => endDrag(e, false)); // the card left the hand mid-drag
  hand.addEventListener("pointercancel", (e) => endDrag(e, false));

  // Arrows, Home and End move along the hand; Enter and Space press a card; Shift and an arrow move it.
  hand.addEventListener("keydown", (e) => {
    const btn = e.target.closest(".pc-hcard");
    if (!btn) return;
    const list = [...handIn.children].filter((c) => c.classList.contains("pc-hcard"));
    const i = list.indexOf(btn);
    if (onMove && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const to = shown.slots.indexOf(Number(btn.dataset.slot)) + (e.key === "ArrowLeft" ? -1 : 1);
      if (to >= 0 && to < shown.slots.length) onMove(Number(btn.dataset.slot), to, "key");
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -i, End: list.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const target = list[Math.max(0, Math.min(list.length - 1, i + step))];
    focusSlot = Number(target.dataset.slot);
    for (const b of list) b.tabIndex = b === target ? 0 : -1;
    target.focus();
    target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });

  // A hand too big for its row: bring `btn` into view.
  function revealInHand(btn) {
    if (btn && hand.scrollWidth > hand.clientWidth) hand.scrollTo({ left: Math.max(0, btn.offsetLeft + new DOMMatrix(getComputedStyle(btn).transform).m41 - hand.clientWidth / 3), behavior: "auto" });
  }

  function clearHand() {
    handCards.forEach((b) => b.remove());
    handCards.clear();
    handMarks.forEach((m) => (m.hidden = true));
  }

  // ---------- a hand laid face up on the table, as groups (melds, then deadwood) ----------
  function makeSpread(name) {
    const node = el("div", { class: cls("spread", name ? `${prefix}-spread-${name}` : ""), "aria-hidden": "true" });
    const cards = new Map(); // slot -> card
    const marks = [];
    // groups: [{ slots, kind }]; face(slot); arriving: slots still in the air; look(slot): { classes } for a card.
    function render(groups, { face, arriving = new Set(), look = () => ({}) }) {
      const all = groups.flatMap((g) => g.slots);
      for (const [slot, card] of cards) {
        if (!all.includes(slot)) {
          card.remove();
          cards.delete(slot);
        }
      }
      const W = node.clientWidth || 300;
      const n = all.length;
      const k = groups.length;
      // Card width so every group fits the row: cards overlap by their index, groups sit apart.
      const units = k + 0.42 * Math.max(0, n - k) + 0.3 * Math.max(0, k - 1);
      const w = Math.max(18, Math.min(cardWidth() || 60, (W - 4) / Math.max(units, 1)));
      const step = w * 0.42;
      const gap = w * 0.3;
      let x = (W - w * units) / 2;
      node.style.setProperty("--sw", `${w.toFixed(1)}px`);
      groups.forEach((g, j) => {
        if (j) x += gap;
        const x0 = x;
        g.slots.forEach((slot, i) => {
          let card = cards.get(slot);
          if (!card) {
            card = cardEl(face(slot));
            card.dataset.slot = slot;
            cards.set(slot, card);
          }
          setFace(card, face(slot));
          card.classList.toggle("down", face(slot) === null);
          for (const [c, on] of Object.entries(look(slot).classes ?? {})) card.classList.toggle(c, on);
          if (i) x += step;
          card.style.transform = `translateX(${x.toFixed(1)}px)`;
          card.style.zIndex = String(i + 1);
          card.style.opacity = arriving.has(slot) ? "0" : "";
          if (card.parentNode !== node) node.append(card);
        });
        x += w;
        let mark = marks[j];
        if (!mark) mark = marks[j] = node.appendChild(el("span", { class: cls("spread-mark") }));
        mark.className = `${cls("spread-mark")} ${g.kind}`;
        mark.hidden = false;
        mark.style.width = `${(x - x0).toFixed(1)}px`;
        mark.style.transform = `translateX(${x0.toFixed(1)}px)`;
      });
      marks.slice(groups.length).forEach((m) => (m.hidden = true));
    }
    // Where a card lies, or where the spread is when it isn't there.
    const rect = (slot) => (cards.get(slot) ? rectIn(cards.get(slot)) : rectIn(node));
    function clear() {
      cards.forEach((c) => c.remove());
      cards.clear();
      marks.forEach((m) => (m.hidden = true));
    }
    return { node, render, rect, clear, cards };
  }

  // ---------- motion ----------
  const flyLayer = el("div", { class: cls("fly"), "aria-hidden": "true" });
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

  // A word over a seat ("Pass", "Last card!"), in seat p's colour.
  function bubble(host, p, text, g, ms) {
    if (!live(g)) return;
    const node = el("span", { class: cls("bubble", `p-${p}`) }, text);
    host.append(node);
    const end = () => node.remove();
    if (fast()) return setTimeout(end, 900);
    node.animate([{ transform: "translate(-50%, 6px) scale(.6)", opacity: 0 }, { transform: "translate(-50%, -6px) scale(1)", opacity: 1, offset: 0.25 }, { transform: "translate(-50%, -10px) scale(1)", opacity: 1, offset: 0.8 }, { transform: "translate(-50%, -18px) scale(.95)", opacity: 0 }], {
      duration: ms * 1.6,
      easing: easing("out"),
    }).finished.then(end, end);
  }

  // Confetti from rect r, in seat p's colour and every seat's in `seats`.
  function confetti(r, p, seats, g) {
    if (fast() || !live(g)) return;
    const W = flyLayer.clientWidth;
    for (let i = 0; i < 46; i++) {
      const node = el("span", { class: `pc-fx confetti p-${i % 3 ? p : seats[i % seats.length]}` });
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

  // Deals `hands` (slots by seat) one card at a time round the table from `first`;
  // dealOne(p, slot, ms, sound) flies one. At once, it is one flick rather than a burst.
  async function deal(hands, first, { gap, ms }, dealOne, g) {
    const k = pace();
    const count = hands.length;
    const rounds = Math.max(...hands.map((h) => h.length));
    const flights = [];
    const sound = fast() ? null : "deal";
    if (!sound) play("deal");
    let i = 0;
    for (let r = 0; r < rounds; r++) {
      for (let j = 0; j < count; j++) {
        const p = (first + j) % count;
        const slot = hands[p][r];
        if (slot === undefined) continue;
        flights.push(wait(i++ * gap * k, g).then(() => live(g) && dealOne(p, slot, ms * k, sound)));
      }
    }
    await Promise.all(flights);
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
        done(!pending);
      });
  }

  return {
    cls,
    cardEl,
    setFace,
    miniCard,
    symbolHost,
    makeStock,
    renderStock,
    stockRect: () => rectIn(stockCards[0]),
    shuffling,
    riffle,
    busyChip,
    renderBusy,
    makeSeat,
    hand,
    handCards,
    renderHand,
    revealInHand,
    onPick: (fn) => (onPick = fn),
    // fn(slot, toIndex, by): the player moved a card in their hand, by "drag" or "key" (Shift and an arrow).
    onMove: (fn) => {
      onMove = fn;
      hand.classList.toggle("movable", !!fn);
    },
    makeSpread,
    flyLayer,
    rectIn,
    fly,
    bubble,
    confetti,
    deal,
    enqueue,
    live,
    fast,
    pace,
    wait,
    get gen() {
      return gen;
    },
    get pending() {
      return pending;
    },
    // A new match: drop the old queue, its count and its flights.
    reset() {
      gen++;
      pending = 0;
      queue = Promise.resolve();
      flyLayer.replaceChildren();
      clearHand();
    },
    // The game ended: nothing more animates.
    stop() {
      gen++;
    },
    destroy() {
      destroyed = true;
      gen++;
      clearTimeout(busyTimer);
      shuffling(false);
    },
  };
}
