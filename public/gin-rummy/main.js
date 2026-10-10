// Gin Rummy page: mounts the engine shell and renders a CardMatch. The rules
// live in rules.js, the melds in engine/cards/melds.js, and the card table's
// shared pieces (art, seat, hand, stock, spreads, motion) in engine/cards/.
// This file is the view: the piles, your hand grouped into melds (which you
// can rearrange), the knock, both hands laid down at the end of a hand and
// the points adding up. Laying down and laying off are made for you, the
// best way, after a short beat. The match state never waits for the screen:
// every event is queued and played out in order, faster when they pile up,
// and at once with reduced motion or a hidden tab.
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
import { cardWords, cardName, rankOf, suitOf } from "../engine/cards/faces.js";
import { bestMelds, isRun, sortMeld } from "../engine/cards/melds.js";
import { makeRules, normalizeConfig, forcedMove, bestKnock, arrange, GIN_BONUS, BIG_GIN_BONUS, UNDERCUT_BONUS } from "./rules.js";
import { chooseMove, startRobot, timeoutMove } from "./robot.js";
import { settings } from "./settings.js";
import { play } from "./sounds.js";

// How long robots take before each move (robotPause() scales these in tests).
const ROBOT_PACE = { upcard: 700, draw: 480, discard: 820, option: 50, knock: 1300, forced: 420, next: 650, max: 2000 };
// Your browser's own lay-down and defence, after a short beat.
const AUTO = { lay: 600, defend: 700 };
const PACE = { deal: 55, dealFly: 280, flip: 420, draw: 380, take: 440, discard: 400, moment: 900, lay: 460, layoff: 520, count: 40, gather: 460, between: 160, bubble: 820 };
const CLAIM_GRACE_MS = 6000; // past a player's time before we say their browser is quiet
const LEVEL_NAME = { easy: "Easy", medium: "Medium", hard: "Hard" };
const KIND = { knock: "Knock", undercut: "Undercut!", gin: "Gin!", big: "Big Gin!" };

// Robot games: robots wait for the screen to finish replaying. The view sets this.
let screenBusy = () => false;

// A robot's pause: a beat for a forced move or a draw, a real think for a discard or a knock.
function robotDelay(st, me, move, level) {
  return humanPause(screenBusy, () => {
    if (move.melds) return ROBOT_PACE.forced;
    if (move.next) return ROBOT_PACE.next;
    if (move.take || move.pass) return ROBOT_PACE.upcard + Math.random() * 300;
    if (move.draw) return ROBOT_PACE.draw + Math.random() * 260;
    if (move.knock) return ROBOT_PACE.knock + Math.random() * 300;
    return Math.min(ROBOT_PACE.max, ROBOT_PACE.discard + ROBOT_PACE.option * st.hands[me].length + Math.random() * 450 - (level === "easy" ? 150 : 0));
  });
}

