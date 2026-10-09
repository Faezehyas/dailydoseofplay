// The player bar every game shows above its board: a pill per player (you
// first, then the others in seat order) with an optional badge and note, a
// ring on whoever's turn it is, the wins so far (and draws, for games that
// have them), and Leave, always at the top right. Colours come from --seat
// and --seat-text: .mine and .theirs by default, or a game's own class per
// seat (see "player bar" in theme.css).
import { el } from "./shell.js";

export function playerBar(session, { onLeave, classes = () => "" }) {
  const me = session.index;
  const order = [me, ...session.others.map((p) => p.seat)];
  const cls = (seat) => `${seat === me ? "mine" : "theirs"} ${classes(seat)}`;
  const label = (seat) => (seat === me ? "You" : session.players[seat].name);

  const pills = order.map((seat) => {
    const name = seat === me && session.me.name !== "You" ? `${session.me.name} (you)` : label(seat);
    const badge = el("span", { class: "pb-badge" });
    const note = el("small", { class: "pb-note" });
    const node = el("span", { class: `pb-who ${cls(seat)}` }, badge, el("span", { class: "pb-label" }, el("span", { class: "pb-name", title: name }, name), note));
    return { seat, node, badge, note };
  });
  const box = (c, text) => {
    const dd = el("dd");
    return { node: el("div", { class: c }, el("dt", { title: text }, text), dd), dd };
  };
  const wins = order.map((seat) => box(cls(seat), label(seat)));
  const draws = box("draws", "Draws");
  const duel = order.length === 2;
  const players = el("div", { class: "pb-players" }, duel ? [pills[0].node, el("span", { class: "pb-vs" }, "vs"), pills[1].node] : pills.map((p) => p.node));
  const leave = el("button", { class: "btn ghost small", type: "button", id: "leave", onclick: onLeave }, "Leave");
  const scoreBox = el("dl", { class: "pb-score", id: "score", "aria-label": "Score" }, wins.map((w) => w.node));
  const node = el("div", { class: `player-bar ${duel ? "" : "many"}` }, el("div", { class: "pb-top" }, players, leave), scoreBox);

  // A slot shows a node of the game's (kept as is when it is already there) or text.
  const put = (slot, v) => {
    if (v instanceof Node ? slot.firstChild !== v : slot.textContent !== String(v ?? "")) slot.replaceChildren(v ?? "");
  };

  // Every field is optional and indexed by seat: turn (-1 for nobody),
  // score { wins: [...], draws } (no draws field, no Draws box), badges and notes.
  function update({ turn, score, badges, notes }) {
    for (const p of pills) {
      if (turn !== undefined) p.node.classList.toggle("active", p.seat === turn);
      if (badges) put(p.badge, badges[p.seat]);
      if (notes) put(p.note, notes[p.seat]);
    }
    if (!score) return;
    for (const [k, seat] of order.entries()) put(wins[k].dd, score.wins[seat]);
    if (typeof score.draws !== "number") return draws.node.remove();
    if (!draws.node.isConnected) wins[0].node.after(draws.node);
    put(draws.dd, score.draws);
  }

  return { node, update };
}
