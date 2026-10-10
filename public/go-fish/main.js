// Go Fish page: mounts the engine shell and renders a CardMatch. The rules
// live in rules.js; the card table's shared pieces (art, seats, hand, stock,
// motion) in engine/cards/. This file is the view: the pond, the books, the
// ask (a card, then a player, or the other way round) and the speech bubbles.
// Only the ask is a choice: your browser answers, lays books and shows a
// lucky fish for you, truthfully, after a short beat. The match state never
// waits for the screen: every event is queued and played out in order,
// faster when they pile up, and at once with reduced motion or a hidden tab.
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { CardMatch } from "../engine/card-match.js";
import { el, toast, setTabAlert } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { cardTable, DECK_WORK, tokenMs, easing } from "../engine/cards/table.js";
import { humanPause } from "../engine/cards/paced-robot.js";
import { leaveNotice, abortText, verdictText as verdictOf } from "../engine/cards/leave-notice.js";
import { cardWords } from "../engine/cards/faces.js";
import { makeRules, normalizeConfig, forcedMove, askable, ranksIn, rankOf, rankWords, rankName, totalBooks, MAX_PLAYERS } from "./rules.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";

// How long robots take before each move (robotPause() scales these in tests).
const ROBOT_PACE = { answer: 480, book: 380, done: 220, ask: 650, option: 80, max: 1800 };
// Your browser's own answers, books and lucky fish, after a short beat.
const AUTO = { answer: 550, book: 400, show: 400, done: 250 };
const PACE = { deal: 70, dealFly: 300, give: 440, draw: 360, book: 460, bubble: 820, between: 180, take: 60 };
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const PLACE = ["1st", "2nd", "3rd", "4th"];
const NUMBER = ["no", "one", "two", "three", "four"];
// "a 7", "an 8", "two Jacks"
const cardsOf = (n, r) => (n === 1 ? `${r === 0 || r === 7 ? "an" : "a"} ${rankWords(r).replace(/s$/, "")}` : `${NUMBER[n] ?? n} ${rankWords(r)}`);
const FISH_SVG =
  '<svg viewBox="0 0 40 24" aria-hidden="true" focusable="false"><path d="M3 12C9 3 21 2 29 9L37 3V21L29 15C21 22 9 21 3 12Z" fill="currentColor"/><circle cx="11" cy="10.5" r="2" fill="#fff"/><circle cx="11.4" cy="10.7" r="1" fill="#1d2129"/><path d="M17 8Q20 12 17 16" fill="none" stroke="rgb(0 0 0 / 22%)" stroke-width="1.4" stroke-linecap="round"/></svg>';

// Robot games: robots wait for the screen to finish replaying, and hurry once you're out. The view sets these.
let screenBusy = () => false;
let hurry = () => false;

// A robot's pause: a beat for an answer or a book, a real think for an ask.
function robotDelay(st, me, move, face, level) {
  return humanPause(screenBusy, () => {
    let ms;
    if (move.give || move.fish) ms = ROBOT_PACE.answer;
    else if (move.book || move.show !== undefined) ms = ROBOT_PACE.book;
    else if (move.done) ms = st.phase === "open" ? 0 : ROBOT_PACE.done;
    else {
      const options = ranksIn(st.hands[me], face).length * askable(st, me).length;
      ms = Math.min(ROBOT_PACE.max, ROBOT_PACE.ask + ROBOT_PACE.option * Math.min(options, 8) + Math.random() * 420 - (level === "easy" ? 150 : 0));
    }
    return ms * (hurry() ? 0.35 : 1);
  });
}

