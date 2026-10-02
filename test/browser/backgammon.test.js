// Headless-browser test for Backgammon: two browser contexts play a friend
// match on the host's settings (clocks, host starts) through the invite link
// over a real WebRTC DataChannel, then a rematch; and a robot game on a
// phone, played by touch and keyboard, then a loss on the turn clock.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

const ARTIFACTS = path.resolve("test-artifacts");
const START = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"];
  try {
    candidates.push(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {}
  for (const c of candidates.filter(Boolean)) {
    try {
      return require(c);
    } catch {}
  }
  return null;
}

const pw = await loadPlaywright();
const wait = (page, fn, arg, timeout = 20_000) => page.waitForFunction(fn, arg, { timeout });
const ply = (page) => page.evaluate(() => window.ddp.match.state.ply);
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const pick = (page, name, value) => page.click(`#bg-settings label:has(input[name="bg-${name}"][value="${value}"])`);
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// Waits for this page's dice to roll themselves, then plays the whole turn by
// tapping (or clicking) checkers and points, and confirms.
async function playTurnByHand(page, { tap = false } = {}) {
  await wait(page, () => window.ddp.match.canMove() && window.ddp.match.state.rolled);
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  const start = await ply(page);
  for (let k = 0; k < 4 && (await page.locator(".bg-cell.src").count()); k++) {
    if (!(await page.locator(".bg-cell.selected").count())) await press(".bg-cell.src >> nth=0");
    await page.locator(".bg-cell.dest").first().waitFor();
    await press(".bg-cell.dest >> nth=0");
  }
  assert.ok(await page.locator("#bg-confirm").isEnabled(), "the whole roll is played");
  await press("#bg-confirm");
  await wait(page, (n) => window.ddp.match.state.ply > n, start);
}

// Plays this page's side by the robot's choices, at once, until the game ends.
async function autoplay(page, ms = 20) {
  await page.evaluate(async (ms) => {
    const { chooseMove } = await import("/backgammon/robot.js");
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const match = window.ddp.match;
      if (match.phase !== "playing") return clearInterval(window.__autoplay);
      if (match.canMove()) match.play({ ...chooseMove(match.state, match.me, Math.random, { level: "medium" }), ms });
    }, 10);
  }, ms);
}

