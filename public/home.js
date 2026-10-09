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

// A ready tile plays a short preview of its game on hover or focus, or once as
// it scrolls into view on a touch screen. preview.svg is inlined so its
// animations, which start paused, can run; without it the icon stays.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const canHover = matchMedia("(hover: hover)").matches;

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
  async function play() {
    if (reduceMotion.matches) return;
    preview ??= fetchPreview(slug);
    const svg = await preview;
    if (!svg) return;
    if (!svg.isConnected) img.replaceWith(svg);
    const animations = svg.getAnimations({ subtree: true });
    if (animations.some((a) => a.playState === "running")) return;
    for (const a of animations) a.play();
  }
  tile.addEventListener("mouseenter", play);
  tile.addEventListener("focusin", (e) => tile.contains(e.relatedTarget) || play());
  if (canHover) return;
  new IntersectionObserver(
    ([entry], observer) => {
      if (entry.intersectionRatio < 0.6) return;
      observer.disconnect();
      play();
    },
    { threshold: 0.6 },
  ).observe(tile);
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
