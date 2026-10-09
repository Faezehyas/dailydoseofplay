// The result moment every game plays from its result panel's onShow: about
// 1.5 s, once per match, with a chime from chimes.js. A win lights up the
// winning pieces one after another, then a few dots in the logo's pattern
// rise from the title; a loss dims the board and fades the title in; a draw
// pulses the player pills; "over" (someone else won, with more than two
// playing) lights up the winner's pieces quietly. With reduced motion only
// the colours change (see "result moment" in theme.css).
import { el, reducedMotion } from "./shell.js";
import { sounds, chime } from "./chimes.js";

let undo = [];

function mark(node, ...classes) {
  if (!node) return;
  node.classList.add(...classes);
  undo.push(() => node.classList.remove(...classes));
}

// outcome: "win" | "loss" | "draw" | "over"; flavour: a timbre of chimes.js
// ("wood", "paper", "plastic", "bell" or "water"); highlight: the winning
// pieces, in the order they light up; anchor: where the dots rise from (the
// result title); board: what a loss dims.
export function celebrate({ outcome, flavour, highlight = [], anchor = document.getElementById("result"), board = null }) {
  calm();
  sounds.play(chime(outcome, flavour));
  mark(anchor?.closest(".result-panel"), "celebrate", `celebrate-${outcome}`);
  const lit = outcome === "win" || outcome === "over" ? highlight.filter(Boolean) : [];
  lit.forEach((node, i) => {
    node.style.setProperty("--i", i);
    mark(node, "celebrate-lit");
  });
  if (outcome === "loss") mark(board, "celebrate-dim");
  if (outcome === "draw") document.querySelectorAll(".player-bar .pb-who").forEach((pill) => mark(pill, "celebrate-pulse"));
  if (outcome === "win" && anchor && !reducedMotion()) burst(anchor, lit.length);
}

// Three sets of the logo's four dots, rising from the top of `anchor` once
// the `after` pieces have lit up.
function burst(anchor, after) {
  const r = anchor.getBoundingClientRect();
  const dots = [];
  for (const q of [-1, 0, 1]) {
    for (let d = 0; d < 4; d++) dots.push(el("span", { class: `celebrate-dot ${d % 3 ? "b" : "a"}`, style: `--q: ${q}; --dx: ${d % 2}; --dy: ${d >> 1}` }));
  }
  const node = el("div", { class: "celebrate-burst", "aria-hidden": "true", style: `left: ${r.left + r.width / 2}px; top: ${r.top}px; --after: ${after}` }, dots);
  dots.at(-1).addEventListener("animationend", () => node.remove());
  document.body.append(node);
  undo.push(() => node.remove());
}

// Undoes the last moment: the result panel calls it when it hides.
export function calm() {
  for (const fn of undo) fn();
  undo = [];
}
