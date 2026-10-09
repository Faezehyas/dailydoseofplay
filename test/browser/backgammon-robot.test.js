// Headless-browser test for Backgammon: a robot game on a phone, played by
// touch, keyboard and drag; a race the game plays for you; a forced turn it
// plays and ends for you; then a loss on the turn clock. Skips if Playwright
// is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, START, pw, wait, ply, noHorizontalScroll, pick, playTurnByHand, setPosition, autoplay } from "./backgammon.shared.js";

test("Backgammon vs the robot on a 360 px phone: a game by touch, keyboard and drag, a race played for you, then a loss on the clock", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const sounds = new Map();
  page.on("response", (r) => r.url().includes("/backgammon/sounds/") && sounds.set(r.url().split("/").pop(), r.status()));
  await page.clock.install();

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="backgammon"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "moveSeconds", 30);
  await pick(page, "gameSeconds", 0);
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/bg-4-settings-mobile-light.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  // On a phone the names use the full width, from the scoreboard's left edge.
  const left = (sel) => page.locator(sel).evaluate((n) => n.getBoundingClientRect().left);
  assert.ok(Math.abs((await left(".pb-players")) - (await left("#score"))) < 1, "the names start at the scoreboard's edge");
  assert.equal(await page.locator("#bg-config").innerText(), "30 s a turn · no game clock · Hard robot");
  assert.equal(await page.evaluate(() => window.ddp.match.state.turn), 0, "the room setting says I start");
  assert.ok(await page.locator("#bg-move-left").isVisible());
  assert.ok(await noHorizontalScroll(page));

  // Turn 1 by touch.
  await playTurnByHand(page, { tap: true });
  // The robot answers: its checkers fly one at a time, then all of them land.
  await page.locator(".checker.ghost").first().waitFor({ timeout: 10_000 });
  await wait(page, () => window.ddp.match.state.turn === 0 && window.ddp.match.state.ply >= 4);
  await wait(page, () => !document.querySelector(".checker.ghost, .pending"));
  assert.notDeepEqual(await page.evaluate(() => window.ddp.match.state.pos[1]), START, "the robot moved");
  // Its last play stays marked on the checkers it moved: a ring on each that arrived.
  await page.locator(".checker.theirs.arrived").first().waitFor();
  assert.deepEqual([...sounds.values()].filter((code) => code !== 200), [], "every sound loads");
  assert.ok([...sounds.keys()].some((f) => f.startsWith("checker-")) && [...sounds.keys()].some((f) => f.startsWith("dice-")));

  // Turn 2 by keyboard: arrows move between points, Enter picks a checker, Space drops it.
  await wait(page, () => window.ddp.match.canMove() && window.ddp.match.state.rolled);
  await page.locator('.bg-cell[data-n="12"]').focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.n), "11");
  await page.keyboard.press("ArrowUp");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.n), "14");
  const start = await ply(page);
  while (await page.locator(".bg-cell.src").count()) {
    if (!(await page.locator(".bg-cell.selected").count())) {
      await page.locator(".bg-cell.src").first().focus();
      await page.keyboard.press("Enter");
    }
    await page.locator(".bg-cell.dest").first().focus();
    await page.keyboard.press(" ");
  }
  if (await page.locator("#bg-undo").isEnabled()) {
    await page.locator("#bg-confirm").focus();
    await page.keyboard.press("Enter");
  }
  await wait(page, (n) => window.ddp.match.state.ply > n, start);

  // Turn 3 by dragging: a checker dropped off the board goes back, one dropped on a point lands there.
  await wait(page, () => window.ddp.match.canMove() && window.ddp.match.state.rolled);
  await page.locator(".bg-cell.src").first().waitFor();
  const centreOf = async (loc) => {
    const b = await loc.boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const [sx, sy] = await centreOf(page.locator(".bg-cell.src .checker.top").first());
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 30, sy - 40, { steps: 5 });
  assert.equal(await page.locator(".checker.ghost.held").count(), 1, "the checker is in your hand");
  assert.ok(await page.locator(".bg-cell.dest").count(), "where it can go is shown");
  await page.mouse.move(10, 10, { steps: 5 });
  await page.mouse.up();
  await wait(page, () => !document.querySelector(".checker.ghost, .pending"));
  assert.equal(await page.locator("#bg-undo").isEnabled(), false, "nothing moved");
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const [dx, dy] = await centreOf(page.locator(".bg-cell.dest").first());
  await page.mouse.move(dx, dy, { steps: 8 });
  await page.mouse.up();
  await wait(page, () => !document.querySelector(".checker.ghost, .pending"));
  assert.ok((await page.locator("#bg-dice .die.used").count()) >= 1, "the dropped checker was played");
  await page.screenshot({ path: `${ARTIFACTS}/bg-5-robot-mobile-light.png`, fullPage: true });

  // The rest of the game at speed, the robot too (its usual pause lets the
  // checks above catch its checkers in flight).
  await page.evaluate(() => (globalThis.ddpRobotPace = 0.1));
  await autoplay(page, 50);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 120_000);
  const st = await page.evaluate(() => window.ddp.match.state);
  assert.equal(st.reason, "off");
  assert.equal(st.pos[st.winner][0], 15);
  assert.equal(await page.evaluate(() => window.ddp.robot.match.state.ply), st.ply, "the robot saw every move");
  await page.locator("#result").waitFor();
  assert.match(await page.locator("#result").innerText(), /^(You won|You lost)$/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${ARTIFACTS}/bg-6-robot-over-light.png`, fullPage: true });

  // Rematch: a race home. The test puts the same race position on both sides
  // before the first roll; the game then offers to move for you.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await setPosition(page, { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 2 }, { 6: 3, 5: 3, 4: 3, 3: 3, 2: 3 });
  await page.locator("#bg-offer").waitFor();
  assert.match(await page.locator("#bg-offer").innerText(), /race/);
  await page.screenshot({ path: `${ARTIFACTS}/bg-7-race-offer-light.png`, fullPage: true });
  // No thanks: you move this turn yourself, and the offer doesn't come back.
  await page.tap("#bg-auto-no");
  assert.ok(await page.locator("#bg-offer").isHidden());
  await playTurnByHand(page, { tap: true });
  await wait(page, () => window.ddp.match.canMove() && window.ddp.match.state.rolled);
  assert.ok(await page.locator("#bg-offer").isHidden(), "asked once a game");
  // Changed your mind: the game moves for you to the end, and the robot
  // keeps the same quick pace (its usual pause is 800 ms, at full pace).
  assert.equal(await page.locator("#bg-auto").innerText(), "Play for me");
  await page.evaluate(() => {
    globalThis.ddpRobotPace = 1;
    window.__robotPauses = [];
    let sent = 0;
    window.ddp.match.on("events", ({ player, events }) => {
      if (player === 0 && events[0].type === "play") sent = performance.now();
      if (player === 1 && events[0].type === "roll" && sent) window.__robotPauses.push(performance.now() - sent);
    });
  });
  await page.tap("#bg-auto");
  await page.locator("#bg-status").filter({ hasText: "Moving for you" }).waitFor();
  assert.equal(await page.locator("#bg-auto").innerText(), "Stop");
  await wait(page, () => window.ddp.match.phase === "over", undefined, 60_000);
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "off");
  assert.equal(await page.evaluate(() => window.ddp.robot.match.state.ply), await ply(page), "the robot checked every move");
  const pauses = await page.evaluate(() => window.__robotPauses);
  assert.ok(pauses.length && pauses.every((ms) => ms < 650), `the robot raced too: ${pauses.map(Math.round)}`);
  await page.evaluate(() => (globalThis.ddpRobotPace = 0.1));

  // Another rematch: your last checker on your 1 point, so whatever you roll
  // there is only one way to play it. The game plays it and ends your turn.
  await page.locator("#rematch").click();
  await wait(page, () => window.ddp.match.m === 3 && window.ddp.match.phase === "playing");
  await setPosition(page, { 1: 1 }, { 6: 15 });
  await page.locator("#bg-status").filter({ hasText: "only one way to play it" }).waitFor();
  assert.ok(await page.locator("#bg-offer").isHidden(), "no race offer for a forced turn");
  assert.equal(await page.locator("#bg-undo").isEnabled(), false);
  await wait(page, () => window.ddp.match.phase === "over");
  assert.equal(await page.evaluate(() => window.ddp.match.state.winner), 0);
  await page.locator("#toast").filter({ hasText: "Only one way to play" }).waitFor();
  await page.locator("#result").waitFor();
  assert.equal(await page.locator("#result").innerText(), "You won");

  // The robot accepts another rematch. This time let the 30 s turn clock run out.
  await page.locator("#rematch").click();
  await wait(page, () => window.ddp.match.m === 4 && window.ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await wait(page, () => window.ddp.match.state.rolled);
  await page.click(".bg-cell.src >> nth=0");
  await page.clock.fastForward(1500);
  await page.screenshot({ path: `${ARTIFACTS}/bg-8-robot-dark-clock.png`, fullPage: true });
  await page.clock.fastForward(30_000);
  await wait(page, () => window.ddp.match.phase === "over");
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "timeout");
  await page.locator("#result").waitFor();
  assert.equal(await page.locator("#result").innerText(), "You lost");
  assert.equal(await page.locator("#result-reason").innerText(), "Your clock ran out.");
  assert.match(await page.locator("#score").innerText(), /Robot\s+[1-4]/);
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
