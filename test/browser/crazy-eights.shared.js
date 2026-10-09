// Shared by the Crazy Eights browser tests: Playwright and the page helpers.
export { ARTIFACTS, pw, wait, noHorizontalScroll, bg } from "./ludo.shared.js";

// The settings fold to a summary line in the lobby card; open it first.
export async function pick(page, name, value) {
  if (!(await page.locator("#ce-settings[open]").count())) await page.click("#ce-settings > summary");
  await page.click(`#ce-settings label:has(input[name="ce-${name}"][value="${value}"])`);
}
export const state = (page) => page.evaluate(() => window.ddp.match.state);
// The result box is in view without scrolling.
export const resultInView = (page) =>
  page.evaluate(() => {
    const r = document.querySelector(".ce-over-card").getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  });

// Plays this page's turns in the page itself: a glowing card, and the suggested suit after an 8.
// Draws and passes with no choice are made by the game.
export function autoplay(page) {
  return page.evaluate(() => {
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const best = document.querySelector("#ce-picker:not([hidden]) .ce-pick.best");
      if (best) return best.click();
      const cards = document.querySelectorAll(".ce-hcard.playable");
      if (cards.length) cards[Math.floor(Math.random() * cards.length)].click();
    }, 15);
  });
}
export const stopAutoplay = (page) => page.evaluate(() => clearInterval(window.__autoplay));

// Every face this page's match knows during play is open, or in its own hand.
export const leaks = (page) =>
  page.evaluate(() => {
    const m = window.ddp.match;
    return m.slots.flatMap((s, id) => (s.face !== null && !s.gone && !s.open && s.owner !== m.me ? [id] : []));
  });

// Faces drawn anywhere on this page that its match may not show during play (open, or in its own hand).
export const domLeaks = (page) =>
  page.evaluate(() => {
    const m = window.ddp.match;
    const allowed = new Set(m.slots.flatMap((s, id) => (s.face !== null && (s.open || s.owner === m.me) ? [s.face] : [])));
    return [...document.querySelectorAll("[data-face]")].map((n) => n.dataset.face).filter((f) => f !== "null" && !allowed.has(Number(f)));
  });
