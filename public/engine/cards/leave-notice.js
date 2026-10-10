// What a card game adds to the lobby's "Game ended" notice when a player
// leaves (see "Leaving" in ARCHITECTURE.md): every card needs every player's
// key, so the game is over for everyone, and whether it got checked: verified
// before they left, left during the audit so it couldn't be verified, or
// stopped before the end. With three or more players it lists each player.
// It also words a failed verdict and a stopped match, the same in every card game.
import { el } from "../shell.js";

// A failed verdict in words: "Bo broke the rules: kept a book of 7s in hand."
export const verdictText = (v, nameOf) => `${v.seat === undefined ? "" : `${nameOf(v.seat)} `}${v.reason}.`;

// Why a match stopped: "<seat> <reason>", naming `about` when set (see card-match.js's abort).
export function abortText({ reason, seat, about }, nameOf) {
  const prefix = "stopped the match: ";
  const text = about !== undefined && reason.startsWith(prefix) ? `${prefix}${nameOf(about)} ${reason.slice(prefix.length)}` : reason;
  if (seat === undefined) return text.charAt(0).toUpperCase() + text.slice(1);
  return `${nameOf(seat)} ${text}`;
}

// match: the one to report on (the one before, if a rematch had only just started); facts(state, p): a player's line.
export function leaveNotice({ root, session, seat, match, prefix, game, nameOf, facts }) {
  const count = session.players.length;
  const phase = match?.phase;
  const verdict = match?.verdict;
  const st = match?.state;
  queueMicrotask(() => {
    const card = root.querySelector("#ended .card");
    if (!card) return;
    const gone = session.players[seat]?.name ?? "A player";
    let check;
    if (verdict?.ok) check = el("p", { class: "verdict ok" }, "✓ The last game was verified as fair before they left.");
    else if (verdict) check = el("p", { class: "verdict" }, `The last game didn't check out: ${verdictText(verdict, nameOf)}`);
    else if (phase === "over") check = el("p", { class: "verdict" }, `${gone} left before the audit finished, so this game couldn't be verified.`);
    else check = el("p", { class: "verdict" }, "The game stopped before the end, so it wasn't checked.");
    const rows =
      st && count > 2
        ? el(
            "ul",
            {},
            session.players.map(({ seat: p }) => el("li", { class: `p-${p} ${p === seat ? "gone" : ""}` }, el("span", { class: "dot", "aria-hidden": "true" }), `${nameOf(p)}: ${facts(st, p)}${p === seat ? " (left)" : ""}`)),
          )
        : null;
    card.querySelector(".notice")?.after(
      el(
        "div",
        { class: `pc-ended pc-game ${prefix}-ended`, id: `${prefix}-ended` },
        count > 2 ? el("p", {}, `${game} needs every player's keys to read a card, so the game is over for all ${count} of you.`) : null,
        rows,
        check,
      ),
    );
  });
}
