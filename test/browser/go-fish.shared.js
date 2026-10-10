// Shared by the Go Fish browser tests: Playwright and the page helpers.
export { ARTIFACTS, pw, wait, noHorizontalScroll, bg, resultInView } from "./ludo.shared.js";

// The settings fold to a summary line in the lobby card; open it first.
export async function pick(page, name, value) {
  if (!(await page.locator("#gf-settings[open]").count())) await page.click("#gf-settings > summary");
  await page.click(`#gf-settings label:has(input[name="gf-${name}"][value="${value}"])`);
}
export const state = (page) => page.evaluate(() => window.ddp.match.state);

// Makes this page's asks in the page itself: a random card, then a random
// player who has cards, then Ask. Answers, books and lucky fish are the game's.
export function autoplay(page) {
  return page.evaluate(() => {
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const ask = document.querySelector("#gf-ask:not([hidden])");
      if (!ask) return;
      const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
      if (!document.querySelector(".gf-hcard.chosen")) pickOne([...document.querySelectorAll(".gf-hcard")])?.click();
      if (ask.disabled) pickOne([...document.querySelectorAll(".gf-pick:not([disabled])")])?.click();
      if (!ask.disabled) ask.click();
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
