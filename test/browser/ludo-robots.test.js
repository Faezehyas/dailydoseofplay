// Headless-browser test for Ludo: a game against three robots on a 360 px
// phone with the die, hops, sounds, the mute button, the keyboard and the
// move timer. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, state, yardCorner, resultInView, autoplay, stopAutoplay } from "./ludo.shared.js";

test("Ludo against three robots on a 360 px phone: die, hops, sounds, mute, keyboard and the move timer", { skip: !pw && "Playwright not installed", timeout: 360_000 }, async (t) => {
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
  const heard = () => page.evaluate(() => window.ddpSounds.slice());
  await page.clock.install();

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="ludo"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 10);
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/ld-9-settings-mobile.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot 1[\s\S]*Robot 2[\s\S]*Robot 3/);
  assert.equal(await page.locator("#ld-config").innerText(), "three 6s lose the turn · no blocks · no capture bonus · play for places · 10 s to move · Hard robots");
  assert.equal(await yardCorner(page, "red"), "bottom left");
  assert.ok(await noHorizontalScroll(page));
  assert.ok(await page.locator("#ld-timer").isVisible(), "the move timer runs");

  // Roll by touch: the die tumbles and lands.
  await page.tap("#ld-roll");
  assert.ok(await page.locator("#ld-die.tumbling").count(), "the die tumbles");
  await page.screenshot({ path: `${ARTIFACTS}/ld-10-robot-rolling.png` });
  await wait(page, () => window.ddp.match.state.ply >= 1);
  const first = (await state(page)).last;
  await wait(page, (v) => document.querySelector("#ld-die .face").dataset.value === String(v), first.value);
  assert.ok((await heard()).includes("dice"), "the die rattles");

  // Keep rolling by touch until a token is out and moves square by square.
  const t0 = Date.now();
  while (!(await heard()).includes("hop")) {
    if (Date.now() - t0 > 120_000) throw new Error("no hop heard");
    if (await page.locator("#ld-roll").isEnabled()) await page.tap("#ld-roll");
    const token = page.locator(".hit-token").first();
    if (await token.count()) await token.dispatchEvent("click").catch(() => {});
    await page.waitForTimeout(60);
  }
  await page.screenshot({ path: `${ARTIFACTS}/ld-11-robot-moving.png` });
  const sounds = await heard();
  for (const name of ["dice", "out", "hop"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);

  // A choice: movable tokens glow and their landing spots show. Pick by keyboard.
  // From here on reduced motion applies moves at once, so the robots keep up.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.__autoplay = setInterval(() => {
      const roll = document.querySelector("#ld-roll");
      if (roll && !roll.disabled && document.querySelectorAll(".pawn.movable").length === 0) roll.click();
    }, 60);
  });
  await wait(page, () => new Set([...document.querySelectorAll(".hit-dest")].map((d) => d.getAttribute("cx") + d.getAttribute("cy"))).size > 1, undefined, 180_000);
  await stopAutoplay(page);
  assert.ok((await page.locator(".pawn.movable").count()) >= 2);
  assert.ok((await page.locator(".dest").count()) >= 2, "each choice shows where it lands");
  await page.locator(".hit-token").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: `${ARTIFACTS}/ld-12-robot-choice.png` });
  assert.ok(await page.locator(".dest.focus").count(), "the focused token's landing spot stands out");
  const chosen = await page.evaluate(() => document.activeElement.classList.contains("hit-token") && Number(document.activeElement.dataset.token));
  assert.equal(typeof chosen, "number", "the arrow key moved focus to another token");
  const ply = (await state(page)).ply;
  await page.keyboard.press("Enter");
  await wait(page, (n) => window.ddp.match.state.ply > n, ply);
  const played = (await state(page)).last;
  assert.deepEqual([played.type, played.player, played.token], ["move", 0, chosen], "Enter moved the focused token");

  // Muted: nothing more plays. Roll with the keyboard.
  await wait(page, () => !document.querySelector("#ld-roll").disabled || window.ddp.match.state.turn !== 0, undefined, 60_000);
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const before = (await heard()).length;
  await wait(page, () => !document.querySelector("#ld-roll").disabled, undefined, 60_000);
  await page.locator("#ld-roll").focus();
  await page.keyboard.press("Enter");
  await wait(page, () => window.ddp.match.state.turn !== 0 || window.ddp.match.state.rolled, undefined, 30_000);
  await page.waitForTimeout(1500);
  assert.equal((await heard()).length, before, "no sound while muted");
  await page.click("#sound-toggle");
  // Move a token if that roll left a choice, so the timer below starts on a roll.
  const left = page.locator(".hit-token").first();
  if (await left.count()) await left.dispatchEvent("click").catch(() => {});

  // The move timer: leave the die alone and the game rolls for you. Record
  // every move as it's applied: a forced move follows the roll 650 ms later,
  // and both can land between two polls.
  await page.evaluate(() => {
    const m = window.ddp.match;
    window.plays = [];
    window.stopPlays = m.on("events", () => window.plays.push({ ply: m.state.ply, last: structuredClone(m.state.last) }));
  });
  await wait(page, () => !document.querySelector("#ld-roll").disabled, undefined, 90_000);
  const waited = (await state(page)).ply;
  await page.clock.fastForward("00:11");
  const auto = await (await wait(page, (n) => window.plays.find((p) => p.ply === n + 1)?.last, waited, 15_000)).jsonValue();
  await page.evaluate(() => window.stopPlays());
  assert.equal(auto.player, 0, "your roll was made for you");
  assert.equal(auto.type, "roll");

  // The rest at speed.
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 300_000);
  await stopAutoplay(page);
  const st = await state(page);
  assert.equal(st.players, 4);
  for (let k = 0; k < 3; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  await page.locator("#ld-result").waitFor();
  assert.match(await page.locator("#ld-result").innerText(), /^(You win!|Robot \d wins · you're (2nd|3rd|4th))$/);
  assert.ok((await heard()).includes(st.winner === 0 ? "win" : "lose"));
  assert.ok(await resultInView(page), "the result fits the phone without scrolling");
  await page.screenshot({ path: `${ARTIFACTS}/ld-13-robot-over.png` });

  // The robots accept a rematch; dark mode still fits the phone.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  assert.deepEqual((await state(page)).tokens.flat(), Array(16).fill(-1));
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/ld-14-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