startGameShell({
  slug: "gin-rummy",
  title: "Gin Rummy",
  layout: "wide",
  settings,
  createRobot: (session) => {
    const config = settings.get();
    return startRobot(session, {
      rules: makeRules(config),
      choose: (st, me, rng, face) => chooseMove(st, me, rng, face, { level: config.level }),
      delay: (st, me, move) => robotDelay(st, me, move, config.level),
    });
  },
  onSession: (session, root, shell) => mountGame(session, root, shell),
});

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function mountGame(session, root, shell) {
  const me = session.index;
  const them = 1 - me;
  const seats = [0, 1];
  const myName = session.me.name === "You" ? "You" : `${session.me.name} (you)`;
  const theirName = session.players[them].name;
  const nameOf = (p) => (p === me ? "You" : session.players[p].name);
  // "You pass", "Bo passes"
  const verb = (p, s) => (p !== me ? s : /(ss|sh|ch|o)es$/.test(s) ? s.slice(0, -2) : s.replace(/s$/, ""));
  const robotGame = session.mode === "robot";
  let config = null;
  let rules = null;
  let match = null;
  let m = 0;
  let destroyed = false;
  let ended = false;
  let current = null; // the event being played out
  let view = null; // the table as drawn
  let log = [];
  let cuedTurn = "";
  let autoKey = "";
  let autoTimer = null;
  let deadline = 0;
  let deadlineKey = "";
  let timedOut = "";
  let lastTick = 0;
  let selected = null; // the card picked to discard
  let order = []; // your hand in the order you arranged it
  let sortMode = "rank"; // "rank", "suit", or null once you move cards yourself
  let sortChosen = "rank"; // the last sort you picked: each new hand starts with it
  let wantNext = 0; // the hand you said "Next hand" after, before it was your turn to say so
  let meldSeen = null; // the cards in melds on screen last time, for the click as one joins
  let lastClick = 0;
  let previous = null; // the match before a rematch, whose verdict may still be on its way
  let lastVerdict = ""; // that verdict in words, once it arrives
  let games = ""; // games won so far, in words, for the note
  let carried = [0, 0]; // one hand a game: points from the games before
  let gamesWon = [0, 0];
  let shownHand = { slots: [], melds: [], dead: [], points: 0 };
  const four = () => settings.get().fourColor;
  // The shared table: cards, seat, stock, hand, spreads and motion (engine/cards/table.js).
  const table = cardTable({ prefix: "gr", play, animate: (ev, g) => animate(ev, g), done: (idle) => replayed(idle) });
  const { cardEl, setFace, miniCard, fly, live, fast, wait, rectIn, flyLayer, hand, handCards } = table;

  // "setup" is for this view (only from the room's creator); the rest goes to the matches.
  let route = () => {};
  const router = matchRouter({ onMessage: (fn) => (route = fn) });
  const offMsg = session.onMessage((msg, from) => (msg.t === "setup" ? from === 0 && onSetup(msg) : route(msg, from)));

  // ---------- layout ----------
  const bar = playerBar(session, { onLeave: () => shell.leave(), classes: (p) => `p-${p}` });
  bar.update({ badges: seats.map(() => el("span", { class: "dot", "aria-hidden": "true" })) });
  const status = el("p", { class: table.cls("status"), id: "gr-status", role: "status", "aria-live": "polite", tabindex: "-1" });

  // The other player: a fan of backs, or their hand laid down.
  const seat = table.makeSeat({ p: them, name: theirName, pos: "top" });
  const oppDealer = el("span", { class: "gr-dealer", hidden: true }, "Dealer");
  const oppSpread = table.makeSpread("them");
  const oppTally = el("span", { class: "gr-tally mono", id: "gr-tally-them", hidden: true });
  seat.pill.append(oppDealer);
  seat.node.insertBefore(oppSpread.node, seat.pill);
  seat.pill.after(oppTally);

  // The middle: the stock and the discard pile, the knock limit, and the score of a hand once it ends.
  const stockBtn = table.makeStock({ onClick: () => drawFrom("stock"), label: (left) => (left ? `The stock: ${plural(left, "card")}` : "The stock is empty") });
  const pile = el("button", { class: "gr-pile", id: "gr-pile", type: "button", onclick: () => takePile() });
  const limitChip = el("span", { class: "gr-limit", id: "gr-limit", hidden: true });
  const scoreTitle = el("strong", { class: "gr-score-title" });
  const scoreSum = el("span", { class: "gr-score-sum" });
  const scorePoints = el("span", { class: "gr-score-points mono" });
  const scoreTotals = el("span", { class: "gr-score-totals" });
  const scoreCard = el("div", { class: "gr-score", id: "gr-score", hidden: true }, scoreTitle, scoreSum, scorePoints, scoreTotals);
  const piles = el(
    "div",
    { class: "gr-piles" },
    el("div", { class: "gr-col" }, el("div", { class: table.cls("stack") }, stockBtn, table.riffle), el("span", { class: "gr-label" }, "Stock")),
    el("div", { class: "gr-col" }, pile, el("span", { class: "gr-label" }, "Discard")),
  );
  const centre = el("div", { class: "gr-centre" }, piles, scoreCard, limitChip, table.busyChip);

  // Your corner: what you can do now, your hand (or your hand laid down), and your deadwood.
  const takeBtn = el("button", { class: "btn small primary", type: "button", id: "gr-take", hidden: true, onclick: () => takePile() });
  const passBtn = el("button", { class: "btn small", type: "button", id: "gr-pass", hidden: true, onclick: () => pass() }, "Pass");
  const drawBtn = el("button", { class: "btn small", type: "button", id: "gr-draw", hidden: true, onclick: () => drawFrom("stock") }, "Draw from the stock");
  const discardBtn = el("button", { class: "btn small", type: "button", id: "gr-discard", hidden: true, onclick: () => selected !== null && discardNow(selected) });
  const knockLabel = el("span", {});
  const knockNote = el("small", {});
  const knockBtn = el("button", { class: "btn primary gr-knock", type: "button", id: "gr-knock", hidden: true, onclick: () => knockNow() }, knockLabel, knockNote);
  const nextBtn = el("button", { class: "btn primary", type: "button", id: "gr-next", hidden: true, onclick: () => nextHand() }, "Next hand");
  const timerFill = el("span");
  const timerText = el("span", { class: "mono" });
  const timer = el("div", { class: "gr-timer", id: "gr-timer", hidden: true, role: "timer", "aria-label": "Time for your move" }, el("span", { class: "bar" }, timerFill), timerText);
  const actionBar = el("div", { class: "gr-bar", id: "gr-bar" }, takeBtn, passBtn, drawBtn, discardBtn, knockBtn, nextBtn, timer);
  const mySpread = table.makeSpread("mine");
  const myCount = el("span", { class: "count mono" }, "0");
  const myDealer = el("span", { class: "gr-dealer", hidden: true }, "Dealer");
  const deadNum = el("strong", { class: "mono" }, "0");
  const deadChip = el("span", { class: "gr-deadwood", id: "gr-deadwood" }, "Deadwood ", deadNum);
  const sortRank = el("button", { class: "gr-sort", type: "button", id: "gr-sort-rank", onclick: () => sortBy("rank") }, "Rank");
  const sortSuit = el("button", { class: "gr-sort", type: "button", id: "gr-sort-suit", onclick: () => sortBy("suit") }, "Suit");
  const sorts = el("span", { class: "gr-sorts", role: "group", "aria-label": "Sort your hand by" }, el("span", { class: "gr-sort-label", "aria-hidden": "true" }, "Sort"), sortRank, sortSuit);
  const myPill = el("span", { class: "pill" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", { class: "name" }, myName), myCount, myDealer);
  const handHint = el("p", { class: table.cls("hand-hint"), id: "gr-hand-hint" });
  const meArea = el("div", { class: table.cls("me", `p-${me}`) }, actionBar, hand, mySpread.node, el("div", { class: "gr-me-row" }, myPill, deadChip, sorts), handHint);
  const tableBox = el("div", { class: table.cls("table"), id: "gr-table" }, el("div", { class: table.cls("opps") }, seat.node), centre, meArea);
  const tableWrap = el("div", { class: table.cls("table-wrap") }, tableBox, flyLayer);

  const hint = el("p", { class: table.cls("hint"), id: "gr-hint" });
  const logList = el("ol", { class: table.cls("log"), id: "gr-log", "aria-label": "Recent moves" });
  const configLine = el("p", { class: table.cls("config"), id: "gr-config" });
  const note = el("p", { class: table.cls("note"), id: "gr-note" });

  const result = resultPanel(session, {
    onLeave: () => shell.leave(),
    // The result moment: the winner's melds light up; a loss dims the table.
    onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "paper", highlight: winnerCards(), board: tableBox }),
  });

  const rootBox = el(
    "div",
    { class: "gin-rummy pc-game", dataset: { you: me === 0 ? "a" : "b", seat: me } },
    table.symbolHost,
    bar.node,
    status,
    el("div", { class: table.cls("main") }, tableWrap, el("div", { class: table.cls("side") }, el("div", { class: table.cls("actions") }, hint), logList)),
    configLine,
    note,
  );
  root.append(rootBox, result.node);

  // ---------- the table as drawn ----------
  const emptyView = (scores = [0, 0]) => ({ hands: [[], []], stock: 52, discard: [], took: new Set(), laid: [null, null], layoffs: [], knock: null, result: null, scores: scores.slice(), tally: [null, null], dealer: -1, limit: null, arriving: new Set() });
  function viewFromState() {
    const st = match.state;
    return {
      hands: st.hands.map((h) => h.slice()),
      stock: st.stock.length,
      discard: st.discard.slice(),
      took: new Set(st.log.slice(st.since).flatMap((e) => (e.t === "take" ? [e.slot] : []))),
      // Until the upcard is turned (its face can arrive after the deal has played), it is still on the stock.
      ...(st.limit === null && st.phase === "upcard" ? { discard: [], stock: st.stock.length + 1 } : {}),
      laid: st.laid.map((l) => l && { melds: l.melds.map((x) => x.slice()), deadwood: l.deadwood.slice() }),
      layoffs: st.layoffs.map((x) => x.slice()),
      knock: st.knock && { ...st.knock },
      result: st.result && { ...st.result },
      scores: st.scores.slice(),
      tally: st.laid.map((l) => (l ? l.points : null)),
      dealer: st.dealer,
      limit: st.limit,
      arriving: new Set(),
    };
  }
  const faceOf = (slot) => match?.face(slot) ?? null;
  const known = (slot) => (view.arriving.has(slot) ? null : faceOf(slot));
  const tilt = (slot) => ((slot * 37) % 13) - 6;

  // ---------- whose decision it is ----------
  function decision() {
    if (!match || match.phase !== "playing" || table.pending || ended) return null;
    return { player: match.state.turn, phase: match.state.phase };
  }
  const myDecision = () => {
    const d = decision();
    return d && d.player === me ? d : null;
  };
  // Your real choice now ("upcard", "draw", "discard", "result"), or null.
  function myChoice() {
    const d = myDecision();
    return d && match.canMove() && !forcedMove(match.state, me, faceOf) ? d.phase : null;
  }

  // ---------- your hand, grouped into its melds ----------
  const sortKey = (mode) => (mode === "suit" ? (s) => suitOf(faceOf(s)) * 13 + rankOf(faceOf(s)) : (s) => rankOf(faceOf(s)) * 4 + suitOf(faceOf(s)));
  // Melds first (sorted, or in the order you put them), then the deadwood; cards still in the air last.
  function handGroups() {
    const slots = view.hands[me];
    order = order.filter((s) => slots.includes(s));
    for (const s of slots) if (!order.includes(s)) order.push(s);
    const ready = order.filter((s) => known(s) !== null);
    const a = arrange(ready, faceOf) ?? { melds: [], deadwood: ready, points: 0 };
    const at = (s) => order.indexOf(s);
    const key = sortMode ? sortKey(sortMode) : null;
    const melds = a.melds.slice().sort((x, y) => (key ? key(x[0]) - key(y[0]) : Math.min(...x.map(at)) - Math.min(...y.map(at))));
    const dead = a.deadwood.slice().sort((x, y) => (key ? key(x) - key(y) : at(x) - at(y)));
    const air = order.filter((s) => known(s) === null);
    return { melds, dead: [...dead, ...air], slots: [...melds.flat(), ...dead, ...air], points: a.points };
  }

  function sortBy(mode) {
    sortMode = sortChosen = mode;
    play("deal", { offset: -4 });
    render();
  }

  // You moved a card: a meld moves as a whole among the melds; a deadwood card among the deadwood.
  function moveCard(slot, to, by) {
    const { melds, dead } = shownHand;
    const from = shownHand.slots.indexOf(slot);
    const mi = melds.findIndex((x) => x.includes(slot));
    if (mi >= 0) {
      let target;
      if (by === "key") target = mi + Math.sign(to - from);
      else {
        let n = 0;
        target = 0;
        while (target < melds.length - 1 && n + melds[target].length <= to) n += melds[target++].length;
      }
      target = Math.max(0, Math.min(melds.length - 1, target));
      const list = melds.slice();
      list.splice(target, 0, ...list.splice(mi, 1));
      order = [...list.flat(), ...dead];
    } else {
      const rest = dead.filter((s) => s !== slot);
      rest.splice(Math.max(0, Math.min(rest.length, to - melds.flat().length)), 0, slot);
      order = [...melds.flat(), ...rest];
    }
    sortMode = null;
    render();
  }
  table.onMove((slot, to, by) => moveCard(slot, to, by));

  // A hand laid down as a spread's groups: melds (the knocker's with lay-offs), then deadwood.
  function spreadGroups(p) {
    const l = view.laid[p];
    const knocker = view.knock?.p === p;
    const sortSlots = (slots) => {
      const faces = slots.map(faceOf);
      return faces.some((f) => f === null) ? slots : sortMeld(faces).map((f) => slots[faces.indexOf(f)]);
    };
    const groups = l.melds.map((x, j) => ({ slots: sortSlots([...x, ...(knocker ? view.layoffs.filter(([, k]) => k === j).map(([s]) => s) : [])]), kind: "meld" }));
    if (l.deadwood.length) groups.push({ slots: l.deadwood.slice().sort((a, b) => sortKey("rank")(a) - sortKey("rank")(b)), kind: "dead" });
    return groups;
  }
  const laidOff = (slot) => view.layoffs.some(([s]) => s === slot);

  // ---------- rendering pieces ----------
  function renderHand() {
    const laid = !!view.laid[me];
    if (laid && hand.contains(document.activeElement)) status.focus({ preventScroll: true });
    hand.hidden = laid;
    mySpread.node.hidden = !laid;
    sorts.hidden = laid;
    myCount.textContent = String(view.hands[me].length);
    if (laid) {
      mySpread.render(spreadGroups(me), { face: known, arriving: view.arriving, look: (s) => ({ classes: { layoff: laidOff(s), [`p-${them}`]: laidOff(s) } }) });
      deadChip.hidden = view.tally[me] === null && !deadNum.dataset.counting;
      if (!deadNum.dataset.counting && view.tally[me] !== null) deadNum.textContent = String(view.tally[me]);
      deadChip.classList.remove("low");
      return;
    }
    const g = handGroups();
    shownHand = g;
    const choosing = myChoice() === "discard";
    const taken = match?.state?.taken;
    if (selected !== null && (!choosing || !g.slots.includes(selected) || selected === taken)) selected = null;
    table.renderHand(g.slots, {
      face: known,
      arriving: view.arriving,
      groups: g.melds,
      first: selected ?? undefined,
      look: (slot, face) => {
        const meld = g.melds.find((x) => x.includes(slot));
        const isTaken = choosing && slot === taken;
        const where = !meld ? "deadwood" : isRun(meld.map(faceOf)) ? "in a run" : "in a set";
        return {
          lift: slot === selected,
          classes: { chosen: slot === selected, pickable: choosing && !isTaken, taken: isTaken, inmeld: !!meld },
          label: face === null ? "A card, still being dealt" : `${cardWords(face)}, ${where}${isTaken ? ", just taken from the pile" : ""}${slot === selected ? ", picked: press again to discard" : ""}`,
        };
      },
    });
    // A soft click as a card joins a meld (not during the deal).
    const inMelds = new Set(g.melds.flat());
    // Not while the dealt cards' faces are still arriving: those melds were there all along.
    const dealt = view.hands[me].every((s) => faceOf(s) !== null);
    if (!dealt) meldSeen = null;
    if (meldSeen && current?.type !== "deal" && [...inMelds].some((s) => !meldSeen.has(s)) && performance.now() - lastClick > 250) {
      lastClick = performance.now();
      play("meld");
    }
    if (current?.type !== "deal" && dealt) meldSeen = inMelds;
    deadChip.hidden = !view.hands[me].length;
    // With eleven cards, also what is left after the best throw: brass once that is low enough to knock.
    const after = choosing ? bestKnock(match.state, me, faceOf) : null;
    deadNum.textContent = after ? `${g.points} → ${after.points}` : String(g.points);
    deadChip.classList.toggle("low", !!view.limit && (after?.points ?? g.points) <= view.limit);
    sortRank.setAttribute("aria-pressed", String(sortMode === "rank"));
    sortSuit.setAttribute("aria-pressed", String(sortMode === "suit"));
  }

  function renderSeat() {
    const laid = !!view.laid[them];
    seat.fan.hidden = laid;
    oppSpread.node.hidden = !laid;
    if (laid) oppSpread.render(spreadGroups(them), { face: known, arriving: view.arriving, look: (s) => ({ classes: { layoff: laidOff(s), [`p-${me}`]: laidOff(s) } }) });
    const n = view.hands[them].length;
    // Face up in the fan: only what they took from the pile (a knock shows the rest as it is laid down).
    const shown = (s) => (view.took.has(s) ? known(s) : null);
    const open = view.hands[them].filter((s) => shown(s) !== null);
    seat.render(laid ? [] : view.hands[them], view.arriving, `${theirName}: ${plural(n, "card")}${open.length && !laid ? `, holding ${open.map((s) => cardName(faceOf(s))).join(" ")} from the pile` : ""}`, shown);
    seat.countEl.textContent = String(n);
    oppDealer.hidden = view.dealer !== them;
    myDealer.hidden = view.dealer !== me;
    renderTally(them, oppTally);
  }

  function renderTally(p, node) {
    const t = view.tally[p];
    node.hidden = t === null;
    if (t !== null && !node.dataset.counting) node.textContent = `Deadwood ${t}`;
  }

  function renderCentre() {
    table.renderStock(view.stock);
    const top = view.discard.slice(-3);
    const want = top.map(String);
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
      const face = known(slot);
      setFace(card, face);
      card.classList.toggle("down", face === null);
      card.style.transform = `rotate(${tilt(slot)}deg)`;
      card.style.opacity = view.arriving.has(slot) ? "0" : "";
    }
    const topFace = view.discard.length ? known(view.discard.at(-1)) : null;
    const choice = myChoice();
    const canTake = (choice === "upcard" || choice === "draw") && topFace !== null;
    pile.disabled = !canTake;
    pile.classList.toggle("armed", canTake);
    pile.classList.toggle("empty", !view.discard.length);
    pile.setAttribute("aria-label", topFace === null ? "Discard pile, empty" : `Discard pile: ${cardWords(topFace)} on top${canTake ? ". Take it" : ""}`);
    stockBtn.disabled = choice !== "draw";
    stockBtn.classList.toggle("armed", choice === "draw");
    limitChip.hidden = view.limit === null || !config || !!view.result;
    limitChip.textContent = view.limit === null ? "" : config?.knock === "oklahoma" ? `Knock with ${view.limit} or less this hand` : `Knock with ${view.limit} or less`;
    const over = !!view.result;
    piles.hidden = over;
    scoreCard.hidden = !over;
    const busy = match?.busy && match.phase !== "over" ? match.busy : null;
    table.renderBusy(busy, { starting: match?.phase === "starting", redraw: () => !destroyed && renderCentre() });
  }

  // ---------- motion ----------
  function seatRect(p, slot) {
    if (view.laid[p]) return (p === me ? mySpread : oppSpread).rect(slot);
    if (p === me) {
      const btn = slot !== undefined && handCards.get(slot);
      return btn ? rectIn(btn.firstChild) : rectIn(hand);
    }
    return seat.rect(slot);
  }
  const pileRect = () => rectIn(pile);
  const spreadOf = (p) => (p === me ? mySpread : oppSpread);

  // Moves `slot` from the stock to player p's hand.
  async function dealTo(p, slot, g, ms, sound = "deal") {
    const from = table.stockRect();
    view.stock = Math.max(0, view.stock - 1);
    view.hands[p].push(slot);
    view.arriving.add(slot);
    render();
    if (sound) play(sound);
    const face = p === me ? faceOf(slot) : null;
    await fly(face, from, seatRect(p, slot), { ms, turn: face !== null ? "up" : null, g });
    view.arriving.delete(slot);
    if (live(g)) render();
  }

  // A word over a seat: "Pass", "Ready".
  function say(p, text, g) {
    table.bubble(p === me ? actionBar : seat.node, p, text, g, PACE.bubble);
  }

  // A moment over the table: "Knock!", "Gin!", "Undercut!" in the player's colour.
  function moment(text, p, kind, g) {
    // At once (reduced motion, a hidden tab), the score card and the status line say it.
    if (!live(g) || fast()) return;
    const node = el("div", { class: `gr-moment p-${p} ${kind}`, role: "presentation" }, el("span", {}, text));
    flyLayer.append(node);
    const end = () => node.remove();
    node.animate(
      [
        { transform: "translate(-50%, -50%) scale(.4)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1.08)", opacity: 1, offset: 0.2 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.32 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.8 },
        { transform: "translate(-50%, -60%) scale(.96)", opacity: 0 },
      ],
      { duration: PACE.moment * 1.9, easing: easing("out") },
    ).finished.then(end, end);
  }

  // The felt jumps under a knock: the table nudges down and back.
  function thump(g) {
    if (fast() || !live(g)) return;
    tableBox.animate([{ transform: "translateY(0)" }, { transform: "translateY(3px)", offset: 0.25 }, { transform: "translateY(0)" }], { duration: tokenMs("slow"), easing: easing("out") });
  }

  // Sparkles from a rect, in seat p's colour: gin.
  function sparkle(r, p, g, n = 12) {
    if (fast() || !live(g)) return;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    for (let i = 0; i < n; i++) {
      const node = el("span", { class: `gr-fx spark p-${p}` });
      flyLayer.append(node);
      const a = (i / n) * Math.PI * 2;
      const d = Math.max(r.w, r.h) * 0.5 + 24;
      node
        .animate([{ transform: `translate(${cx}px, ${cy}px) scale(.2)`, opacity: 1 }, { transform: `translate(${cx + Math.cos(a) * d}px, ${cy + Math.sin(a) * d}px) scale(1)`, opacity: 0 }], { duration: tokenMs("slow") * 2.6, easing: easing("out") })
        .finished.then(() => node.remove(), () => node.remove());
    }
  }

  // A number counting up, a tick for each step (it lands at once with reduced motion).
  async function countUp(node, to, g, text) {
    node.dataset.counting = "1";
    const steps = fast() ? 0 : Math.min(Math.abs(to), 24);
    for (let i = 1; i <= steps && live(g); i++) {
      node.textContent = text(Math.round((to * Math.min(1, i / steps)) || 0));
      play("count", { n: i });
      await wait(PACE.count * table.pace(), g);
    }
    delete node.dataset.counting;
    if (!live(g)) return;
    if (!steps && to) play("count");
    node.textContent = text(to);
  }

  // A hand laid down: its cards fly from the hand (or the fan, turning up) into groups on the table.
  async function layDown(p, melds, deadwood, g, k) {
    const all = [...melds.flat(), ...deadwood];
    const from = new Map(all.map((s) => [s, seatRect(p, s)]));
    view.laid[p] = { melds: melds.map((x) => x.slice()), deadwood: deadwood.slice() };
    for (const s of all) view.arriving.add(s);
    render();
    play("draw", { offset: -2 });
    const order = spreadGroups(p).flatMap((x) => x.slots);
    await Promise.all(
      order.map((s, i) =>
        wait(i * 45 * k, g).then(async () => {
          await fly(faceOf(s), from.get(s), spreadOf(p).rect(s), { ms: PACE.lay * k, turn: p === me ? null : "up", g });
          view.arriving.delete(s);
          if (live(g)) render();
        }),
      ),
    );
    if (live(g) && melds.length) play("meld");
  }

  async function animate(ev, g) {
    const k = table.pace();
    current = ev;
    if (ev.type === "deal") {
      view = { ...emptyView(view?.scores), dealer: ev.dealer };
      order = [];
      sortMode = sortChosen;
      meldSeen = null;
      render();
      await table.deal(ev.hands, 1 - ev.dealer, { gap: PACE.deal, ms: PACE.dealFly }, (p, slot, ms, sound) => dealTo(p, slot, g, ms, sound), g);
      current = null;
      meldSeen = null;
      if (!live(g)) return;
      render();
      addLog({ text: `Hand ${ev.hand}: ${nameOf(ev.dealer)} ${verb(ev.dealer, "deals")}` });
    } else if (ev.type === "upcard") {
      const from = table.stockRect();
      if (!view.discard.includes(ev.slot)) {
        view.stock = Math.max(0, view.stock - 1);
        view.discard.push(ev.slot);
      }
      view.arriving.add(ev.slot);
      view.limit = ev.limit;
      render();
      play("play");
      await fly(faceOf(ev.slot), from, pileRect(), { ms: PACE.flip * k, turn: "up", spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      render();
      addLog({ face: faceOf(ev.slot), text: `${cardWords(faceOf(ev.slot)).replace(/^\w/, (c) => c.toUpperCase())} is turned up${config.knock === "oklahoma" ? `: knock with ${ev.limit} or less` : ""}` });
    } else if (ev.type === "take") {
      const from = pileRect();
      view.discard = view.discard.filter((s) => s !== ev.slot);
      view.took.add(ev.slot);
      view.hands[ev.p].push(ev.slot);
      view.arriving.add(ev.slot);
      render();
      play("draw");
      await fly(faceOf(ev.slot), from, seatRect(ev.p, ev.slot), { ms: PACE.take * k, g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      render();
      addLog({ player: ev.p, face: faceOf(ev.slot), text: `${nameOf(ev.p)} took ${cardWords(faceOf(ev.slot))} ${ev.from === "upcard" ? "(the upcard)" : "from the pile"}` });
    } else if (ev.type === "pass") {
      say(ev.p, "Pass", g);
      addLog({ player: ev.p, text: `${nameOf(ev.p)} ${verb(ev.p, "passes")} on the upcard` });
      await wait(PACE.bubble * 0.6 * k, g);
    } else if (ev.type === "draw") {
      await dealTo(ev.p, ev.slot, g, PACE.draw * k, "draw");
      if (!live(g)) return;
      // Your own card is named once its face has arrived (see renderLog).
      addLog({ player: ev.p, slot: ev.p === me ? ev.slot : undefined, face: null, text: `${nameOf(ev.p)} drew from the stock` });
    } else if (ev.type === "discard") {
      const from = seatRect(ev.p, ev.slot);
      const wasDown = ev.p !== me && seat.cards.get(ev.slot)?.classList.contains("down");
      view.hands[ev.p] = view.hands[ev.p].filter((s) => s !== ev.slot);
      view.discard.push(ev.slot);
      view.arriving.add(ev.slot);
      if (ev.p === me) selected = null;
      render();
      play("play");
      await fly(faceOf(ev.slot), from, pileRect(), { ms: PACE.discard * k, turn: wasDown ? "up" : null, spin: tilt(ev.slot), g });
      view.arriving.delete(ev.slot);
      if (!live(g)) return;
      render();
      addLog({ player: ev.p, face: faceOf(ev.slot), text: `${nameOf(ev.p)} ${ev.knock ? "knocked, throwing" : verb(ev.p, "discards")} ${cardWords(faceOf(ev.slot))}` });
    } else if (ev.type === "knock") {
      view.knock = { p: ev.p, gin: ev.gin };
      render();
      play("knock");
      thump(g);
      moment(ev.gin === 2 ? "Big Gin!" : ev.gin ? "Gin!" : "Knock!", ev.p, ev.gin ? "gin" : "knock", g);
      if (ev.gin) {
        play("gin", {}, 0.25);
        sparkle(rectIn(tableBox), ev.p, g, 18);
      }
      if (ev.gin === 2) addLog({ player: ev.p, kind: "gin", text: `${nameOf(ev.p)} ${verb(ev.p, "goes")} out with Big Gin: all eleven cards` });
      else if (ev.gin) addLog({ player: ev.p, kind: "gin", text: `Gin for ${ev.p === me ? "you" : nameOf(ev.p)}!` });
      await wait(PACE.moment * k, g);
    } else if (ev.type === "lay") {
      await layDown(ev.p, ev.melds, ev.deadwood, g, k);
      if (!live(g)) return;
      addLog({ player: ev.p, faces: ev.melds.flat().map(faceOf), text: `${nameOf(ev.p)} laid down ${meldWords(ev.melds)}, ${ev.points} deadwood` });
      await countUp(ev.p === me ? deadNum : oppTally, ev.points, g, (n) => (ev.p === me ? String(n) : `Deadwood ${n}`));
      view.tally[ev.p] = ev.points;
      render();
    } else if (ev.type === "defend") {
      const knocker = view.knock.p;
      const off = ev.layoffs.map(([s]) => s);
      await layDown(ev.p, ev.melds, [...ev.deadwood, ...off], g, k);
      if (!live(g)) return;
      if (ev.melds.length) addLog({ player: ev.p, faces: ev.melds.flat().map(faceOf), text: `${nameOf(ev.p)} laid down ${meldWords(ev.melds)}` });
      for (const [i, [s, j]] of ev.layoffs.entries()) {
        await wait(PACE.between * k, g);
        const from = spreadOf(ev.p).rect(s);
        view.laid[ev.p].deadwood = view.laid[ev.p].deadwood.filter((x) => x !== s);
        view.layoffs.push([s, j]);
        view.arriving.add(s);
        render();
        play("layoff", { n: i });
        await fly(faceOf(s), from, spreadOf(knocker).rect(s), { ms: PACE.layoff * k, g });
        view.arriving.delete(s);
        if (!live(g)) return;
        render();
      }
      if (off.length) addLog({ player: ev.p, faces: off.map(faceOf), text: `${nameOf(ev.p)} laid off ${plural(off.length, "card")}` });
      await countUp(ev.p === me ? deadNum : oppTally, ev.points, g, (n) => (ev.p === me ? String(n) : `Deadwood ${n}`));
      view.tally[ev.p] = ev.points;
      render();
    } else if (ev.type === "score") {
      await showScore(ev, g, k);
    } else if (ev.type === "ready") {
      if (ev.p !== me) {
        say(ev.p, "Ready", g);
        play("ready");
      }
      addLog({ player: ev.p, text: `${nameOf(ev.p)} ${ev.p === me ? "are" : "is"} ready for the next hand` });
    } else if (ev.type === "gather") {
      await gather(g, k);
    }
    current = null;
    await wait(PACE.between * k, g);
  }

  // "7♥ 8♥ 9♥ and K♠ K♦ K♣", for the log.
  const meldWords = (melds) => {
    const words = melds.map((x) => x.map((s) => cardName(faceOf(s))).join(" "));
    return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  };

  // The end of a hand: what it was, the deadwood against each other, and the points into the score.
  async function showScore(ev, g, k) {
    view.result = { ...ev };
    scoreCard.className = `gr-score ${ev.kind} ${ev.winner >= 0 ? `p-${ev.winner}` : ""}`;
    scoreTitle.textContent = ev.kind === "knock" ? `${nameOf(view.knock.p)} ${verb(view.knock.p, "knocks")}` : ev.kind === "draw" ? "A drawn hand" : KIND[ev.kind];
    scoreSum.textContent = scoreLine(ev);
    scorePoints.textContent = "";
    scoreTotals.textContent = "";
    render();
    if (ev.kind === "undercut") {
      play("undercut");
      moment("Undercut!", ev.winner, "undercut", g);
      const knockerSpread = spreadOf(view.knock.p).node;
      if (!fast()) knockerSpread.animate([{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }], { duration: tokenMs("slow") * 1.6, easing: easing("out") });
    } else if (ev.kind === "draw") play("nope");
    if (!scoreCard.hidden && !fast()) scoreCard.animate([{ transform: "scale(.85)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: tokenMs("slow"), easing: easing("spring") });
    if (ev.winner >= 0) {
      await countUp(scorePoints, ev.points, g, (n) => `+${n} for ${ev.winner === me ? "you" : nameOf(ev.winner)}`);
      if (!live(g)) return;
    } else scorePoints.textContent = "No points";
    view.scores = ev.scores.slice();
    scoreTotals.textContent = totalsLine(ev.scores);
    render();
    addLog({ player: ev.winner >= 0 ? ev.winner : undefined, kind: ev.kind, text: ev.winner >= 0 ? `${KIND[ev.kind].replace("!", "")}: ${plural(ev.points, "point")} for ${ev.winner === me ? "you" : nameOf(ev.winner)}` : "Two cards left and no knock: the hand is a draw" });
    await wait(PACE.bubble * k, g);
  }

  // "Bo 6 against your 23" and the like.
  function scoreLine(ev) {
    if (ev.kind === "draw") return "Only two cards left in the stock and nobody knocked.";
    const kn = view.knock.p;
    const df = 1 - kn;
    const t = view.tally;
    const dk = t[kn] ?? 0;
    const dd = t[df] ?? 0;
    const whose = (p, n) => (p === me ? `your ${n}` : `${nameOf(p)}'s ${n}`);
    if (ev.kind === "gin" || ev.kind === "big") return `${ev.kind === "big" ? BIG_GIN_BONUS : GIN_BONUS} for gin + ${whose(df, dd)} deadwood`;
    if (ev.kind === "undercut") return `${whose(df, dd)} against ${whose(kn, dk)}: the difference + ${UNDERCUT_BONUS}`;
    return `${whose(df, dd).replace(/^\w/, (c) => c.toUpperCase())} against ${whose(kn, dk)}`;
  }

  function totalsLine(scores) {
    const mine = carried[me] + scores[me];
    const theirs = carried[them] + scores[them];
    return `You ${mine} · ${theirName} ${theirs}${config.target ? ` · to ${config.target}` : ""}`;
  }

  // The cards go back to the stock for the next shuffle: a few fly, face down, from the pile and both hands.
  async function gather(g, k) {
    play("gather");
    const target = table.stockRect();
    const from = [...view.discard.slice(-2).map(() => pileRect()), ...seats.flatMap((p) => view.hands[p].slice(0, 5).map((s) => seatRect(p, s)))];
    await Promise.all(from.map((r, i) => wait(i * 25 * k, g).then(() => fly(null, r, target, { ms: PACE.gather * k, g }))));
    if (!live(g)) return;
    oppSpread.clear();
    mySpread.clear();
    view = { ...emptyView(view.scores), dealer: view.dealer };
    render();
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
  const logLine = (e) => [e.faces ? el("span", { class: "gr-minis" }, e.faces.map((f) => miniCard(f))) : e.face !== undefined ? miniCard(e.face) : null, el("span", {}, e.text)];
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
      e.text = `You drew ${cardWords(e.face)}`;
      e.node.replaceChildren(...logLine(e));
    }
  }

  // ---------- your moves ----------
  table.onPick((slot) => {
    if (myChoice() !== "discard") return;
    if (slot === match.state.taken) {
      play("nope");
      return toast("You can't throw back the card you just took from the pile");
    }
    if (selected === slot) return discardNow(slot);
    selected = slot;
    play("deal", { offset: -4 });
    render();
  });

  function discardNow(slot) {
    if (myChoice() !== "discard") return;
    selected = null;
    match.play({ discard: slot });
  }

  // The knock you can make now: { slot, points, big }, the picked card if it knocks too; null if you can't.
  function knockable() {
    const st = match.state;
    const hand = st.hands[me];
    if (st.bigGin && hand.every((s) => faceOf(s) !== null) && !bestMelds(hand.map(faceOf)).points) return { big: true, points: 0, slot: null };
    const k = bestKnock(st, me, faceOf);
    if (!k || k.points > st.limit) return null;
    // The picked card, if throwing it leaves as little as the best throw.
    if (selected !== null && selected !== st.taken && arrange(hand.filter((s) => s !== selected), faceOf).points === k.points) return { slot: selected, points: k.points };
    return { slot: k.discard, points: k.points };
  }

  function knockNow() {
    if (myChoice() !== "discard") return;
    const kn = knockable();
    if (!kn) {
      play("nope");
      return toast(`You need ${match.state.limit} points of deadwood or less to knock`);
    }
    selected = null;
    match.play(kn.big ? { knock: true } : { discard: kn.slot, knock: true });
  }

  function drawFrom(which) {
    if (myChoice() === "draw") match.play({ draw: which });
  }

  function takePile() {
    const c = myChoice();
    if (c === "upcard") match.play({ take: true });
    else if (c === "draw") match.play({ draw: "pile" });
  }

  function pass() {
    if (myChoice() === "upcard") match.play({ pass: true });
  }

  function nextHand() {
    if (myChoice() === "result") return match.play({ next: true });
    const st = match?.state;
    // Not again once you have said it: the wish belongs to this hand's score.
    if (match?.phase === "playing" && st.phase === "result" && !(st.ready === 1 && st.turn !== me)) {
      wantNext = st.hand;
      render();
    }
  }

  // D draws, T takes the pile, P passes, K knocks, N starts the next hand; Escape drops the picked card.
  function onKey(e) {
    if (e.target.closest?.("input, textarea") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const key = e.key.toLowerCase();
    if (e.key === "Escape" && selected !== null) {
      selected = null;
      render();
    } else if (key === "d") drawFrom("stock");
    else if (key === "t") takePile();
    else if (key === "p") pass();
    else if (key === "k") knockNow();
    else if (key === "n") nextHand();
  }
  addEventListener("keydown", onKey);

  // ---------- render ----------
  function describe(ev) {
    if (!ev) return null;
    if (ev.type === "deal") return `Dealing hand ${ev.hand}…`;
    if (ev.type === "upcard") return "The upcard is turned…";
    if (ev.type === "take") return `${nameOf(ev.p)} ${verb(ev.p, "takes")} ${cardName(faceOf(ev.slot))}${ev.from === "upcard" ? "" : " from the pile"}.`;
    if (ev.type === "draw") return `${nameOf(ev.p)} ${verb(ev.p, "draws")} from the stock…`;
    if (ev.type === "discard") return ev.knock ? `${nameOf(ev.p)} ${verb(ev.p, "knocks")}!` : `${nameOf(ev.p)} ${verb(ev.p, "discards")} ${cardName(faceOf(ev.slot))}.`;
    if (ev.type === "knock") return ev.gin ? `${ev.gin === 2 ? "Big Gin" : "Gin"} for ${ev.p === me ? "you" : nameOf(ev.p)}!` : `${nameOf(ev.p)} ${verb(ev.p, "knocks")}!`;
    if (ev.type === "lay") return `${nameOf(ev.p)} ${verb(ev.p, "lays")} down ${plural(ev.melds.length, "meld")}…`;
    if (ev.type === "defend") return ev.layoffs.length ? `${nameOf(ev.p)} ${verb(ev.p, "lays")} down and ${verb(ev.p, "lays")} off ${plural(ev.layoffs.length, "card")}…` : `${nameOf(ev.p)} ${verb(ev.p, "lays")} down…`;
    if (ev.type === "gather") return "Shuffling for the next hand…";
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
    const top = st.discard.length ? faceOf(st.discard.at(-1)) : null;
    const topName = top === null ? "upcard" : cardName(top);
    const choice = myChoice();
    if (d.phase === "result") {
      const r = st.result;
      const head = r.winner >= 0 ? `Hand ${st.hand}: ${plural(r.points, "point")} for ${r.winner === me ? "you" : nameOf(r.winner)}.` : `Hand ${st.hand} is a draw.`;
      if (choice) return `${head} Next hand when you're ready.`;
      return wantNext === st.hand || d.player !== me ? `${head} Waiting for ${theirName}…` : head;
    }
    if (d.player !== me) {
      if (d.phase === "upcard") return `${theirName} ${st.passes ? "may take" : "is offered"} the ${topName}…`;
      if (d.phase === "lay" || d.phase === "defend") return `${theirName} ${d.phase === "lay" ? "lays down" : "lays down and lays off"}…`;
      return `${theirName}'s turn…`;
    }
    if (match.busy) return DECK_WORK[match.busy][0];
    if (!choice) return d.phase === "lay" ? "Laying down your melds…" : d.phase === "defend" ? "Laying down your hand and laying off…" : "…";
    if (choice === "upcard") return `Your turn: take the ${topName}, or pass.`;
    if (choice === "draw") return `Your turn: draw from the stock${top !== null ? ` or take the ${cardName(top)}` : ""}.`;
    const kn = knockable();
    if (kn?.big) return "Big Gin! Every card is in a meld.";
    if (kn) return kn.points ? `Discard a card, or knock with ${kn.points}.` : "Gin! Discard a card, or go out.";
    return "Discard a card: tap it twice.";
  }

  function overLine(st) {
    const w = st.winner;
    if (w === 2) return "A drawn hand: no points.";
    const t = st.final.totals;
    if (!config.target) return `${w === me ? "You win" : `${nameOf(w)} wins`} the hand: ${plural(t[w], "point")}.`;
    return `${w === me ? "You win" : `${nameOf(w)} wins`} the game, ${t[w]} to ${t[1 - w]}.`;
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
      bar.update({
        turn: phase === "playing" && shownTurn !== undefined ? shownTurn : -1,
        notes: seats.map((p) => (st ? plural(view.hands[p].length, "card") : "")),
        score: { wins: seats.map((p) => carried[p] + view.scores[p]) },
      });
    }
    seat.node.classList.toggle("active", shownTurn === them && phase === "playing");
    meArea.classList.toggle("active", shownTurn === me && phase === "playing");
    tableBox.classList.toggle("laid", !!view?.laid.some(Boolean));
    status.textContent = statusText();
    const mine = myDecision();
    status.className = `${table.cls("status")} ${d ? `p-${d.player}` : ""} ${mine ? "mine" : ""}`;
    if (view) {
      renderSeat();
      renderCentre();
      renderHand();
    }
    renderActions();
    renderLog();
    renderTimer();
    renderResult();
    const choice = myChoice();
    setTabAlert(choice && choice !== "result" ? "Your turn" : null);
    if (choice === "upcard" || choice === "draw") {
      const key = `${m}:${st.moves}`;
      if (cuedTurn !== key) {
        cuedTurn = key;
        play("turn");
      }
    }
    if (choice === "result" && wantNext === st.hand) {
      wantNext = 0;
      setTimeout(() => myChoice() === "result" && match.play({ next: true }), 0);
    }
    autoMove();
  }

  function renderActions() {
    const choice = myChoice();
    const st = match?.state;
    const top = st?.discard.length ? faceOf(st.discard.at(-1)) : null;
    const hadFocus = actionBar.contains(document.activeElement) ? document.activeElement : null;
    takeBtn.hidden = !(choice === "upcard" || (choice === "draw" && top !== null));
    takeBtn.textContent = top === null ? "Take" : `Take the ${cardName(top)}`;
    passBtn.hidden = choice !== "upcard";
    drawBtn.hidden = choice !== "draw";
    discardBtn.hidden = choice !== "discard";
    discardBtn.disabled = selected === null;
    discardBtn.textContent = selected === null ? "Pick a card to discard" : `Discard the ${cardName(faceOf(selected))}`;
    const kn = choice === "discard" ? knockable() : null;
    knockBtn.hidden = !kn;
    if (kn) {
      knockLabel.textContent = kn.big ? "Big Gin" : kn.points ? "Knock" : "Gin";
      knockNote.textContent = kn.big ? "all eleven" : `throw ${cardName(faceOf(kn.slot))}${kn.points ? `, ${kn.points} left` : ""}`;
      knockBtn.classList.toggle("gin", !kn.points);
    }
    // The next hand: your turn to say so, or say it early and it goes when your turn comes.
    const inResult = match?.phase === "playing" && st.phase === "result" && !table.pending;
    const done = inResult && st.ready === 1 && st.turn !== me;
    nextBtn.hidden = !inResult;
    const wished = inResult && wantNext === st.hand;
    nextBtn.disabled = done || (wished && choice !== "result");
    nextBtn.textContent = done || wished ? `Waiting for ${theirName}…` : "Next hand";
    // A button you used hides: keep focus on the table's status rather than losing it to the page.
    if (hadFocus?.hidden || hadFocus?.disabled) status.focus({ preventScroll: true });
    tableBox.classList.toggle("my-turn", !!choice && choice !== "result");
    handHint.textContent = choice === "discard" ? (selected === null ? "Tap a card twice to discard it · drag to rearrange" : `Tap the ${cardName(faceOf(selected))} again to discard it`) : view?.laid[me] ? "" : view?.hands[me].length ? "Drag a card to rearrange your hand" : "";
    if (!match || match.phase !== "playing") hint.textContent = "";
    else hint.textContent = `Melds are sets of a rank and runs in a suit. Knock with ${view.limit ?? (config.knock === "oklahoma" ? "the upcard's points" : 10)} or less of deadwood; none is gin. Keys: D draw, T take, P pass, K knock, N next hand; Shift + arrows move a card.`;
    hint.parentNode.hidden = !hint.textContent;
  }

  // Laying down and the defence: made for you, the best way, after a short beat.
  function autoMove() {
    const d = myDecision();
    if (!d || !match.canMove()) return;
    const move = forcedMove(match.state, me, faceOf);
    if (!move) return;
    const key = `${m}:${match.state.moves}`;
    if (autoKey === key) return;
    autoKey = key;
    const ms = fast() ? 0 : d.phase === "lay" ? AUTO.lay : AUTO.defend;
    const g = table.gen;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (live(g) && myDecision() && match.canMove() && `${m}:${match.state.moves}` === key) match.play(forcedMove(match.state, me, faceOf));
    }, ms);
  }

  const timed = (phase) => ["upcard", "draw", "discard", "result"].includes(phase);
  function renderTimer() {
    const secs = config?.moveSeconds || 0;
    const d = decision();
    // The clock starts once the move can be made: not while the deck is still shuffling or dealing.
    const ready = !!d && !match.busy && match.state.limit !== null;
    const key = `${m}:${match?.state?.moves}:${ready}`;
    timer.hidden = !secs || !ready || !timed(d.phase) || (d.phase === "result" && d.player !== me);
    if (timer.hidden) return;
    if (key !== deadlineKey) {
      deadlineKey = key;
      deadline = performance.now() + secs * 1000;
    }
    const left = deadline - performance.now();
    timerFill.style.transform = `scaleX(${Math.max(0, Math.min(1, left / (secs * 1000))).toFixed(3)})`;
    timer.className = `gr-timer p-${d.player} ${left < 5000 ? "low" : ""}`;
    timerText.textContent = left > -1000 ? `${Math.max(0, Math.ceil(left / 1000))} s` : "";
    if (d.player === me && left <= 3000 && left > 0) {
      const sec = Math.ceil(left / 1000);
      if (sec !== lastTick) {
        lastTick = sec;
        play("tick");
      }
    }
  }

  // Your time ran out: a sensible move is made for you (a stalled player would hold up the game).
  function tick() {
    if (destroyed || !match || match.phase !== "playing" || !config?.moveSeconds) return;
    renderTimer();
    const d = decision();
    if (!d || !timed(d.phase)) return;
    const left = deadline - performance.now();
    if (d.player === me && !timer.hidden && left <= 0 && timedOut !== deadlineKey && myChoice()) {
      timedOut = deadlineKey;
      selected = null;
      const move = timeoutMove(match.state, me, faceOf);
      toast(`Time's up: ${move.next ? "on to the next hand" : move.take ? "took the upcard" : move.pass ? "passed" : move.draw ? `drew from the ${move.draw === "pile" ? "pile" : "stock"}` : move.knock ? "knocked" : `discarded the ${cardName(faceOf(move.discard))}`} for you`);
      match.play(move);
    } else if (d.player !== me && d.phase !== "result" && !timer.hidden && left <= -CLAIM_GRACE_MS) {
      status.textContent = `Waiting for ${theirName}'s browser…`;
    }
  }
  const ticker = setInterval(tick, 200);

  // ---------- the end ----------
  // The winner's melds on the table, in the order they light up.
  function winnerCards() {
    const st = match?.state;
    if (!st || match.phase !== "over" || st.winner > 1) return [];
    const spread = spreadOf(st.winner);
    const groups = view.laid[st.winner] ? spreadGroups(st.winner).filter((x) => x.kind === "meld") : [];
    return groups.flatMap((x) => x.slots.map((s) => spread.cards.get(s))).filter(Boolean);
  }

  const verdictText = (v) => verdictOf(v, nameOf);
  function verdictLine() {
    if (match.verdict?.ok) return el("p", { class: "verdict ok", id: "gr-verdict" }, el("span", {}, "✓ Fair play verified"), el("small", {}, "Every shuffle proved, and every hand replayed with every card shown."));
    if (match.verdict) return el("p", { class: "verdict bad", id: "gr-verdict" }, `⚠ ${verdictText(match.verdict)}`);
    return el("p", { class: "verdict", id: "gr-verdict" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Checking every shuffle and replaying the game…");
  }

  // The game's points, the bonuses and the totals, a row each.
  function standings(st) {
    const f = st.final;
    const order = [st.winner === 2 ? me : st.winner, st.winner === 2 ? them : 1 - st.winner];
    const head = el("tr", {}, el("th", {}, el("span", { class: "sr-only" }, "Player")), el("th", {}, "Points"), ...(f.game ? [el("th", {}, "Hands"), el("th", {}, "Game")] : []), el("th", {}, "Total"));
    const rows = order.map((p) =>
      el(
        "tr",
        { class: `p-${p} ${p === me ? "mine" : ""}` },
        el("th", { scope: "row" }, el("span", { class: "who" }, el("span", { class: "dot", "aria-hidden": "true" }), el("span", {}, p === me ? "You" : theirName))),
        el("td", { class: "mono" }, String(st.scores[p])),
        ...(f.game ? [el("td", { class: "mono" }, `${st.wins[p]} × ${f.line}`), el("td", { class: "mono" }, p === st.winner ? `+${f.game}` : "–")] : []),
        el("td", { class: "mono total" }, String(f.totals[p])),
      ),
    );
    return el("table", { class: "gr-standings", id: "gr-standings" }, el("thead", {}, head), el("tbody", {}, rows));
  }

  let shownFor = null;
  let extra = null;
  function renderResult() {
    const phase = match?.phase;
    // Let the last hand land first.
    if (ended || (phase !== "over" && phase !== "aborted") || (phase === "over" && table.pending)) {
      result.hide();
      shownFor = null;
      return;
    }
    if (phase === "aborted") return result.show({ stopped: true, reason: abortText({ reason: match.abortReason, seat: match.abortSeat, about: match.abortAbout }, nameOf) });
    const st = match.state;
    const w = st.winner;
    const t = st.final.totals;
    const r = st.result;
    let reason;
    if (w === 2) reason = "Only two cards were left in the stock and nobody knocked.";
    else if (!config.target) reason = `${KIND[r.kind] === "Knock" ? `${nameOf(st.knock.p)} knocked` : KIND[r.kind].replace("!", "")}: ${plural(r.points, "point")} for ${w === me ? "you" : nameOf(w)}.`;
    else reason = `${w === me ? "You" : nameOf(w)} reached ${config.target} first, after ${plural(st.history.length, "hand")}: ${t[w]} to ${t[1 - w]} with the bonuses.`;
    const key = `${m}:${!!match.verdict}`;
    if (shownFor !== key) {
      shownFor = key;
      extra = el("div", { class: "gr-over pc-game" }, standings(st), verdictLine());
    }
    result.show({ winner: w === 2 ? -1 : w, reason, extra });
  }

  // ---------- match lifecycle ----------
  function newMatch() {
    // One hand a game: the scores add up across rematches. To 100: count the games won.
    if (match?.phase === "over") {
      if (!config.target) carried = carried.map((c, p) => c + match.state.scores[p]);
      else if (match.state.winner < 2) gamesWon[match.state.winner]++;
    }
    m += 1;
    table.reset();
    oppSpread.clear();
    mySpread.clear();
    clearTimeout(autoTimer);
    current = null;
    view = emptyView();
    log = [];
    cuedTurn = "";
    autoKey = "";
    deadlineKey = "";
    timedOut = "";
    selected = null;
    order = [];
    wantNext = 0;
    meldSeen = null;
    shownFor = null;
    lastVerdict = "";
    logList.replaceChildren();
    games = config.target && gamesWon.some(Boolean) ? ` Games won: you ${gamesWon[me]}, ${theirName} ${gamesWon[them]}.` : "";
    note.textContent = m === 1 ? `Playing ${theirName}. Good luck!` : `Rematch #${m - 1}: a fresh deck, shuffled by both browsers.${games}`;
    const mt = new CardMatch({ send: (msg) => session.send(msg), me, players: 2, rules, m });
    previous = match;
    match = mt;
    window.ddp.match = mt; // browser tests read this
    let dealt = false;
    const firstDeal = () => {
      if (dealt || !mt.state) return;
      dealt = true;
      enqueue({ type: "deal", hand: 1, dealer: mt.state.first, hands: mt.state.hands.map((h) => h.slice()) });
    };
    mt.on("update", () => {
      if (mt !== match) return;
      firstDeal();
      render();
    });
    mt.on("invalid", (reason) => {
      if (mt !== match) return;
      play("nope");
      toast(reason);
    });
    mt.on("start", () => {
      if (mt !== match) return;
      const dealer = mt.state.first;
      const who = dealer === me ? "you deal first" : `${theirName} deals first`;
      const again = m > 1 ? `Rematch #${m - 1}. ` : "";
      note.textContent = again + (config.dealer === "random" ? `Coin toss (drawn by both browsers): ${who}.` : `Room setting: ${who}.`) + games + (lastVerdict && ` ${lastVerdict}.`);
    });
    mt.on("events", ({ events }) => {
      if (mt !== match) return;
      firstDeal();
      for (const ev of events) enqueue(ev);
    });
    // A rematch can start before this verdict arrives; keep listening to the old match.
    mt.on("verified", (verdict) => {
      if (mt === match) return render();
      const text = verdict.ok ? "Last game: fair play verified" : `Last game didn't check out: ${verdictText(verdict)}`;
      lastVerdict = text.replace(/\.$/, "");
      note.textContent = text;
      toast(text);
    });
    router.start(mt);
    render();
  }

  function describeConfig(c) {
    const parts = [c.target ? `Game to ${c.target}` : "One hand a game", c.knock === "oklahoma" ? "Oklahoma: the upcard sets the knock limit" : "knock with 10 or less"];
    if (c.bigGin) parts.push("Big Gin on");
    if (c.moveSeconds) parts.push(`${c.moveSeconds} s a move`);
    if (robotGame) parts.push(`${LEVEL_NAME[c.level]} robot`);
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
  function onEnd(reason, seatLeft) {
    if (reason === "self") return;
    ended = true;
    table.stop();
    clearTimeout(autoTimer);
    table.shuffling(false);
    // Just after a rematch started, the game to report on is the one before.
    const judged = match?.phase === "starting" && previous ? previous : match;
    leaveNotice({ root, session, seat: seatLeft, match: judged, prefix: "gr", game: "Gin Rummy", nameOf, facts: (st, p) => `${plural(carried[p] + st.scores[p], "point")}` });
    render();
  }

  screenBusy = () => table.pending > 0;
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
