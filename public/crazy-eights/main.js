// Crazy Eights page: mounts the engine shell and renders a CardMatch. The
// rules live in rules.js; the card table's shared pieces (art, seats, hand,
// stock, motion) in engine/cards/. This file is the view: the table's layout,
// the discard pile, the suit picker and the sounds. The match state never
// waits for the screen: every deal, play and draw is queued and played out in
// order, faster when turns pile up, and at once with reduced motion or a
// hidden tab.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { CardMatch } from "../engine/card-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { cardTable, DECK_WORK as BUSY, still, tokenMs, easing } from "../engine/cards/table.js";
import { humanPause } from "../engine/cards/paced-robot.js";
import { leaveNotice, abortText, verdictText as verdictOf } from "../engine/cards/leave-notice.js";
import { suitSvg } from "../engine/cards/art.js";
import { SUIT_NAMES, cardWords } from "../engine/cards/faces.js";
import { makeRules, normalizeConfig, MAX_PLAYERS, SUIT_SIGNS, suitOf, rankOf, points, cardName, toFollow, isEight, canDraw, canPass, playable } from "./rules.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";
import { howToPlay } from "./how-to-play.js";

// How long robots think, before each move (robotPause() scales these in tests).
const ROBOT_PACE = { forced: 420, again: 320, think: 560, option: 130, eight: 450, max: 1800 };
const FORCED_DELAY = 700; // before a draw or pass you have no choice about is made for you
const PACE = { deal: 70, dealFly: 300, fly: 420, mine: 280, draw: 360, flip: 420, between: 240, bubble: 700, gather: 520 };
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const PLACE = ["", "1st", "2nd", "3rd", "4th"];

// Robot games: robots wait for the screen to finish replaying. The view sets this.
let screenBusy = () => false;

// A robot's pause: short for a forced draw, longer for a real choice, more to pick a suit.
function robotDelay(st, me, move, face, level) {
  return humanPause(screenBusy, () => {
    const options = playable(st, me, face).length;
    if (move.pass || (move.draw && !options)) return st.drew ? ROBOT_PACE.again : ROBOT_PACE.forced;
    let ms = ROBOT_PACE.think + ROBOT_PACE.option * Math.min(options, 5) + Math.random() * 380 - (level === "easy" ? 120 : 0);
    if (Number.isInteger(move.suit)) ms += ROBOT_PACE.eight;
    return Math.min(ROBOT_PACE.max, ms);
  });
}

