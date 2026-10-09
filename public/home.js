// Home page: one card per entry in games.json, the last game played first.
import { initShell, el, $, getLastGame } from "/engine/shell.js";

initShell();

function card(game, last) {
  const ready = game.status === "ready";
  const icon = el("div", { class: "game-icon" });
  if (ready) icon.append(el("img", { src: `/${game.slug}/icon.svg`, alt: "", loading: "lazy" }));
  else {
    const initials = game.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
    icon.append(el("span", { class: "monogram", "aria-hidden": "true" }, initials));
  }
  if (last) icon.append(el("span", { class: "last-played" }, "Last played"));
  const lobby = `/${game.slug}/`;
  const body = [
    icon,
    // Links can't nest, so the name's link stretches over the tile (theme.css).
    el("h2", {}, ready ? el("a", { href: lobby }, game.name) : game.name),
    el("p", {}, game.description),
    // The tile is the link, so only a game that isn't ready gets a badge.
    el("div", { class: "game-meta" }, el("span", { class: "chip mono" }, game.players), !ready && el("span", { class: "badge soon" }, "Coming soon")),
    ready &&
      el(
        "div",
        { class: "quick-play" },
        el("a", { class: "btn primary small", href: `${lobby}?friend=1`, "aria-label": `Play friends at ${game.name}` }, "Play friends"),
        el("a", { class: "btn small", href: `${lobby}?robot=1`, "aria-label": `Play the robot at ${game.name}` }, "Play the robot"),
      ),
  ];
  return el(
    "li",
    {},
    el("div", { class: ready ? "card game-card" : "card game-card soon", "aria-disabled": !ready && "true", dataset: { slug: game.slug } }, ...body),
  );
}

const list = $("#games");
const placeholders = [...list.children];

// After a retry, focus moves to the first tile or the new Retry button, so a
// keyboard user keeps their place.
async function load(retrying = false) {
  list.replaceChildren(...placeholders);
  list.setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/games.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { games } = await res.json();
    const slug = getLastGame();
    const last = games.find((g) => g.slug === slug && g.status === "ready");
    const ordered = last ? [last, ...games.filter((g) => g !== last)] : games;
    list.replaceChildren(...ordered.map((g) => card(g, g === last)));
  } catch {
    list.replaceChildren(
      el(
        "li",
        { class: "grid-notice" },
        el(
          "p",
          { class: "notice error", role: "alert" },
          "Couldn't load the game list.",
          el("button", { class: "btn primary small", type: "button", id: "retry", onclick: () => load(true) }, "Retry"),
        ),
      ),
    );
  }
  list.removeAttribute("aria-busy");
  if (retrying) list.querySelector("a, button")?.focus();
}

load();
