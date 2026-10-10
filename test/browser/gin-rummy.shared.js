// Shared by the Gin Rummy browser tests: Playwright and the page helpers.
export { ARTIFACTS, pw, wait, noHorizontalScroll, bg, resultInView } from "./ludo.shared.js";

// The settings fold to a summary line in the lobby card; open it first.
export async function pick(page, name, value) {
  if (!(await page.locator("#gr-settings[open]").count())) await page.click("#gr-settings > summary");
  await page.click(`#gr-settings label:has(input[name="gr-${name}"][value="${value}"])`);
}
export const state = (page) => page.evaluate(() => window.ddp.match.state);

// Plays this page's choices through the page's own controls: what the Medium
// robot would do, made by tapping the pile or the stock, a card twice, Knock,
// Pass or Next hand (not while window.__hold is set). Laying down and laying
// off are the game's.
export function autoplay(page) {
  return page.evaluate(async () => {
    const { chooseMove } = await import("/gin-rummy/robot.js");
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const m = window.ddp.match;
      const click = (sel) => document.querySelector(`${sel}:not([hidden]):not([disabled])`)?.click();
      // window.__hold keeps a hand's score on the table.
      if (document.querySelector("#gr-next:not([hidden]):not([disabled])")) return window.__hold || click("#gr-next");
      if (!m?.canMove() || !["upcard", "draw", "discard"].includes(m.state.phase) || document.querySelector(".gr-fly .pc-card")) return;
      const move = chooseMove(m.state, m.me, Math.random, (s) => m.face(s), { level: "medium" });
      if (move.pass) click("#gr-pass");
      else if (move.take || move.draw === "pile") click("#gr-pile");
      else if (move.draw) click("#gr-stock");
      else if (move.knock) click("#gr-knock");
      else if (move.discard !== undefined) {
        const card = document.querySelector(`.gr-hcard[data-slot="${move.discard}"]`);
        card?.click();
        card?.click();
      }
    }, 40);
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
    const allowed = new Set(m.slots.flatMap((s) => (s.face !== null && (s.open || s.owner === m.me) ? [s.face] : [])));
    return [...document.querySelectorAll("[data-face]")].map((n) => n.dataset.face).filter((f) => f !== "null" && !allowed.has(Number(f)));
  });