startGameShell({
  slug: "go-fish",
  title: "Go Fish",
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
// A rank as a small card-like token: "7".
const rankChip = (r) => el("span", { class: "gf-rank" }, rankName(r));

function mountGame(session, root, shell) {
  const me = session.index;
  const count = session.players.length;
  const seats = session.players.map((p) => p.seat);
  const around = Array.from({ length: count }, (_, i) => (me + i) % count); // me, then clockwise
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  const robotGame = session.mode === "robot";
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let destroyed = false;
  let ended = false;
  let current = null; // the event being played out
  let view = null; // the table as drawn: { hands, stock, books, arriving }
  let shownAsk = null; // the ask on screen: { p, to, rank }, until it is answered
  let log = [];
  let cuedTurn = "";
  let autoKey = "";
  let autoTimer = null;
  let deadline = 0;
  let deadlineKey = "";
  let timedOut = "";
  let lastTick = 0;
  let selRank = null; // your ask, as you build it
  let selSeat = null;
  let previous = null; // the match before a rematch, whose verdict may still be on its way
  const four = () => settings.get().fourColor;
  const unit = () => (config?.books === 2 ? "pair" : "book");
  // The shared table: cards, seats, stock, hand and motion (engine/cards/table.js).
  const table = cardTable({ prefix: "gf", play, animate: (ev, g) => animate(ev, g), done: (idle) => replayed(idle) });
  const { cardEl, miniCard, fly, live, fast, wait, rectIn, flyLayer, hand, handCards } = table;

  // One session handler: "setup" is for this view (and only from the room's creator), the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  bar.update({ badges: seats.map(() => el("span", { class: "dot", "aria-hidden": "true" })) });
  const status = el("p", { class: table.cls("status"), id: "gf-status", role: "status", "aria-live": "polite" });

  // The other players round the table: the next player on your left, then across, then on your right.
  const POS = { 2: ["top"], 3: ["top", "top"], 4: ["left", "top", "right"] }[count];
  const opps = around.slice(1).map((p, i) => {
    const seat = table.makeSeat({ p, name: session.players[p].name, pos: POS[i] });
    seat.books = el("div", { class: "gf-books", "aria-hidden": "true" });
    seat.pick = el("button", { class: "gf-pick", type: "button", dataset: { seat: p }, disabled: true, onclick: () => pickSeat(p) });
    seat.node.append(seat.books);
    seat.node.prepend(seat.pick);
    return seat;
  });
  const seatOf = (p) => opps.find((o) => o.p === p);

  const pondCount = el("span", { class: "gf-pond-label" }, "The pond");
  const stock = table.makeStock({ label: (left) => (left ? `The pond: ${plural(left, "card")} to fish from` : "The pond is empty") });
  const ripples = el("span", { class: "gf-ripples", "aria-hidden": "true" }, el("span"), el("span"));
  const pond = el("div", { class: "gf-pond", id: "gf-pond" }, ripples, el("div", { class: table.cls("stack") }, stock, table.riffle), pondCount);
  const centre = el("div", { class: "gf-centre" }, pond, table.busyChip);

  const myBooks = el("div", { class: "gf-books mine", "aria-hidden": "true" });
  const askBtn = el("button", { class: "btn primary gf-ask", type: "button", id: "gf-ask", disabled: true, onclick: () => askNow() }, "Ask");
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "gf-timer", id: "gf-timer", hidden: true, role: "timer", "aria-label": "Time to ask" }, el("span", { class: "bar" }, timerFill), timerText);
  const askBar = el("div", { class: "gf-ask-bar" }, askBtn, timer);
  const myCount = el("span", { class: "count mono" }, "0");
  const myBooksCount = el("span", { class: "gf-book-count mono" });
  const handHint = el("p", { class: table.cls("hand-hint"), id: "gf-hand-hint" });
  const meArea = el(
    "div",
    { class: table.cls("me", `p-${me}`) },
    myBooks,
    askBar,
    hand,
    el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, myName), myCount, myBooksCount),
    handHint,
  );
  const tableBox = el("div", { class: table.cls("table", count === 4 ? "four-seats" : ""), id: "gf-table" }, el("div", { class: table.cls("opps") }, opps.map((o) => o.node)), centre, meArea);
  const tableWrap = el("div", { class: table.cls("table-wrap") }, tableBox, flyLayer);

  const hint = el("p", { class: table.cls("hint"), id: "gf-hint" });
  const logList = el("ol", { class: table.cls("log"), id: "gf-log", "aria-label": "Recent moves" });
  const configLine = el("p", { class: table.cls("config"), id: "gf-config" });
  const note = el("p", { class: table.cls("note"), id: "gf-note" });

  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    // The result moment: the winners' books light up; a loss dims the table.
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "water", highlight: winnerBooks(), board: tableBox }),
  });

  const rootBox = el(
    "div",
    { class: "go-fish pc-game", dataset: { you: me === 0 ? "a" : me === 1 ? "b" : "", seat: me } },
    table.symbolHost,
    bar.node,
    status,
    el("div", { class: table.cls("main") }, tableWrap, el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, hint), logList)),
    configLine,
    note,
  );
  root.append(rootBox, result.node);

  // ---------- the table as drawn ----------
  const emptyView = () => ({ hands: seats.map(() => []), stock: 52, books: seats.map(() => []), arriving: new Set() });
  function viewFromState() {
    const st = match.state;
    return { hands: st.hands.map((h) => h.slice()), stock: st.stock.length, books: st.books.map((b) => b.map((x) => ({ rank: x.rank, slots: x.slots.slice() }))), arriving: new Set() };
  }
  const faceOf = (slot) => match?.face(slot) ?? null;
  // Your hand, by rank (so a rank's cards sit together), then suit.
  const sortKey = (slot) => {
    const f = faceOf(slot);
    return f === null ? 1000 + slot : rankOf(f) * 4 + Math.floor(f / 13);
  };

  // ---------- whose decision it is ----------
  // The player who must act now, on this screen (after the replay catches up).
  function decision() {
    if (!match || match.phase !== "playing" || table.pending || ended) return null;
    return { player: match.state.turn, phase: match.state.phase };
  }
  const myDecision = () => {
    const d = decision();
    return d && d.player === me ? d : null;
  };
  // It is your ask: a real choice, not an answer, a book or a lucky fish your browser makes.
  function myAsk() {
    const d = myDecision();
    return !!d && d.phase === "ask" && match.canMove() && !forcedMove(match.state, me, faceOf);
  }

  // ---------- rendering pieces ----------
  function renderHand() {
    const slots = view.hands[me].slice().sort((a, b) => sortKey(a) - sortKey(b));
    const asking = myAsk();
    const chosen = slots.filter((slot) => faceOf(slot) !== null && rankOf(faceOf(slot)) === selRank);
    table.renderHand(slots, {
      face: faceOf,
      arriving: view.arriving,
      first: chosen[0],
      look: (slot, face) => {
        const on = face !== null && rankOf(face) === selRank && asking;
        return {
          lift: on,
          classes: { chosen: on, askable: asking },
          label: face === null ? "A card, still being dealt" : `${cardWords(face)}${on ? ", chosen to ask for" : ""}`,
        };
      },
    });
    myCount.textContent = String(slots.length);
    myBooksCount.textContent = view.books[me].length ? `· ${plural(view.books[me].length, unit())}` : "";
  }

  function renderSeats() {
    const st = match?.state;
    const asking = myAsk();
    const options = asking ? askable(st, me) : [];
    for (const o of opps) {
      const n = view.hands[o.p].length;
      const out = st && n === 0 && st.out[o.p];
      o.render(view.hands[o.p], view.arriving, `${session.players[o.p].name}: ${out ? "out of cards" : plural(n, "card")}, ${plural(view.books[o.p].length, unit())}`);
      renderBooks(o.books, view.books[o.p]);
      const can = options.includes(o.p);
      o.pick.disabled = !can;
      o.pick.setAttribute("aria-label", can ? `Ask ${session.players[o.p].name}${selRank !== null ? ` for ${rankWords(selRank)}` : ""} (${plural(n, "card")})` : `${session.players[o.p].name}, ${plural(n, "card")}`);
      o.pick.setAttribute("aria-pressed", String(can && selSeat === o.p));
      o.node.classList.toggle("askable", can);
      o.node.classList.toggle("chosen", can && selSeat === o.p);
      o.node.classList.toggle("asked", shownAsk?.to === o.p);
      o.node.classList.toggle("out", !!out);
    }
    renderBooks(myBooks, view.books[me]);
    meArea.classList.toggle("asked", shownAsk?.to === me);
  }

  // Each book a small fan of its cards, face up; a long row overlaps more.
  function renderBooks(box, books) {
    const want = books.map((b) => String(b.slots[0]));
    const have = [...box.children].map((c) => c.dataset.book);
    if (have.join() !== want.join()) {
      for (const node of [...box.children]) if (!want.includes(node.dataset.book)) node.remove();
      books.forEach((b, i) => {
        let node = box.querySelector(`[data-book="${b.slots[0]}"]`);
        if (!node) {
          node = el("div", { class: "gf-book", dataset: { book: b.slots[0], rank: b.rank } }, b.slots.map((slot) => cardEl(faceOf(slot))));
        }
        if (box.children[i] !== node) box.insertBefore(node, box.children[i] ?? null);
      });
    }
    box.style.setProperty("--n", String(books.length));
    for (const node of box.children) node.style.opacity = view.arriving.has(Number(node.dataset.book)) ? "0" : "";
  }

  function renderCentre() {
    table.renderStock(view.stock);
    pondCount.textContent = view.stock ? "The pond" : "The pond is empty";
    const busy = match?.busy && match.phase !== "over" ? match.busy : null;
    table.renderBusy(busy, { starting: match?.phase === "starting", redraw: () => !destroyed && renderCentre() });
  }

  // ---------- motion ----------
  function seatRect(p, slot) {
    if (p === me) {
      const btn = slot !== undefined && handCards.get(slot);
      return btn ? rectIn(btn.firstChild) : rectIn(hand);
    }
    return seatOf(p).rect(slot);
  }
  const booksBox = (p) => (p === me ? myBooks : seatOf(p).books);

  // A speech bubble at a seat: "Got any 7s?", "Go fish!".
  function say(p, content, g, kind = "") {
    if (!live(g)) return;
    const host = p === me ? askBar : seatOf(p).node;
    host.querySelector(":scope > .gf-say")?.remove();
    const node = el("div", { class: `gf-say p-${p} ${kind}`, role: "presentation" }, content);
    host.append(node);
    // Kept inside the table; its tail still points at the seat.
    const b = node.getBoundingClientRect();
    const t = tableBox.getBoundingClientRect();
    const shift = Math.max(0, t.left + 8 - b.left) + Math.min(0, t.right - 8 - b.right);
    if (shift) {
      node.style.marginLeft = `${shift}px`;
      node.style.setProperty("--shift", `${shift}px`);
    }
    const end = () => node.remove();
    const ms = PACE.bubble * 1.7;
    if (fast()) return setTimeout(end, 900);
    node
      .animate(
        [
          { transform: "translate(-50%, 8px) scale(.7)", opacity: 0 },
          { transform: "translate(-50%, 0) scale(1)", opacity: 1, offset: 0.14 },
          { transform: "translate(-50%, 0) scale(1)", opacity: 1, offset: 0.85 },
          { transform: "translate(-50%, -6px) scale(.96)", opacity: 0 },
        ],
        { duration: ms, easing: easing("out") },
      )
      .finished.then(end, end);
  }

  // "Go fish!": rings spread on the pond beside the stock, and a fish leaps out and dives back.
  function splash(g) {
    if (fast() || !live(g)) return;
    const st = rectIn(stock);
    const w = st.w;
    const cx = st.x + w * 1.55;
    const cy = st.y + st.h * 0.7;
    for (const [i, d] of [0, 160].entries()) {
      const ring = el("span", { class: "gf-fx ring" });
      flyLayer.append(ring);
      ring
        .animate([{ transform: `translate(${cx}px, ${cy}px) scale(.3, .15)`, opacity: 0.9 }, { transform: `translate(${cx}px, ${cy}px) scale(${1.8 - i * 0.4}, ${0.9 - i * 0.2})`, opacity: 0 }], { duration: tokenMs("slow") * 3, delay: d, easing: easing("out"), fill: "backwards" })
        .finished.then(() => ring.remove(), () => ring.remove());
    }
    const fish = el("span", { class: "gf-fx fish" });
    fish.innerHTML = FISH_SVG;
    fish.style.setProperty("--fw", `${Math.round(w * 0.75)}px`);
    flyLayer.append(fish);
    const span = w * 0.55;
    const up = Math.min(90, st.h * 0.75);
    const at = (dx, dy, rot, s = 1) => `translate(${cx + dx}px, ${cy + dy}px) rotate(${rot}deg) scale(${s})`;
    fish
      .animate(
        [
          { transform: at(span, 6, 50, 0.5), opacity: 0 },
          { transform: at(span * 0.6, -up * 0.7, 30), opacity: 1, offset: 0.25 },
          { transform: at(0, -up, 0), opacity: 1, offset: 0.5 },
          { transform: at(-span * 0.6, -up * 0.7, -30), opacity: 1, offset: 0.75 },
          { transform: at(-span, 6, -50, 0.5), opacity: 0 },
        ],
        { duration: tokenMs("slow") * 3.2, easing: "cubic-bezier(.3,.1,.4,1)" },
      )
      .finished.then(() => fish.remove(), () => fish.remove());
    for (let i = 0; i < 5; i++) {
      const drop = el("span", { class: "gf-fx drop" });
      flyLayer.append(drop);
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      drop
        .animate([{ transform: `translate(${cx + span}px, ${cy}px) scale(.6)`, opacity: 0.9 }, { transform: `translate(${cx + span + Math.cos(a) * 34}px, ${cy + Math.sin(a) * 30}px) scale(1)`, opacity: 0 }], { duration: tokenMs("slow") * 2, delay: 60, easing: easing("out"), fill: "backwards" })
        .finished.then(() => drop.remove(), () => drop.remove());
    }
  }

  // Sparkles round a rect: a lucky catch, a book.
  function sparkle(r, p, g, n = 8) {
    if (fast() || !live(g)) return;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    for (let i = 0; i < n; i++) {
      const node = el("span", { class: `gf-fx spark p-${p}` });
      flyLayer.append(node);
      const a = (i / n) * Math.PI * 2;
      const d = Math.max(r.w, r.h) * 0.6 + 14;
      node
        .animate([{ transform: `translate(${cx}px, ${cy}px) scale(.2)`, opacity: 1 }, { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d}px) scale(1)`, opacity: 0 }], { duration: tokenMs("slow") * 2.4, easing: easing("out") })
        .finished.then(() => node.remove(), () => node.remove());
    }
  }

  // Moves `slot` from the pond to player p's hand.
  async function dealTo(p, slot, g, ms, sound = "deal") {
    const from = table.stockRect();
    view.stock = Math.max(0, view.stock - 1);
    view.hands[p].push(slot);
    view.arriving.add(slot);
    render();
    if (sound) play(sound);
    await fly(p === me ? faceOf(slot) : null, from, seatRect(p, slot), { ms, turn: p === me && faceOf(slot) !== null ? "up" : null, g });
    view.arriving.delete(slot);
    if (live(g)) render();
  }

  // Cards handed over, face up: from the answerer's hand to the asker's.
  async function handOver(ev, g, k) {
    const from = new Map(ev.slots.map((slot) => [slot, seatRect(ev.p, slot)]));
    view.hands[ev.p] = view.hands[ev.p].filter((s) => !ev.slots.includes(s));
    for (const slot of ev.slots) {
      view.hands[ev.to].push(slot);
      view.arriving.add(slot);
    }
    render();
    // At once (reduced motion, a hidden tab): one slide, not a burst.
    if (fast()) play("draw");
    await Promise.all(
      ev.slots.map((slot, i) =>
        wait(i * 110 * k, g).then(async () => {
          if (!fast()) play("draw");
          await fly(faceOf(slot), from.get(slot), seatRect(ev.to, slot), { ms: PACE.give * k, turn: ev.to === me ? null : "down", g });
          view.arriving.delete(slot);
          if (live(g)) render();
        }),
      ),
    );
  }

  // A book: its cards gather from the hand and fan down in front of their owner.
  async function layBook(ev, g, k) {
    const from = new Map(ev.slots.map((slot) => [slot, seatRect(ev.p, slot)]));
    view.hands[ev.p] = view.hands[ev.p].filter((s) => !ev.slots.includes(s));
    view.books[ev.p].push({ rank: ev.rank, slots: ev.slots.slice() });
    view.arriving.add(ev.slots[0]);
    render();
    const node = booksBox(ev.p).querySelector(`[data-book="${ev.slots[0]}"]`);
    const targets = node ? [...node.children].map((c) => rectIn(c)) : [];
    await Promise.all(ev.slots.map((slot, i) => wait(i * 70 * k, g).then(() => fly(faceOf(slot), from.get(slot), targets[i] ?? rectIn(booksBox(ev.p)), { ms: PACE.book * k, turn: ev.p === me ? null : "up", spin: (i - 1.5) * 6, g }))));
    view.arriving.delete(ev.slots[0]);
    if (!live(g)) return;
    render();
    play("book");
    if (node && !fast()) node.animate([{ transform: "scale(1.25)" }, { transform: "scale(1)" }], { duration: tokenMs("slow") * 1.4, easing: easing("spring") });
    if (node) sparkle(rectIn(node), ev.p, g, 10);
    // The last book of the game: confetti from where it landed.
    if (view.books.flat().length === totalBooks(match.state) && node) table.confetti(rectIn(node), ev.p, seats, g);
  }

  // A lucky fish is shown: your card hops; another player's flips up over their seat.
  async function showLucky(ev, g, k) {
    if (ev.p === me) {
      const btn = handCards.get(ev.slot);
      if (btn && !fast() && live(g)) btn.firstChild.animate([{ transform: "translateY(0)" }, { transform: "translateY(-22px) rotate(-4deg)", offset: 0.4 }, { transform: "translateY(0)" }], { duration: tokenMs("slow") * 2.4, easing: easing("spring") });
      if (btn) sparkle(rectIn(btn.firstChild), me, g);
      await wait(PACE.bubble * 0.7 * k, g);
      return;
    }
    const from = seatRect(ev.p, ev.slot);
    const r = rectIn(pond);
    const to = { x: from.x + (r.x + r.w / 2 - from.x) * 0.35, y: from.y + 30, w: r.w * 0.55, h: r.w * 0.55 * 1.4 };
    if (fast() || !live(g)) return;
    const card = cardEl(faceOf(ev.slot), { down: true });
    card.classList.add("gf-shown");
    card.style.width = `${to.w}px`;
    card.style.height = `${to.h}px`;
    flyLayer.append(card);
    card.animate([{ transform: `translate(${from.x}px, ${from.y}px) scale(${from.w / to.w})`, opacity: 0.6 }, { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1, offset: 0.35 }, { transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1, offset: 0.8 }, { transform: `translate(${from.x}px, ${from.y}px) scale(${from.w / to.w})`, opacity: 0 }], {
      duration: PACE.bubble * 1.8 * k,
      easing: easing("out"),
      fill: "forwards",
    });
    const inner = card.querySelector(".in");
    inner.animate([{ transform: "rotateY(180deg)" }, { transform: "rotateY(0deg)" }], { duration: PACE.bubble * 0.5 * k, delay: PACE.bubble * 0.3 * k, easing: easing("out"), fill: "forwards" });
    setTimeout(() => sparkle(to, ev.p, g), PACE.bubble * 0.6 * k);
    await wait(PACE.bubble * 1.8 * k, g);
    card.remove();
  }

  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    if (ev.type === "deal") {
      view = emptyView();
      render();
      await table.deal(ev.hands, ev.first, { gap: PACE.deal, ms: PACE.dealFly }, (p, slot, ms, sound) => dealTo(p, slot, g, ms, sound), g);
    } else if (ev.type === "ask") {
      shownAsk = { p: ev.p, to: ev.to, rank: ev.rank };
      render();
      play("ask");
      // With more than two at the table, the bubble names who is asked.
      say(ev.p, `${count > 2 && ev.to !== me ? `${session.players[ev.to].name}, got any` : "Got any"} ${rankWords(ev.rank)}?`, g, "ask");
      addLog({ player: ev.p, rank: ev.rank, text: `${nameOf(ev.p)} asked ${ev.to === me ? "you" : nameOf(ev.to)} for ${rankWords(ev.rank)}` });
      await wait(PACE.bubble * k, g);
    } else if (ev.type === "give") {
      say(ev.p, ev.slots.length === 1 ? "Here you go!" : ev.slots.length === 2 ? "Here, both!" : `Here, all ${NUMBER[ev.slots.length] ?? ev.slots.length}!`, g, "give");
      shownAsk = null;
      await handOver(ev, g, k);
      if (!live(g)) return;
      addLog({ player: ev.p, faces: ev.slots.map(faceOf), text: `${nameOf(ev.p)} handed ${ev.to === me ? "you" : nameOf(ev.to)} ${cardsOf(ev.slots.length, ev.rank)}` });
      await wait(PACE.between * k, g);
    } else if (ev.type === "fish") {
      const fishIcon = el("span", { class: "gf-say-fish", "aria-hidden": "true" });
      fishIcon.innerHTML = FISH_SVG;
      say(ev.p, [fishIcon, "Go fish!"], g, "fish");
      shownAsk = null;
      render();
      play("fish");
      splash(g);
      addLog({ player: ev.p, kind: "fish", text: `${nameOf(ev.p)}: “Go fish!”` });
      await wait(PACE.bubble * 0.85 * k, g);
    } else if (ev.type === "draw") {
      await dealTo(ev.p, ev.slot, g, PACE.draw * k, "draw");
      if (!live(g)) return;
      const why = ev.why === "empty" ? " (out of cards)" : ev.why === "alone" ? " (nobody to ask)" : "";
      // Your own card is named once its face has arrived (see renderLog).
      addLog({ player: ev.p, slot: ev.p === me ? ev.slot : undefined, face: null, why, text: `${nameOf(ev.p)} drew a card${why}` });
    } else if (ev.type === "lucky") {
      say(ev.p, `Lucky catch: ${cardsOf(1, ev.rank)}!`, g, "lucky");
      play("lucky");
      addLog({ player: ev.p, face: faceOf(ev.slot), kind: "lucky", text: `${nameOf(ev.p)} caught ${cardsOf(1, ev.rank)}, as asked: another turn` });
      await showLucky(ev, g, k);
    } else if (ev.type === "book") {
      await layBook(ev, g, k);
      if (!live(g)) return;
      const pair = ev.slots.length === 2;
      addLog({ player: ev.p, faces: ev.slots.map(faceOf), kind: "book", text: `${nameOf(ev.p)} laid down ${pair ? "a pair" : "a book"} of ${rankWords(ev.rank)}` });
      await wait(PACE.between * 1.5 * k, g);
    } else if (ev.type === "take") {
      play("gather");
      await Promise.all(ev.slots.map((slot, i) => wait(i * PACE.take * k, g).then(() => live(g) && dealTo(ev.p, slot, g, PACE.draw * k, null))));
      if (!live(g)) return;
      addLog({ player: ev.p, text: `${nameOf(ev.p)} took the rest of the pond (${plural(ev.slots.length, "card")})` });
    } else if (ev.type === "out") {
      say(ev.p, "Out of cards", g, "out");
      play("out");
      addLog({ player: ev.p, text: `${nameOf(ev.p)} ${ev.p === me ? "are" : "is"} out of cards` });
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
      shownAsk = match?.state?.phase === "answer" ? { p: match.state.ask.from, to: match.state.ask.to, rank: match.state.ask.rank } : null;
      view = viewFromState();
      for (const robot of window.ddp.robots || []) robot.poke?.();
    }
    render();
  }

  // ---------- log ----------
  const logLine = (e) => [
    e.faces ? el("span", { class: "gf-minis" }, e.faces.map((f) => miniCard(f))) : e.face !== undefined ? miniCard(e.face) : e.rank !== undefined ? rankChip(e.rank) : null,
    el("span", {}, e.text),
  ];
  function addLog(entry) {
    entry.node = el("li", { class: `${entry.player === undefined ? "" : `p-${entry.player}`} ${entry.kind || ""} fresh` }, logLine(entry));
    log = [entry, ...log].slice(0, 7);
    log.slice(1).forEach((e) => e.node.classList.remove("fresh"));
    logList.replaceChildren(...log.map((e) => e.node));
    renderLog();
  }

  // A card you drew is named once its face has arrived.
  function renderLog() {
    for (const e of log) {
      if (e.slot === undefined || e.face !== null || faceOf(e.slot) === null) continue;
      e.face = faceOf(e.slot);
      e.text = `You drew ${cardWords(e.face).replace(/^\w/, (c) => c.toLowerCase())}${e.why}`;
      e.node.replaceChildren(...logLine(e));
    }
  }

  // ---------- your ask ----------
  function pickRank(slot) {
    if (!myAsk()) {
      if (match?.phase === "playing" && match.state.turn !== me) toast(`Wait for ${nameOf(match.state.turn)}`);
      return;
    }
    const f = faceOf(slot);
    if (f === null) return;
    selRank = selRank === rankOf(f) ? null : rankOf(f);
    play("deal", { offset: -4 });
    render();
  }
  table.onPick((slot) => pickRank(slot));

  function pickSeat(p) {
    if (!myAsk()) return;
    selSeat = selSeat === p ? null : p;
    render();
    if (selRank === null) hand.querySelector(".gf-hcard[tabindex='0']")?.focus({ preventScroll: true });
    else askBtn.focus({ preventScroll: true });
  }

  function askNow() {
    if (!myAsk()) return;
    const st = match.state;
    const options = askable(st, me);
    const to = options.length === 1 ? options[0] : selSeat;
    if (selRank === null || to === null || !options.includes(to)) {
      play("nope");
      return toast(selRank === null ? "Pick a card first: you ask for its rank" : "Pick a player to ask");
    }
    const move = { ask: selRank, from: to };
    selRank = null;
    selSeat = null;
    match.play(move);
  }

  // A, or Enter on the button, asks; Escape clears your choice.
  function onKey(e) {
    if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" && (selRank !== null || selSeat !== null)) {
      selRank = null;
      selSeat = null;
      render();
    } else if ((e.key === "a" || e.key === "A") && myAsk()) askNow();
  }
  addEventListener("keydown", onKey);

  // ---------- render ----------
  function describe(ev) {
    if (!ev) return null;
    if (ev.type === "deal") return "Dealing…";
    if (ev.type === "ask") return ev.to === me ? `${nameOf(ev.p)} asks you for ${rankWords(ev.rank)}…` : `${nameOf(ev.p)} ${ev.p === me ? "ask" : "asks"} ${nameOf(ev.to)} for ${rankWords(ev.rank)}…`;
    if (ev.type === "give") return `${nameOf(ev.p)} ${ev.p === me ? "hand" : "hands"} over ${plural(ev.slots.length, "card")}.`;
    if (ev.type === "fish") return `${nameOf(ev.p)}: “Go fish!”`;
    if (ev.type === "draw") return `${nameOf(ev.p)} ${ev.p === me ? "draw" : "draws"} from the pond…`;
    if (ev.type === "lucky") return `A lucky catch for ${ev.p === me ? "you" : nameOf(ev.p)}: ${ev.p === me ? "you go" : "they go"} again!`;
    if (ev.type === "book") return `${nameOf(ev.p)} ${ev.p === me ? "lay" : "lays"} down ${ev.slots.length === 2 ? "a pair" : "a book"} of ${rankWords(ev.rank)}!`;
    if (ev.type === "take") return `${nameOf(ev.p)} ${ev.p === me ? "take" : "takes"} the rest of the pond.`;
    if (ev.type === "out") return `${nameOf(ev.p)} ${ev.p === me ? "are" : "is"} out of cards.`;
    return null;
  }

  function statusText() {
    if (ended) return "The game has ended.";
    if (!match) return "Getting the room's settings…";
    const st = match.state;
    if (match.phase === "aborted") return "Match stopped.";
    if (match.phase === "starting") return DECK_WORK[match.busy]?.[0] ?? "Getting ready…";
    const now = describe(current);
    if (now) return now;
    if (table.pending) return status.textContent || "…";
    if (match.phase === "over") return overLine(st);
    const d = decision();
    if (!d) return "…";
    if (d.phase === "open") return d.player === me ? `Laying down any ${unit()}s you were dealt…` : `Everyone lays down the ${unit()}s they were dealt…`;
    if (d.phase === "answer") {
      const a = st.ask;
      if (d.player === me) return `${nameOf(a.from)} ${a.from === me ? "ask" : "asks"} you for ${rankWords(a.rank)}…`;
      return `${nameOf(a.from)} ${a.from === me ? "ask" : "asks"} ${nameOf(a.to)} for ${rankWords(a.rank)}…`;
    }
    if (d.phase === "drawn" && !st.ask) return `${nameOf(d.player)} drew a card: nobody to ask.`;
    if (d.phase === "drawn") return d.player === me ? "You went fishing…" : `${nameOf(d.player)} went fishing…`;
    if (d.player !== me) return `${nameOf(d.player)}'s turn…`;
    if (match.busy) return DECK_WORK[match.busy][0];
    if (!myAsk()) return forcedMove(st, me, faceOf)?.book ? `Laying down your ${unit()}…` : "…";
    const options = askable(st, me);
    if (options.length === 1) return selRank === null ? `Your turn: pick a card to ask ${nameOf(options[0])} for.` : `Ask ${nameOf(options[0])} for ${rankWords(selRank)}?`;
    if (selRank === null && selSeat === null) return "Your turn: pick a card, then a player to ask.";
    if (selRank === null) return `Pick a card to ask ${nameOf(selSeat)} for.`;
    if (selSeat === null) return `Who do you ask for ${rankWords(selRank)}? Tap a player.`;
    return `Ask ${nameOf(selSeat)} for ${rankWords(selRank)}?`;
  }

  // Who won: one player, or a shared win.
  function overLine(st) {
    const w = st.winners;
    const n = st.books[w[0]].length;
    const what = plural(n, unit());
    if (w.length === 1) return w[0] === me ? `You win with ${what}!` : `${nameOf(w[0])} wins with ${what}.`;
    if (w.length === count) return `A tie: everyone has ${what}.`;
    const names = w.map((p) => (p === me ? "you" : nameOf(p)));
    return `A shared win: ${listOf(names).replace(/^\w/, (c) => c.toUpperCase())} have ${what} each.`;
  }

  function render() {
    if (destroyed) return;
    const st = match?.state;
    const phase = ended ? "ended" : match?.phase || "setup";
    rootBox.dataset.phase = phase;
    rootBox.classList.toggle("four-colour", four());
    const d = decision();
    const shownTurn = current?.p ?? (phase === "playing" ? st?.turn : undefined);
    if (view) {
      const outs = st ? seats.map((p) => view.hands[p].length === 0 && st.out[p]) : [];
      bar.update({
        turn: phase === "playing" && shownTurn !== undefined ? shownTurn : -1,
        notes: seats.map((p) => (!st ? "" : phase === "over" ? plural(view.books[p].length, unit()) : outs[p] ? "out" : plural(view.hands[p].length, "card"))),
        score: { wins: seats.map((p) => view.books[p].length) },
      });
    }
    for (const o of opps) o.node.classList.toggle("active", shownTurn === o.p && phase === "playing");
    meArea.classList.toggle("active", shownTurn === me && phase === "playing");
    status.textContent = statusText();
    const mine = myDecision();
    status.className = `${table.cls("status")} ${d ? `p-${d.player}` : ""} ${mine ? "mine" : ""}`;
    const asking = myAsk();
    if (!asking) {
      selRank = null;
      selSeat = null;
    } else {
      const options = askable(st, me);
      if (options.length === 1) selSeat = options[0];
      if (selSeat !== null && !options.includes(selSeat)) selSeat = null;
      if (selRank !== null && !ranksIn(st.hands[me], faceOf).includes(selRank)) selRank = null;
    }
    if (view) {
      renderSeats();
      renderCentre();
      renderHand();
    }
    renderAsk(asking);
    renderLog();
    renderTimer();
    renderResult();
    setTabAlert(asking ? "Your turn" : null);
    if (asking) {
      const key = `${m}:${st.turns}`;
      if (cuedTurn !== key) {
        cuedTurn = key;
        play("turn");
      }
    }
    autoMove();
  }

  function renderAsk(asking) {
    askBtn.hidden = !asking;
    tableBox.classList.toggle("my-ask", asking);
    if (!asking) {
      handHint.textContent = "";
      hint.textContent = !match || match.phase !== "playing" ? "" : "Ask for a rank you hold. Got them all? You go again. Go fish? You draw from the pond.";
      hint.parentNode.hidden = !hint.textContent;
      return;
    }
    hint.parentNode.hidden = false;
    const options = askable(match.state, me);
    const to = options.length === 1 ? options[0] : selSeat;
    askBtn.disabled = selRank === null || to === null;
    askBtn.textContent = selRank === null && to === null ? "Pick a card and a player" : selRank === null ? `Ask ${nameOf(to)} for…` : to === null ? `Ask … for ${rankWords(selRank)}` : `Ask ${nameOf(to)} for ${rankWords(selRank)}`;
    handHint.textContent = selRank === null ? "Tap a card to ask for its rank" : options.length > 1 && to === null ? "Now tap a player" : "";
    hint.textContent = "Tap a card, then a player, then Ask. Keys: arrows and Enter in your hand, Tab to the players, A asks, Esc clears.";
  }

  // Answers, books, lucky fish and the end of a turn: made for you, truthfully, after a short beat.
  function autoMove() {
    const d = myDecision();
    if (!d || !match.canMove()) return;
    const move = forcedMove(match.state, me, faceOf);
    if (!move) return;
    const key = `${m}:${match.state.moves}`;
    if (autoKey === key) return;
    autoKey = key;
    const ms = fast() || (move.done && d.phase === "open") ? 0 : move.give || move.fish ? AUTO.answer : move.book ? AUTO.book : move.show !== undefined ? AUTO.show : AUTO.done;
    const g = table.gen;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (live(g) && myDecision() && match.canMove() && `${m}:${match.state.moves}` === key) match.play(forcedMove(match.state, me, faceOf));
    }, ms);
  }

  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    // Asks only: answers and books are made by each browser at once.
    timer.hidden = !secs || !d || d.phase !== "ask";
    if (timer.hidden) return;
    const key = `${m}:${match.state.moves}`;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (secs * 1000))).toFixed(3)})`;
    timer.className = `gf-timer p-${d.player} ${left < 5000 ? "low" : ""}`;
    timerText.textContent = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
    if (d.player === me && left <= 3000 && left > 0) {
      const sec = Math.ceil(left / 1000);
      if (sec !== lastTick) {
        lastTick = sec;
        play("tick");
      }
    }
  }

  // Your time ran out: a sensible ask is made for you (a stalled player would hold up everyone).
  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !config?.moveSeconds) return;
    renderTimer();
    const d = decision();
    if (!d || d.phase !== "ask") return;
    const left = deadline - performance.now();
    if (d.player === me && left <= 0 && timedOut !== deadlineKey && myAsk()) {
      timedOut = deadlineKey;
      selRank = null;
      selSeat = null;
      const move = timeoutMove(match.state, me, faceOf);
      toast(`Time's up: asked ${nameOf(move.from)} for ${rankWords(move.ask)} for you`);
      match.play(move);
    } else if (d.player !== me && left <= -CLAIM_GRACE_MS) {
      status.textContent = `Waiting for ${nameOf(d.player)}'s browser…`;
    }
  }
  const ticker = setInterval(tick, 200);

  // ---------- the end ----------
  // The winners' books, in the order they light up.
  function winnerBooks() {
    const st = match?.state;
    if (!st || match.phase !== "over") return [];
    return st.winners.flatMap((p) => [...booksBox(p).children]);
  }

  const verdictText = (v) => verdictOf(v, nameOf);

  function verdictLine() {
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "gf-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle proved, and every ask and answer checked with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "gf-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    return el("p", { class: "verdict", id: "gf-verdict" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Checking every shuffle and replaying the game…");
  }

  // Everyone's books, most first; players level on books share a place.
  function standings(st) {
    const order = seats.slice().sort((a, b) => st.books[b].length - st.books[a].length || a - b);
    return el(
      "ol",
      { class: "gf-standings", id: "gf-standings" },
      order.map((p) => {
        const n = st.books[p].length;
        const place = order.findIndex((q) => st.books[q].length === n);
        return el(
          "li",
          { class: `p-${p} ${p === me ? "mine" : ""}` },
          el("span", { class: "place" }, PLACE[place]),
          el("span", { class: "who" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, p === me ? "You" : session.players[p].name)),
          el("span", { class: "gf-ranks", "aria-label": `${plural(n, unit())}: ${st.books[p].map((b) => rankWords(b.rank)).join(", ")}` }, st.books[p].map((b) => rankChip(b.rank))),
          el("small", { class: "mono" }, String(n)),
        );
      }),
    );
  }

  let shownFor = null;
  let extra = null;
  function renderResult() {
    const phase = match?.phase;
    // Let the last book land first.
    if (ended || (phase !== "over" && phase !== "aborted") || (phase === "over" && table.pending)) {
      result.hide();
      shownFor = null;
      return;
    }
    if (phase === "aborted") return result.show({ stopped: true, reason: abortText({ reason: match.abortReason, seat: match.abortSeat, about: match.abortAbout }, nameOf) });
    const st = match.state;
    const w = st.winners;
    // A shared win: "You won" for each winner, the first winner's name for the others, and a draw when everyone ties.
    const winner = w.length === count ? -1 : w.includes(me) ? me : w[0];
    const others = w.filter((p) => p !== me).map(nameOf);
    const what = plural(st.books[w[0]].length, unit());
    const reason = w.length === 1 ? `${w[0] === me ? "You" : nameOf(w[0])} laid down the most: ${what}.` : w.length === count ? `Everyone has ${what}.` : w.includes(me) ? `A shared win with ${listOf(others)}: ${what} each.` : `A shared win: ${listOf(w.map(nameOf))} have ${what} each.`;
    const key = `${m}:${!!match.verdict}`;
    if (shownFor !== key) {
      shownFor = key;
      extra = el("div", { class: "gf-over pc-game" }, standings(st), verdictLine());
    }
    result.show({ winner, reason, extra });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    m += 1;
    table.reset();
    clearTimeout(autoTimer);
    current = null;
    shownAsk = null;
    view = emptyView();
    log = [];
    cuedTurn = "";
    autoKey = "";
    deadlineKey = "";
    timedOut = "";
    selRank = null;
    selSeat = null;
    shownFor = null;
    logList.replaceChildren();
    for (const box of [myBooks, ...opps.map((o) => o.books)]) box.replaceChildren();
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
    const parts = [c.hand === "classic" ? `${count === 4 ? 5 : 7} cards each` : `${c.hand} cards each`, c.books === 2 ? "pairs" : "books of four", c.lucky === "again" ? "a lucky fish goes again" : "a lucky fish passes", c.empty === "draw" ? "an empty hand draws one" : "an empty hand sits out"];
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s to ask`);
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
    clearTimeout(autoTimer);
    table.shuffling(false);
    // Just after a rematch started, the game to report on is the one before.
    const judged = match?.phase === "starting" && previous ? previous : match;
    leaveNotice({ root, session, seat, match: judged, prefix: "gf", game: "Go Fish", nameOf, facts: (st, p) => `${plural(st.hands[p].length, "card")}, ${plural(st.books[p].length, unit())}` });
    render();
  }

  screenBusy = () => table.pending > 0;
  hurry = () => !!match?.state && match.phase === "playing" && match.state.out[me];
  const onVisible = () => render();
  document.addEventListener("visibilitychange", onVisible);
  const resize = new ResizeObserver(() => view && render());
  resize.observe(tableBox);
  const offs = [offMsg, session.on("end", onEnd), session.on("rematch-start", () => config && newMatch())];
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
      hurry = () => false;
      clearInterval(ticker);
      clearTimeout(autoTimer);
      resize.disconnect();
      setTabAlert(null);
      removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      for (const off of offs) off();
    },
  };
}