test("two friends play Backgammon on the host's settings through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  // Host (desktop, light) picks clocks and to start; the friend (360 px phone, dark) opens the link.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/backgammon/`);
  assert.equal(await host.locator('#bg-settings input[name="bg-moveSeconds"]:checked').getAttribute("value"), "0", "papergames' default: no turn limit");
  assert.equal(await host.locator('#bg-settings input[name="bg-level"]:checked').getAttribute("value"), "easy");
  await pick(host, "moveSeconds", 60);
  await pick(host, "gameSeconds", 300);
  await pick(host, "first", "host");
  await host.click("#play-friend");
  assert.ok(await host.locator("#bg-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/backgammon/\\?room=${code}$`));

  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await host.locator("#bg-board .bg-cell").first().waitFor();
  await guest.locator("#bg-board .bg-cell").first().waitFor();
  await guest.locator("#bg-config").filter({ hasText: "a turn" }).waitFor();
  assert.equal(await guest.locator("#bg-config").innerText(), "1 min a turn · 5 min each", "the host's settings reach the friend");
  assert.equal(await host.locator("#bg-config").innerText(), await guest.locator("#bg-config").innerText());
  assert.match(await host.locator(".bg-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".bg-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    assert.equal(await host.evaluate(() => window.ddp.match.state.first), 0, "the room says the host starts");
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), 0, "both browsers agree");
    assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.pos), [START, START]);
  }
  async function finish() {
    await autoplay(host);
    await autoplay(guest);
    await wait(host, () => window.ddp.match.phase === "over", undefined, 90_000);
    await wait(guest, () => window.ddp.match.phase === "over");
    const [a, b] = [await host.evaluate(() => window.ddp.match.state), await guest.evaluate(() => window.ddp.match.state)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.equal(a.reason, "off");
    assert.equal(a.pos[a.winner][0], 15);
    return a;
  }

  // Game 1: the host's dice roll by themselves; one turn each by hand, then the rest at speed.
  await startedGame(1);
  assert.ok(await host.locator("#bg-clocks").isVisible());
  await wait(host, () => window.ddp.match.state.rolled);
  assert.match(await host.locator("#bg-status").innerText(), /You rolled .* Pick a checker/);
  assert.match(await guest.locator("#bg-status").innerText(), /Ada rolled/);
  assert.ok((await host.locator("#bg-dice .die").count()) >= 2);
  // Pick, move, undo, then play the turn again and confirm.
  await host.click(".bg-cell.src >> nth=0");
  await host.click(".bg-cell.dest >> nth=0");
  assert.ok(await host.locator("#bg-undo").isEnabled());
  await host.click("#bg-undo");
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.pos[0]), START, "undo never touched the real position");
  await playTurnByHand(host);
  await wait(guest, () => window.ddp.match.state.ply === 2);
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.pos), await guest.evaluate(() => window.ddp.match.state.pos));
  await playTurnByHand(guest, { tap: true });
  await guest.screenshot({ path: `${ARTIFACTS}/bg-1-friend-mobile-dark.png`, fullPage: true });
  const won = await finish();
  const [winner, loser] = won.winner === 0 ? [host, guest] : [guest, host];
  await winner.locator("#bg-result").filter({ hasText: "Victory!" }).waitFor();
  assert.equal(await loser.locator("#bg-result").innerText(), "Defeat");
  assert.match(await loser.locator("#bg-detail").innerText(), /bore off all fifteen checkers/);
  assert.match(await winner.locator("#bg-score").innerText(), /You\s+1\s+\S+\s+0/);
  assert.match(await loser.locator("#bg-score").innerText(), /You\s+0\s+\S+\s+1/);
  assert.ok(won.clocks.every((ms) => ms < 300_000 && ms > 0), `both clocks were spent: ${won.clocks}`);
  await host.screenshot({ path: `${ARTIFACTS}/bg-2-friend-over-light.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, fresh board and clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  await startedGame(2);
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [300_000, 300_000]);
  assert.match(await host.locator("#bg-note").innerText(), /Rematch #1/);
  const again = await finish();
  assert.match(await host.locator("#bg-score").innerText(), new RegExp(`You\\s+${(won.winner === 0) + (again.winner === 0)}\\s+Bo\\s+${(won.winner === 1) + (again.winner === 1)}`));
  assert.ok(await noHorizontalScroll(guest));
  await guest.screenshot({ path: `${ARTIFACTS}/bg-3-rematch-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("Backgammon vs the robot on a 360 px phone: a full game by touch and keyboard, then a loss on the turn clock", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
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
  assert.match(await page.locator(".bg-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#bg-config").innerText(), "30 s a turn · no game clock · Hard robot");
  assert.equal(await page.evaluate(() => window.ddp.match.state.turn), 0, "the room setting says I start");
  assert.ok(await page.locator("#bg-move-left").isVisible());
  assert.ok(await noHorizontalScroll(page));

  // Turn 1 by touch.
  await playTurnByHand(page, { tap: true });
  // The robot answers: its dice and its checkers move.
  await wait(page, () => window.ddp.match.state.turn === 0 && window.ddp.match.state.ply >= 4);
  assert.notDeepEqual(await page.evaluate(() => window.ddp.match.state.pos[1]), START, "the robot moved");

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
  await page.locator("#bg-confirm").focus();
  await page.keyboard.press("Enter");
  await wait(page, (n) => window.ddp.match.state.ply > n, start);
  await page.screenshot({ path: `${ARTIFACTS}/bg-5-robot-mobile-light.png`, fullPage: true });

  // The rest of the game at speed: the robot keeps its own pace.
  await autoplay(page, 50);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 120_000);
  const st = await page.evaluate(() => window.ddp.match.state);
  assert.equal(st.reason, "off");
  assert.equal(st.pos[st.winner][0], 15);
  assert.equal(await page.evaluate(() => window.ddp.robot.match.state.ply), st.ply, "the robot saw every move");
  assert.match(await page.locator("#bg-result").innerText(), /^(Victory!|Defeat)$/);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${ARTIFACTS}/bg-6-robot-over-light.png`, fullPage: true });

  // The robot accepts a rematch. This time let the 30 s turn clock run out.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await wait(page, () => window.ddp.match.state.rolled);
  await page.click(".bg-cell.src >> nth=0");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${ARTIFACTS}/bg-7-robot-dark-clock.png`, fullPage: true });
  await wait(page, () => window.ddp.match.phase === "over", undefined, 45_000);
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "timeout");
  assert.equal(await page.locator("#bg-result").innerText(), "Defeat");
  assert.equal(await page.locator("#bg-detail").innerText(), "Your clock ran out.");
  assert.match(await page.locator("#bg-score").innerText(), /Robot\s+[1-2]/);
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
