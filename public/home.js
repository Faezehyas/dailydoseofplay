// Home page: one card per entry in games.json.
import { initShell, el, $ } from "/engine/shell.js";

initShell();

function card(game) {
  const ready = game.status === "ready";
  const icon = el("div", { class: "game-icon" });
  if (ready) icon.append(el("img", { src: `/${game.slug}/icon.svg`, alt: "", loading: "lazy" }));
  else {
    const initials = game.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
    icon.append(el("span", { class: "monogram", "aria-hidden": "true" }, initials));
  }
  const body = [
    icon,
    el("h2", {}, game.name),
    el("p", {}, game.description),
    el("div", { class: "game-meta" }, el("span", {}, game.players), el("span", { class: ready ? "badge" : "badge soon" }, ready ? "Play" : "Coming soon")),
  ];
  return el(
    "li",
    {},
    ready
      ? el("a", { class: "card game-card", href: `/${game.slug}/`, dataset: { slug: game.slug } }, ...body)
      : el("div", { class: "card game-card soon", "aria-disabled": "true", dataset: { slug: game.slug } }, ...body),
  );
}

async function main() {
  const list = $("#games");
  try {
    const res = await fetch("/games.json", { cache: "no-cache" });
    const { games } = await res.json();
    list.replaceChildren(...games.map(card));
  } catch {
    list.replaceChildren(el("li", { class: "card" }, "Couldn't load the game list. Please reload the page."));
  }
}

main();
