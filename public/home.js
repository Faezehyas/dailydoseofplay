// Home page: one card per entry in games.json.
import { initShell, el, $ } from "/engine/shell.js";

initShell();

function card(game) {
  const ready = game.status === "ready";
  const icon = el("div", { class: "game-icon" });
  const img = ready && el("img", { src: `/${game.slug}/icon.svg`, alt: "", loading: "lazy" });
  if (ready) icon.append(img);
  else {
    const initials = game.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3);
    icon.append(el("span", { class: "monogram", "aria-hidden": "true" }, initials));
  }
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
  const tile = el("div", { class: ready ? "card game-card" : "card game-card soon", "aria-disabled": !ready && "true", dataset: { slug: game.slug } }, ...body);
  if (ready) watchPreview(tile, img, game.slug);
  return el("li", {}, tile);
}

// While a ready tile is hovered or focused, or on a touch screen while it is
// mostly in view, it loops a short preview of its game, then shows its icon
// again. preview.svg is inlined so its animations, which start paused, can
// run; without it the icon stays.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const canHover = matchMedia("(hover: hover)").matches;
const HOLD_MS = 1200; // on the last frame before the next loop

async function fetchPreview(slug) {
  try {
    const res = await fetch(`/${slug}/preview.svg`);
    if (!res.ok) return null;
    const svg = new DOMParser().parseFromString(await res.text(), "image/svg+xml").documentElement;
    if (!(svg instanceof SVGSVGElement) || svg.querySelector("parsererror")) return null;
    svg.setAttribute("aria-hidden", "true");
    return document.importNode(svg, true);
  } catch {
    return null;
  }
}

function watchPreview(tile, img, slug) {
  let preview;
  let run = 0; // bumped on every start and stop, so a stale loop ends
  const on = { hover: false, focus: false, view: false };
  async function start() {
    const id = ++run;
    preview ??= fetchPreview(slug);
    const svg = await preview;
    if (!svg || id !== run) return;
    img.replaceWith(svg);
    while (id === run) {
      const animations = svg.getAnimations({ subtree: true });
      for (const a of animations) a.play();
      try {
        await Promise.all(animations.map((a) => a.finished));
      } catch {
        return; // taken out of the page
      }
      await new Promise((r) => setTimeout(r, HOLD_MS));
    }
  }
  function stop() {
    run++;
    preview?.then((svg) => svg?.replaceWith(img));
  }
  let playing = false;
  function set(key, value) {
    on[key] = value;
    const want = (on.hover || on.focus || on.view) && !reduceMotion.matches;
    if (want === playing) return;
    playing = want;
    if (want) start();
    else stop();
  }
  tile.addEventListener("mouseenter", () => set("hover", true));
  tile.addEventListener("mouseleave", () => set("hover", false));
  tile.addEventListener("focusin", () => set("focus", true));
  tile.addEventListener("focusout", (e) => tile.contains(e.relatedTarget) || set("focus", false));
  if (canHover) return;
  new IntersectionObserver(([entry]) => set("view", entry.intersectionRatio >= 0.6), { threshold: [0, 0.6] }).observe(tile);
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
    list.replaceChildren(...games.map(card));
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

// The hero scene's loops run only while it is on screen and the tab is shown.
const scene = $(".hero-scene");
let onScreen = true;
const pause = () => scene.classList.toggle("paused", document.hidden || !onScreen);
new IntersectionObserver(([entry]) => {
  onScreen = entry.isIntersecting;
  pause();
}).observe(scene);
document.addEventListener("visibilitychange", pause);
