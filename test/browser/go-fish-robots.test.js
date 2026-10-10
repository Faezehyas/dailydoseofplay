// Headless-browser test for Go Fish: a game against three robots on a 360 px
// phone, with the deck's animations and sounds, the mute button, an ask made
// with the keyboard, the move timer and the "Fair play verified" result.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./go-fish.shared.js";

// It is my ask, with the screen caught up.
const myAsk = (page) => wait(page, () => !!document.querySelector("#gf-ask:not([hidden])") || window.ddp.match.phase !== "playing", undefined, 120_000);

test("Go Fish against three robots on a 360 px phone: deal, sounds, mute, keyboard, timer and a verified game", { skip: !pw && "Playwright not installed", timeout: 480_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling", "--autoplay-policy=no-user-gesture-required"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" });
  await ctx.addInitScript(() => (window.ddpSounds = []));
  await ctx.addInitScript(() => (globalThis.ddpRobotPace = 0.1));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const heard = () => page.evaluate(() => window.ddpSounds.slice());
  await page.clock.install();

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="go-fish"] h2 a, .game-card[data-slug="go-fish"]');
  await page.locator("#play-robot").waitFor();
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 15);
  await pick(page, "fourColor", true);
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/gf-9-settings-mobile.png`, fullPage: true });
  await page.tap("#play-robot");
  // The deck is shuffled by every seat with proofs; the table says so while it works.
  await page.locator("#gf-busy:not([hidden])").waitFor();
  await page.screenshot({ path: `${ARTIFACTS}/gf-10-robot-shuffling.png` });
  await wait(page, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot 1[\s\S]*Robot 2[\s\S]*Robot 3/);
  assert.equal(await page.locator("#gf-config").innerText(), "5 cards each · books of four · a lucky fish goes again · an empty hand draws one · 15 s to ask · Hard robots");
  assert.equal(await page.locator(".go-fish.four-colour").count(), 1, "the four-colour deck is on");
  assert.ok(await noHorizontalScroll(page));
  await wait(page, () => document.querySelectorAll(".gf-hcard").length >= 4 && !document.querySelector(".gf-fly .pc-card"), undefined, 30_000);
  const sounds = await heard();
  for (const name of ["shuffle", "deal"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);
  assert.ok(sounds.filter((s) => s === "deal").length >= 15, "a flick per card dealt");
  await page.screenshot({ path: `${ARTIFACTS}/gf-11-robot-dealt.png` });

  // My first ask, by keyboard: a card in my hand, a player, then A.
  await myAsk(page);
  if ((await state(page)).winner === -1) {
    const hand = page.locator(".gf-hcard[tabindex='0']");
    await hand.focus();
    await page.keyboard.press("ArrowRight");
    const face = Number(await page.evaluate(() => document.activeElement.firstChild.dataset.face));
    await page.keyboard.press("Enter");
    assert.ok(await page.locator(".gf-hcard.chosen").count(), "Enter chose the card's rank");
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains("gf-hcard")), "focus stays in the hand");
    const seat = await page.locator(".gf-pick:not([disabled])").first().getAttribute("data-seat");
    await page.locator(".gf-pick:not([disabled])").first().focus();
    await page.keyboard.press("Enter");
    assert.match(await page.locator("#gf-ask").innerText(), new RegExp(`^Ask Robot ${seat} for `));
    await page.screenshot({ path: `${ARTIFACTS}/gf-12-robot-ask.png` });
    const before = (await state(page)).log.length;
    await page.keyboard.press("a");
    await wait(page, (n) => window.ddp.match.state.log.length > n, before);
    const ask = (await state(page)).log[before];
    assert.deepEqual(ask, { t: "ask", p: 0, to: Number(seat), rank: face % 13 }, "the keyboard asked for the focused card's rank");
    await wait(page, () => window.ddpSounds.includes("ask"), undefined, 10_000);
  }

  // From here on reduced motion plays every event at once.
  await page.emulateMedia({ reducedMotion: "reduce" });

  // Muted: nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const quiet = (await heard()).length;
  const moves = (await state(page)).moves;
  await autoplay(page);
  await wait(page, (n) => window.ddp.match.state.moves > n + 12 || window.ddp.match.phase !== "playing", moves, 60_000);
  await stopAutoplay(page);
  assert.equal((await heard()).length, quiet, "no sound while muted");
  await page.click("#sound-toggle");

  // The move timer: leave an ask alone and one is made for you.
  if ((await state(page)).winner === -1) {
    await myAsk(page);
    if ((await state(page)).winner === -1) {
      await page.locator("#gf-timer:not([hidden])").waitFor();
      const from = (await state(page)).log.length;
      await page.clock.fastForward("00:16");
      await wait(page, (n) => window.ddp.match.state.log.slice(n).some((e) => e.t === "ask" && e.p === 0), from, 15_000);
      await page.locator("#toast", { hasText: "Time's up: asked" }).waitFor({ state: "attached" });
    }
  }

  // The rest at speed.
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 300_000);
  await stopAutoplay(page);
  const st = await state(page);
  for (let k = 0; k < 3; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  assert.deepEqual(await leaks(page), []);
  assert.deepEqual(await domLeaks(page), []);
  await page.locator("#result").waitFor();
  assert.match(await page.locator("#result").innerText(), /^(You won|Draw|Robot \d won)$/);
  await page.locator("#gf-verdict.ok").waitFor({ timeout: 60_000 });
  assert.match(await page.locator("#gf-verdict").innerText(), /Fair play verified/);
  const all = await heard();
  for (const name of ["ask", "fish", "book", "draw"]) assert.ok(all.includes(name), `played ${name}`);
  assert.ok(all.some((s) => /^(win|loss|over|draw)-water$/.test(s)), "the result chime, in its water timbre");
  assert.ok(await resultInView(page), "the result fits the phone without scrolling");
  await page.screenshot({ path: `${ARTIFACTS}/gf-14-robot-over.png` });

  // The robots accept a rematch; dark mode still fits the phone.
  const m = await page.evaluate(() => window.ddp.match.m);
  await page.click("#rematch");
  await wait(page, (n) => window.ddp.match.m === n + 1 && window.ddp.match.phase === "playing", m, 60_000);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/gf-15-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
