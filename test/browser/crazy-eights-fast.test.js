// Headless-browser test for Crazy Eights at full speed: with reduced motion
// and the robots' pace near 0, a whole game against three robots runs with
// no animation and no artificial wait, so only the deck's cryptography takes
// time. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { pw, wait, state, autoplay, stopAutoplay } from "./crazy-eights.shared.js";

test("Crazy Eights with animations off and robots at full speed: a whole game is only the deck's own work", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    globalThis.ddpRobotPace = 0.001;
    localStorage.setItem("ddp-crazy-eights-settings", JSON.stringify({ robots: 3, level: "hard" }));
    // Count every scripted animation and every card that would fly.
    window.animations = 0;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.animations++;
      return animate.apply(this, args);
    };
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${srv.base}/crazy-eights/?robot=1`);
  await wait(page, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  await page.evaluate(() => {
    window.flown = 0;
    new MutationObserver((list) => list.forEach((r) => (window.flown += r.addedNodes.length))).observe(document.querySelector(".ce-fly"), { childList: true });
    // How long each turn took, from one move to the next, and how much of it was the deck's work.
    const m = window.ddp.match;
    window.turns = [];
    let last = performance.now();
    let deck = 0;
    let since = null;
    m.on("update", () => {
      if (m.busy && since === null) since = performance.now();
      if (!m.busy && since !== null) {
        deck += performance.now() - since;
        since = null;
      }
    });
    m.on("events", ({ player }) => {
      if (player < 0) return;
      const now = performance.now();
      window.turns.push({ ms: now - last, deck });
      last = now;
      deck = 0;
    });
  });
  const t0 = Date.now();
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 150_000);
  await stopAutoplay(page);
  const played = Date.now() - t0;
  await wait(page, () => window.ddp.match.verdict, undefined, 60_000);
  assert.deepEqual(await page.evaluate(() => window.ddp.match.verdict), { ok: true });
  const st = await state(page);
  const { animations, flown, turns } = await page.evaluate(() => ({ animations: window.animations, flown: window.flown, turns: window.turns }));
  assert.equal(animations, 0, "nothing animated");
  assert.equal(flown, 0, "no card flew");
  // Without the deck's own rounds (a deal, a reshuffle), a turn is a few milliseconds.
  const idle = turns.map((x) => Math.max(0, x.ms - x.deck));
  const slowest = Math.max(...idle);
  t.diagnostic(`${st.moves} moves in ${played} ms (${Math.round(played / st.moves)} ms a move); slowest turn outside the deck's work ${Math.round(slowest)} ms`);
  assert.ok(slowest < 400, `a turn waited ${Math.round(slowest)} ms for something other than the deck`);
  assert.deepEqual(errors, []);
});
