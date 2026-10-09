// The game-over panel every game shows, pinned to the bottom of the screen so
// the board never moves: who won, the places when a game plays on for them, a
// reason line, an optional node of the game's, Rematch with everyone's votes,
// and Leave. A chevron folds it down to its title, to see the whole board.
import { el, toast } from "./shell.js";

const PLACE = ["1st", "2nd", "3rd", "4th"];
const listOf = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function resultPanel(session, { onLeave, onShow = () => {}, classes = () => "" }) {
  const me = session.index;
  const name = (seat) => session.players[seat].name;
  let votes = { me: false, them: false, seats: [] };
  let folded = false;

  const title = el("h2", { id: "result", tabindex: "-1" });
  const toggle = el("button", { class: "result-toggle", type: "button", id: "result-toggle", "aria-label": "Result details", "aria-controls": "result-body", onclick: () => fold(!folded) });
  const places = el("ol", { class: "result-places", id: "result-places" });
  const reason = el("p", { class: "result-reason", id: "result-reason" });
  const extra = el("div", { class: "result-extra" });
  const rematch = el("button", { class: "btn primary", type: "button", id: "rematch", onclick: () => session.requestRematch() });
  const status = el("p", { class: "rematch-status", id: "rematch-status" });
  const leave = el("button", { class: "btn", type: "button", onclick: onLeave }, "Leave");
  const body = el("div", { class: "result-body", id: "result-body" }, places, reason, extra, el("div", { class: "result-actions" }, rematch, leave), status);
  const node = el("section", { class: "result-panel", id: "result-panel", "aria-labelledby": "result", hidden: true }, el("div", { class: "result-head" }, title, toggle), body);
  // The page keeps room below the game for the panel (see theme.css).
  new ResizeObserver(() => document.body.style.setProperty("--result-h", `${node.offsetHeight}px`)).observe(node);

  function fold(on) {
    folded = on;
    body.hidden = on;
    toggle.title = on ? "Show the result" : "Show the board";
    toggle.setAttribute("aria-expanded", String(!on));
  }

  function renderVotes() {
    rematch.disabled = votes.me;
    rematch.textContent = votes.them && !votes.me ? "Accept rematch" : "Rematch";
    const missing = session.players.filter((p) => !votes.seats.includes(p.seat));
    const voters = votes.seats.filter((s) => s !== me).map(name);
    if (votes.me) status.textContent = `Waiting for ${missing.length === 1 ? missing[0].name : `${missing.length} players`}…`;
    else status.textContent = votes.them ? `${listOf(voters)} ${voters.length === 1 ? "wants" : "want"} a rematch!` : "";
  }

  session.on("rematch", (v) => {
    votes = v;
    renderVotes();
    if (v.them && !v.me) toast(status.textContent.replace("!", ""));
  });
  session.on("rematch-start", () => {
    votes = { me: false, them: false, seats: [] };
    renderVotes();
  });
  renderVotes();

  // winner: a seat, or -1 for a draw; stopped: the match was cut short (reason
  // says why); places: [{ seat, note }] in finishing order; extra: a node.
  // Call it again whenever something changes; it opens once.
  function show({ winner = -1, stopped = false, reason: why = "", places: order = [], extra: more = null }) {
    const many = session.players.length > 2;
    title.textContent = stopped ? "Match stopped" : winner === -1 ? "Draw" : winner === me ? "You won" : many ? `${name(winner)} won` : "You lost";
    title.className = !stopped && winner === me ? "win" : "";
    places.replaceChildren(
      ...order.map(({ seat, note }, i) =>
        el(
          "li",
          { class: `${seat === me ? "mine" : "theirs"} ${classes(seat)}` },
          el("span", { class: "place" }, PLACE[i]),
          el("span", { class: "who" }, seat === me ? "You" : name(seat)),
          note && el("small", {}, note),
        ),
      ),
    );
    places.hidden = !order.length;
    reason.textContent = why;
    reason.classList.toggle("bad", stopped);
    if (extra.firstChild !== more) extra.replaceChildren(more ?? "");
    if (!node.hidden) return;
    node.hidden = false;
    fold(false);
    title.focus({ preventScroll: true });
    onShow({ winner, stopped });
  }

  function hide() {
    node.hidden = true;
  }

  return { node, show, hide };
}