startGameShell({
  slug: "crazy-eights",
  title: "Crazy Eights",
  howToPlay,
  layout: "wide",
  settings,
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
  let rematch = { me: false, them: false, seats: [] };
  let destroyed = false;
  let ended = false;
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
  let abortInfo = null;
  let previous = null; // the match before a rematch, whose verdict may still be on its way
  const four = () => settings.get().fourColor;
  // The shared table: cards, seats, stock, hand and motion (engine/cards/table.js).
  const table = cardTable({ prefix: "ce", play, animate: (ev, g) => animate(ev, g), done: (idle) => replayed(idle) });
  const { cardEl, setFace, miniCard, fly, live, fast, pace, wait, rectIn, flyLayer, hand, handCards } = table;

  // One session handler: "setup" is for this view (and only from the room's creator), the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  bar.update({ badges: seats.map(() => el("span", { class: "dot", "aria-hidden": "true" })) });
  const status = el("p", { class: table.cls("status"), id: "ce-status", role: "status", "aria-live": "polite" });

  // Opponents round the table: the next player on your left, then across, then on your right.
  const POS = { 2: ["top"], 3: ["top", "top"], 4: ["left", "top", "right"] }[count];
  const opps = around.slice(1).map((p, i) => table.makeSeat({ p, name: session.players[p].name, pos: POS[i] }));
  const seatOf = (p) => opps.find((o) => o.p === p);

  const stockBtn = table.makeStock({ onClick: () => drawNow(), label: (left) => (left ? `Draw a card (${plural(left, "card")} in the stock)` : "The stock is empty") });
  const pile = el("div", { class: "ce-pile", id: "ce-pile", role: "img", "aria-label": "Discard pile" });
  const suitBadge = el("div", { class: "ce-suit-badge", id: "ce-suit", hidden: true, "aria-live": "polite" });
  const dirArrow = el("span", { class: "arrow", "aria-hidden": "true" });
  dirArrow.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M19 12a7 7 0 1 1-2.05-4.95" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M20.5 3.5v5.4h-5.4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const dirText = el("span");
  const dirChip = el("div", { class: "ce-dir", id: "ce-dir", hidden: true }, dirArrow, dirText);
  const centre = el(
    "div",
    { class: "ce-centre" },
    el("div", { class: table.cls("stack") }, stockBtn, table.riffle),
    el("div", { class: table.cls("stack") }, pile),
    el("span", { class: "ce-stock-label" }, "Stock"),
    el("span", { class: "ce-pile-label" }, "Discard"),
    suitBadge,
    dirChip,
    table.busyChip,
  );
  const myCount = el("span", { class: "count mono" }, "0");
  const handHint = el("p", { class: table.cls("hand-hint"), id: "ce-hand-hint" });
  const meArea = el("div", { class: table.cls("me", `p-${me}`) }, hand, el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, myName), myCount), handHint);
  const tableBox = el("div", { class: table.cls("table", count === 4 ? "four-seats" : ""), id: "ce-table" }, el("div", { class: table.cls("opps") }, opps.map((o) => o.node)), centre, meArea);
  const picker = el("div", { class: "ce-picker", id: "ce-picker", hidden: true, role: "dialog", "aria-modal": "true", "aria-labelledby": "ce-picker-title" });
  const overBox = el("div", { class: "ce-over", id: "ce-over", hidden: true, role: "dialog", "aria-labelledby": "ce-result" });
  const tableWrap = el("div", { class: table.cls("table-wrap") }, tableBox, flyLayer, picker, overBox);

  const drawBtn = el("button", { class: "btn primary", type: "button", id: "ce-draw", onclick: () => drawNow() }, "Draw");
  const passBtn = el("button", { class: "btn", type: "button", id: "ce-pass", onclick: () => passNow() }, "Pass");
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "ce-timer", id: "ce-timer", hidden: true, role: "timer", "aria-label": "Time to move" }, el("span", { class: "bar" }, timerFill), timerText);
  const hint = el("p", { class: table.cls("hint"), id: "ce-hint" });
  const logList = el("ol", { class: table.cls("log"), id: "ce-log", "aria-label": "Recent moves" });
  const configLine = el("p", { class: table.cls("config"), id: "ce-config" });
  const note = el("p", { class: table.cls("note"), id: "ce-note" });

  const rootBox = el(
    "div",
    { class: "crazy-eights pc-game", dataset: { you: me === 0 ? "a" : me === 1 ? "b" : "", seat: me } },
    table.symbolHost,
    bar.node,
    status,
    el("div", { class: table.cls("main") }, tableWrap, el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, el("div", { class: "ce-buttons" }, drawBtn, passBtn), timer, hint), logList)),
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

  function myPlayable() {
    const d = decision();
    if (!d || d.player !== me || match.working || picking !== null) return [];
    return playable(match.state, me, faceOf);
  }

  function renderHand() {
    const slots = view.hands[me].slice().sort((a, b) => sortKey(a) - sortKey(b));
    const playList = myPlayable();
    const plays = new Set(playList);
    const mine = !!myDecision();
    table.renderHand(slots, {
      face: faceOf,
      arriving: view.arriving,
      first: playList[0],
      look: (slot, face) => ({
        lift: plays.has(slot),
        classes: { playable: plays.has(slot), dim: mine && !plays.has(slot) && face !== null },
        label: face === null ? "A card, still being dealt" : `${cardWords(face)}${plays.has(slot) ? ", plays" : ""}`,
      }),
    });
    myCount.textContent = String(slots.length);
  }

  function renderSeats() {
    for (const o of opps) {
      const n = view.hands[o.p].length;
      o.render(view.hands[o.p], view.arriving, `${session.players[o.p].name}: ${plural(n, "card")}`);
    }
  }

  // A pile card's tilt, the same for a slot on every render.
  const tilt = (slot) => ((slot * 37) % 15) - 7;
  function renderCentre() {
    table.renderStock(view.stock);
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
    table.renderBusy(busy, { starting: match?.phase === "starting", redraw: () => !destroyed && renderCentre() });
  }

  // ---------- motion ----------
  // Where a seat's cards come from and go to.
  function seatRect(p, slot) {
    if (p === me) {
      const btn = slot !== undefined && handCards.get(slot);
      return btn ? rectIn(btn.firstChild) : rectIn(hand);
    }
    return seatOf(p).rect(slot);
  }
  const stockRect = table.stockRect;
  const pileRect = () => rectIn(pile);

  function bubble(p, text, g, ms = PACE.bubble) {
    table.bubble(p === me ? meArea : seatOf(p).node, p, text, g, ms);
  }

  // Pips of the named suit burst from the pile; a ring spreads under them.
  function suitBurst(suit, g) {
    if (fast() || !live(g)) return;
    const r = pileRect();
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const ring = el("span", { class: "pc-fx ring" });
    ring.style.transform = `translate(${cx}px, ${cy}px)`;
    flyLayer.append(ring);
    ring.animate([{ transform: `translate(${cx}px, ${cy}px) scale(.4)`, opacity: 1 }, { transform: `translate(${cx}px, ${cy}px) scale(2.6)`, opacity: 0 }], { duration: tokenMs("slow") * 2.2, easing: easing("out") }).finished.then(() => ring.remove(), () => ring.remove());
    const n = 10;
    for (let i = 0; i < n; i++) {
      const node = el("span", { class: `pc-fx s-${suit}` });
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
    table.confetti(p === me ? rectIn(hand) : seatRect(p), p, seats, g);
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
      await table.deal(ev.hands, ev.first, { gap: PACE.deal, ms: PACE.dealFly }, (p, slot, ms, sound) => dealTo(p, slot, g, ms, sound), g);
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

  const enqueue = (ev) => table.enqueue(ev);
  // After each event: once the screen has caught up, it draws the match as it stands.
  function replayed(idle) {
    if (idle) {
      current = null;
      view = viewFromState();
      for (const robot of window.ddp.robots || []) robot.poke?.();
    }
    render();
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
    if (!match || match.phase !== "playing" || table.pending || ended) return null;
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

  table.onPick((slot) => playSlot(slot));

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
  function statusText() {
    if (ended) return "The game has ended.";
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    if (match.phase === "aborted") return "Match stopped.";
    if (match.phase === "starting") return BUSY[match.busy]?.[0] ?? "Getting ready…";
    if (current?.type === "deal" || current?.type === "flip" || current?.type === "bury") return "Dealing…";
    if (match.phase === "over" || table.pending) {
      if (table.pending) return status.textContent || "…";
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
    bar.update({ turn: phase === "playing" ? turnOf : -1, notes: seats.map((p) => (view && st ? where(p) : "")), score: { wins: score } });
    for (const o of opps) o.node.classList.toggle("active", turnOf === o.p && phase === "playing");
    meArea.classList.toggle("active", turnOf === me && phase === "playing");
    status.textContent = statusText();
    status.className = `${table.cls("status")} ${d ? `p-${d.player}` : ""} ${d?.player === me ? "mine" : ""}`;
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
        table.revealInHand(hand.querySelector(".ce-hcard.playable"));
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
    const g = table.gen;
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

  // Everyone's place: the winner, then the fewest penalty points once the audit shows the hands, else the fewest cards.
  function standings() {
    const st = match.state;
    const known = st.hands.every((h) => h.every((slot) => faceOf(slot) !== null));
    const pts = (p) => st.hands[p].reduce((sum, slot) => sum + (faceOf(slot) === null ? 0 : points(faceOf(slot))), 0);
    const rest = seats.filter((p) => p !== st.winner).sort((a, b) => (known ? pts(a) - pts(b) : 0) || st.hands[a].length - st.hands[b].length || a - b);
    return { order: [st.winner, ...rest], known, pts };
  }

  const verdictText = (v) => verdictOf(v, nameOf);

  function verdictLine() {
    if (match.phase === "aborted") return null;
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "ce-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle proved, and the game replays the same with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "ce-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    return el("p", { class: "verdict", id: "ce-verdict" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Checking every shuffle and replaying the game…");
  }

  function renderOver() {
    const phase = match?.phase;
    // Let the last card land first.
    if (ended || (phase !== "over" && phase !== "aborted") || (phase === "over" && table.pending)) {
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
        confetti(st.winner, table.gen);
      }
    }
    let title;
    let detail = null;
    let list = null;
    if (phase === "aborted") {
      title = "Match stopped";
      detail = el("p", { class: "detail bad", id: "ce-detail" }, abortText(abortInfo || { reason: match.abortReason }, nameOf));
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
    table.reset();
    rematch = { me: false, them: false, seats: [] };
    clearTimeout(forcedTimer);
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
    table.stop();
    clearTimeout(forcedTimer);
    table.shuffling(false);
    // Just after a rematch started, the game to report on is the one before.
    const judged = match?.phase === "starting" && previous ? previous : match;
    leaveNotice({ root, session, seat, match: judged, prefix: "ce", game: "Crazy Eights", nameOf, facts: (st, p) => plural(st.hands[p].length, "card") });
    render();
  }

  screenBusy = () => table.pending > 0;
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const resize = new ResizeObserver(() => view && render());
  resize.observe(tableBox);
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
      table.destroy();
      screenBusy = () => false;
      clearInterval(ticker);
      clearTimeout(forcedTimer);
      resize.disconnect();
      setTabAlert(null);
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
    },
  };
}
