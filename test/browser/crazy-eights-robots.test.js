// Headless-browser test for Crazy Eights: a game against three robots on a
// 360 px phone, with the deck's animations and sounds, the mute button, the
// keyboard, the suit picker, the move timer and the "Fair play verified"
// result. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./crazy-eights.shared.js";

// Plays my turns, keeping 8s back: stops when an 8 is all that plays, so the test can name a suit.
const playButEights = (page) =>
  page.evaluate(() => {
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const cards = [...document.querySelectorAll(".ce-hcard.playable")];
      const plain = cards.filter((c) => !/^\d+$/.test(c.firstChild.dataset.face) || Number(c.firstChild.dataset.face) % 13 !== 7);
      if (plain.length) plain[0].click();
    }, 40);
  });
const onlyEightPlays = (page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ce-hcard.playable")];
    return cards.length > 0 && cards.every((c) => Number(c.firstChild.dataset.face) % 13 === 7);
  });

test("Crazy Eights against three robots on a 360 px phone: deal, sounds, mute, keyboard, suit picker, timer and a verified game", { skip: !pw && "Playwright not installed", timeout: 480_000 }, async (t) => {
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
  await page.click('.game-card[data-slug="crazy-eights"] h2 a, .game-card[data-slug="crazy-eights"]');
  await page.locator("#play-robot").waitFor();
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 15);
  await pick(page, "fourColor", true);
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/ce-9-settings-mobile.png`, fullPage: true });
  await page.tap("#play-robot");
  // The deck is shuffled by every seat with proofs; the table says so while it works.
  await page.locator("#ce-busy:not([hidden])").waitFor();
  await page.screenshot({ path: `${ARTIFACTS}/ce-10-robot-shuffling.png` });
  await wait(page, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  assert.match(await page.locator(".ce-players").innerText(), /Cleo[\s\S]*Robot 1[\s\S]*Robot 2[\s\S]*Robot 3/);
  assert.equal(await page.locator("#ce-config").innerText(), "draw until you can play · draw only when nothing plays · no action cards · 15 s to move · Hard robots");
  assert.equal(await page.locator(".crazy-eights.four-colour").count(), 1, "the four-colour deck is on");
  assert.ok(await noHorizontalScroll(page));
  await wait(page, () => document.querySelectorAll(".ce-hcard").length === 5 && !document.querySelector(".ce-fly .ce-card"), undefined, 30_000);
  // The starter snaps onto the discard pile once the deal has landed.
  await wait(page, () => window.ddpSounds.includes("play"), undefined, 30_000);
  const sounds = await heard();
  for (const name of ["shuffle", "deal", "play"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);
  assert.ok(sounds.filter((s) => s === "deal").length >= 20, "a flick per card dealt");
  await page.screenshot({ path: `${ARTIFACTS}/ce-11-robot-dealt.png` });

  // My turn first: by keyboard, a card that plays, or the draw made for me.
  await wait(page, () => window.ddp.match.state.turn === 0 && !document.querySelector("#ce-status").textContent.startsWith("Dealing"), undefined, 30_000);
  const before = (await state(page)).moves;
  if (await page.locator(".ce-hcard.playable").count()) {
    await page.locator(".ce-hcard[tabindex='0']").focus();
    const target = await page.evaluate(() => {
      const list = [...document.querySelectorAll(".ce-hcard")];
      return list.findIndex((b) => b.classList.contains("playable"));
    });
    const at = await page.evaluate(() => [...document.querySelectorAll(".ce-hcard")].indexOf(document.activeElement));
    for (let i = at; i < target; i++) await page.keyboard.press("ArrowRight");
    for (let i = at; i > target; i--) await page.keyboard.press("ArrowLeft");
    const face = Number(await page.evaluate(() => document.activeElement.firstChild.dataset.face));
    await page.keyboard.press("Enter");
    if (face % 13 === 7) {
      await page.locator("#ce-picker:not([hidden])").waitFor();
      await page.keyboard.press("Enter");
    }
    await wait(page, (n) => window.ddp.match.state.moves > n, before);
    assert.deepEqual((await state(page)).history.find((h) => h.p === 0 && h.t === "play")?.face, face, "Enter played the focused card");
    await wait(page, () => !document.querySelector(".ce-fly .ce-card"), undefined, 10_000);
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains("ce-hcard")), "focus stays in the hand");
  } else {
    await wait(page, (n) => window.ddp.match.state.moves > n, before, 20_000);
    assert.ok((await state(page)).history.some((h) => h.p === 0 && h.t === "draw"), "with nothing to play, the draw was made for me");
  }
  await page.screenshot({ path: `${ARTIFACTS}/ce-12-robot-played.png` });

  // The suit picker: play on, keeping 8s back, until an 8 is the only card that plays.
  // From here on reduced motion plays every card at once, so the hunt is quick.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await playButEights(page);
  const t0 = Date.now();
  while (!(await onlyEightPlays(page))) {
    if (Date.now() - t0 > 240_000) throw new Error("never held a lone playable 8");
    if ((await state(page)).winner !== -1) {
      await page.locator("#rematch").waitFor();
      await page.click("#rematch");
      await wait(page, () => window.ddp.match.phase === "playing", undefined, 60_000);
    }
    await page.waitForTimeout(80);
  }
  await stopAutoplay(page);
  await page.locator(".ce-hcard.playable").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#ce-picker:not([hidden])").waitFor();
  assert.equal(await page.locator(".ce-pick").count(), 4);
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains("ce-pick")), "the picker takes focus");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => document.querySelector("#ce-picker").contains(document.activeElement)), "Tab stays in the picker");
  await page.screenshot({ path: `${ARTIFACTS}/ce-13-robot-picker.png` });
  // Escape cancels; then the arrow keys pick a suit and Enter names it.
  await page.keyboard.press("Escape");
  assert.ok(await page.locator("#ce-picker[hidden]").count());
  await page.locator(".ce-hcard.playable").first().focus();
  await page.keyboard.press("Enter");
  await page.locator("#ce-picker:not([hidden])").waitFor();
  const chosen = Number(await page.evaluate(() => {
    const picks = [...document.querySelectorAll(".ce-pick")];
    return picks[(picks.indexOf(document.activeElement) + 1) % 4].dataset.suit;
  }));
  await page.keyboard.press("ArrowRight");
  const ply = (await state(page)).moves;
  await page.keyboard.press("Enter");
  await wait(page, (n) => window.ddp.match.state.moves > n, ply);
  const named = await state(page);
  assert.deepEqual([named.suit, named.named], [chosen, true], "the 8 named the suit picked");
  if (named.hands[0].length) assert.ok(await page.evaluate(() => document.activeElement.classList.contains("ce-hcard")), "focus goes back to the hand");
  await wait(page, () => window.ddpSounds.includes("eight"), undefined, 10_000);
  await page.locator("#ce-suit.named").waitFor();

  // Muted: nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const quiet = (await heard()).length;
  await autoplay(page);
  await wait(page, (n) => window.ddp.match.state.moves > n + 6 || window.ddp.match.phase !== "playing", named.moves, 60_000);
  await stopAutoplay(page);
  assert.equal((await heard()).length, quiet, "no sound while muted");
  await page.click("#sound-toggle");
  // The game may have ended while muted (no tune then): play on in a rematch.
  if ((await state(page)).winner !== -1) {
    const m = await page.evaluate(() => window.ddp.match.m);
    await page.locator("#rematch").click();
    await wait(page, (n) => window.ddp.match.m === n + 1 && window.ddp.match.phase === "playing", m, 60_000);
  }

  // The move timer: leave a turn alone and a move is made for you.
  if ((await state(page)).winner === -1) {
    await page.evaluate(() => {
      const m = window.ddp.match;
      window.mine = [];
      window.stopMine = m.on("events", ({ player }) => player === 0 && window.mine.push(m.state.moves));
    });
    await wait(page, () => window.ddp.match.phase !== "playing" || (window.ddp.match.state.turn === 0 && document.querySelectorAll(".ce-hcard.playable").length > 0), undefined, 90_000);
    if ((await state(page)).winner === -1) {
      await page.locator("#ce-timer:not([hidden])").waitFor();
      // The timer's move: the first card in my hand (in the state's order) that plays.
      const { from, face } = await page.evaluate(() => {
        const m = window.ddp.match;
        const st = m.state;
        const follows = (f) => f !== null && (f % 13 === 7 || Math.floor(f / 13) === st.suit || f % 13 === st.top % 13);
        return { from: st.history.length, face: st.hands[0].map((slot) => m.face(slot)).find(follows) };
      });
      await page.clock.fastForward("00:16");
      await wait(page, () => window.mine.length > 0, undefined, 15_000);
      const mine = (await state(page)).history.slice(from).find((h) => h.p === 0);
      assert.deepEqual([mine.t, mine.face], ["play", face], "time ran out: the first card that plays was played for me");
    }
    await page.evaluate(() => window.stopMine());
  }

  // The rest at speed.
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 300_000);
  await stopAutoplay(page);
  const st = await state(page);
  for (let k = 0; k < 3; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  assert.deepEqual(await leaks(page), []);
  assert.deepEqual(await domLeaks(page), []);
  await page.locator("#ce-result").waitFor();
  assert.match(await page.locator("#ce-result").innerText(), /^(You win!|Robot \d wins · you're (2nd|3rd|4th))$/);
  await page.locator("#ce-verdict.ok").waitFor({ timeout: 60_000 });
  assert.match(await page.locator("#ce-verdict").innerText(), /Fair play verified/);
  assert.ok((await heard()).includes(st.winner === 0 ? "win" : "lose"));
  assert.ok(await resultInView(page), "the result fits the phone without scrolling");
  await page.screenshot({ path: `${ARTIFACTS}/ce-14-robot-over.png` });

  // The robots accept a rematch; dark mode still fits the phone.
  const m = await page.evaluate(() => window.ddp.match.m);
  await page.click("#rematch");
  await wait(page, (n) => window.ddp.match.m === n + 1 && window.ddp.match.phase === "playing", m, 60_000);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/ce-15-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
