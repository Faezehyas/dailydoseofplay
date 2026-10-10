// Headless-browser test for Gin Rummy: a game against the robot on a 360 px
// phone, with the deck's animations and sounds, the mute button, moves made
// with the keyboard, rearranging the hand (keys, drag and sort), the move
// timer and the "Fair play verified" result. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./gin-rummy.shared.js";

// It is my choice, with the screen caught up: the upcard, a draw, a discard (or the game is over).
const myChoice = (page, ids) => wait(page, (sel) => !!document.querySelector(sel) || window.ddp.match.phase !== "playing", ids.map((id) => `#${id}:not([hidden])`).join(", "), 60_000);
const handOrder = (page) => page.evaluate(() => [...document.querySelectorAll(".gr-hcard")].sort((a, b) => new DOMMatrix(a.style.transform).m41 - new DOMMatrix(b.style.transform).m41).map((b) => Number(b.dataset.slot)));

test("Gin Rummy against the robot on a 360 px phone: deal, sounds, mute, keyboard, rearranging, timer and a verified game", { skip: !pw && "Playwright not installed", timeout: 480_000 }, async (t) => {
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
  await page.click('.game-card[data-slug="gin-rummy"] h2 a, .game-card[data-slug="gin-rummy"]');
  await page.locator("#play-robot").waitFor();
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "dealer", "guest"); // the robot deals: I'm offered the upcard first
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 15);
  await pick(page, "fourColor", true);
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/gr-9-settings-mobile.png`, fullPage: true });
  await page.tap("#play-robot");
  // The deck is shuffled by both seats with proofs; the table says so while it works.
  await page.locator("#gr-busy:not([hidden])").waitFor();
  await page.screenshot({ path: `${ARTIFACTS}/gr-10-robot-shuffling.png` });
  await wait(page, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#gr-config").innerText(), "Game to 100 · knock with 10 or less · 15 s a move · Hard robot");
  assert.equal(await page.locator(".gin-rummy.four-colour").count(), 1, "the four-colour deck is on");
  assert.ok(await noHorizontalScroll(page));
  await wait(page, () => document.querySelectorAll(".gr-hcard").length === 10 && !document.querySelector(".gr-fly .pc-card") && !!document.querySelector("#gr-pile .pc-card:not(.down)"), undefined, 30_000);
  const sounds = await heard();
  for (const name of ["shuffle", "deal", "play"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);
  assert.ok(sounds.filter((s) => s === "deal").length >= 20, "a flick per card dealt");
  await page.screenshot({ path: `${ARTIFACTS}/gr-11-robot-dealt.png` });

  // The upcard, by keyboard: P passes.
  await myChoice(page, ["gr-pass"]);
  await page.keyboard.press("p");
  await wait(page, () => window.ddp.match.state.log.some((e) => e.t === "pass" && e.p === 0));

  // A draw by keyboard (D), unless both passed and the stock's card came to me.
  await myChoice(page, ["gr-draw", "gr-discard"]);
  if (await page.locator("#gr-draw:not([hidden])").count()) {
    await page.keyboard.press("d");
    await myChoice(page, ["gr-discard"]);
  }
  // My discard turn: the hand holds still. Suit sorts; Shift and an arrow moves a card; a drag moves one, and throws nothing.
  await page.click("#gr-sort-suit");
  assert.equal(await page.locator("#gr-sort-suit").getAttribute("aria-pressed"), "true");
  await wait(page, () => !document.querySelector(".gr-fly .pc-card"));
  const before = await handOrder(page);
  const last = before.at(-1);
  await page.locator(`.gr-hcard[data-slot="${last}"]`).focus();
  await page.keyboard.press("Shift+ArrowLeft");
  const moved = await handOrder(page);
  const deadwoodBefore = await page.evaluate((s) => !document.querySelector(`.gr-hcard[data-slot="${s}"]`).classList.contains("inmeld"), before.at(-2));
  if (deadwoodBefore) assert.equal(moved.indexOf(last), before.length - 2, "Shift+ArrowLeft moved the card one place left");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.slot), String(last), "focus stays on the moved card");
  assert.equal(await page.locator("#gr-sort-suit").getAttribute("aria-pressed"), "false", "a hand you arrange yourself is no longer sorted");
  // Drag the first deadwood card to the far right with the mouse.
  const dead = await page.evaluate(() => [...document.querySelectorAll(".gr-hcard:not(.inmeld)")].map((b) => Number(b.dataset.slot)));
  if (dead.length >= 2) {
    await wait(page, () => !document.querySelector("#gr-hand").getAnimations({ subtree: true }).length); // the cards have settled
    const card = page.locator(`.gr-hcard[data-slot="${dead[0]}"]`);
    const box = await card.boundingBox();
    const handBox = await page.locator("#gr-hand").boundingBox();
    // By its left edge: the next card covers the rest of it.
    const y = box.y + 20;
    await page.mouse.move(box.x + 8, y);
    await page.mouse.down();
    for (let x = box.x + 8; x < handBox.x + handBox.width - 4; x += 12) await page.mouse.move(x, y);
    await page.mouse.up();
    const after = await handOrder(page);
    assert.equal(after.at(-1), dead[0], "the dragged card went to the end of the hand");
    assert.equal(await page.locator(".gr-hcard.chosen").count(), 0, "a drag doesn't pick the card");
    // A drag let go outside the hand ends there: the card doesn't follow the mouse back in.
    const other = await page.locator(`.gr-hcard[data-slot="${dead[1]}"]`).boundingBox();
    await page.mouse.move(other.x + 8, other.y + 20);
    await page.mouse.down();
    await page.mouse.move(other.x + 8, other.y - 200);
    await page.mouse.up();
    await page.mouse.move(other.x + 60, other.y + 20);
    await page.mouse.move(other.x + 120, other.y + 20);
    assert.equal(await page.locator(".gr-hcard.dragging").count(), 0, "nothing sticks to the mouse");
  }
  await page.screenshot({ path: `${ARTIFACTS}/gr-12-robot-arranged.png` });

  // A discard by keyboard: Enter picks a card, Enter again throws it.
  if ((await state(page)).phase === "discard") {
    const st = await state(page);
    const throwable = (await handOrder(page)).filter((s) => s !== st.taken);
    await page.locator(`.gr-hcard[data-slot="${throwable[0]}"]`).focus();
    await page.keyboard.press("Enter");
    assert.ok(await page.locator(".gr-hcard.chosen").count(), "Enter picked the card");
    assert.match(await page.locator("#gr-discard").innerText(), /^Discard the /);
    await page.keyboard.press("Enter");
    await wait(page, (s) => window.ddp.match.state.log.some((e) => e.t === "discard" && e.p === 0 && e.slot === s), throwable[0]);
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
  const handsHeard = (await state(page)).history.length; // the hands that end from here on are heard

  // The move timer: leave a choice alone and a sensible move is made for you.
  if ((await state(page)).winner === -1) {
    await myChoice(page, ["gr-pass", "gr-draw", "gr-discard", "gr-next"]);
    if ((await state(page)).winner === -1) {
      await page.locator("#gr-timer:not([hidden])").waitFor();
      const from = (await state(page)).moves;
      await page.clock.fastForward("00:16");
      await wait(page, (n) => window.ddp.match.state.moves > n, from, 15_000);
      await page.locator("#toast", { hasText: "Time's up" }).waitFor({ state: "attached" });
    }
  }

  // The rest at speed.
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 300_000);
  await stopAutoplay(page);
  await wait(page, () => window.ddp.robots[0].match.phase === "over");
  const st = await state(page);
  assert.deepEqual(await page.evaluate(() => window.ddp.robots[0].match.state), st, "the robot agrees");
  assert.deepEqual(await leaks(page), []);
  assert.deepEqual(await domLeaks(page), []);
  await page.locator("#result").waitFor();
  assert.match(await page.locator("#result").innerText(), /^(You won|You lost)$/);
  await page.locator("#gr-verdict.ok").waitFor({ timeout: 60_000 });
  assert.match(await page.locator("#gr-verdict").innerText(), /Fair play verified/);
  const all = await heard();
  const heardHands = st.history.slice(handsHeard);
  const expected = ["play", ...(heardHands.some((h) => h.kind !== "draw") ? ["knock", "count"] : []), ...(heardHands.length > 1 ? ["gather", "draw"] : [])];
  for (const name of expected) assert.ok(all.includes(name), `played ${name}`);
  assert.ok(all.some((s) => /^(win|loss)-paper$/.test(s)), "the result chime, in its paper timbre");
  assert.ok(await resultInView(page), "the result fits the phone without scrolling");
  await page.screenshot({ path: `${ARTIFACTS}/gr-14-robot-over.png` });

  // The robot accepts a rematch; dark mode still fits the phone.
  const m = await page.evaluate(() => window.ddp.match.m);
  await page.click("#rematch");
  await wait(page, (n) => window.ddp.match.m === n + 1 && window.ddp.match.phase === "playing", m, 60_000);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/gr-15-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
