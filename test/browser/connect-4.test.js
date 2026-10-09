// Headless-browser test for Connect 4: two browser contexts play a friend
// match on the host's settings (8×7, clocks, the friend starts) through the
// invite link over a real WebRTC DataChannel, then a rematch; and robot games
// on a phone, including a loss on the move clock and the 9×9 board.
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
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20_000 });
const moveCount = (page) => page.evaluate(() => window.ddp.match.state.moves.length);
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const pick = (page, name, value) => page.click(`#c4-settings label:has(input[name="c4-${name}"][value="${value}"])`);

test("two friends play Connect 4 on the host's settings through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
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

  // Host (desktop, light) picks an 8×7 board, 20 s a move, 3 min each and
  // the friend to start, then creates a room; the friend (360 px phone,
  // dark) opens the link.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/connect-4/`);
  await pick(host, "size", "8x7");
  await pick(host, "moveSeconds", 20);
  await pick(host, "gameSeconds", 180);
  await pick(host, "first", "guest");
  await host.click("#play-friend");
  assert.ok(await host.locator("#c4-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/connect-4/\\?room=${code}&key=[\\w-]{22}$`));

  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  await host.locator("#c4-board .c4-col").first().waitFor();
  await guest.locator("#c4-board .c4-col").first().waitFor();
  assert.equal(await guest.locator(".c4-col").count(), 8, "the host's board size reaches the friend");
  assert.equal(await guest.locator(".c4-cell").count(), 56);
  assert.equal(await guest.locator("#c4-config").innerText(), "8 × 7, four in a row · 20 s a move · 3 min each");
  assert.equal(await host.locator("#c4-config").innerText(), await guest.locator("#c4-config").innerText());
  assert.match(await host.locator(".pb-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  // Both browsers agree who starts: the friend, by the room's setting, with coral.
  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    const first = await host.evaluate(() => window.ddp.match.state.first);
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), first, "both browsers agree who starts");
    assert.equal(first, 1);
    assert.match(await guest.locator("#c4-status").innerText(), /Your turn\. Drop a coral disc/);
    assert.match(await host.locator("#c4-status").innerText(), /Bo is thinking/);
    return [guest, host];
  }

  // Drop in these columns in order, coral first, by tapping or clicking a
  // column (or by keyboard when asked: arrow in from the column to the left).
  async function playOut(players, cols, { keyboardAt = -1 } = {}) {
    const base = await moveCount(host);
    for (let k = 0; k < cols.length; k++) {
      const page = players[k % 2];
      await wait(page, () => window.ddp.match.canMove());
      if (k === keyboardAt) {
        await page.locator(`.c4-col[data-col="${cols[k] - 1}"]`).focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
      } else if (page === guest) {
        await page.tap(`.c4-col[data-col="${cols[k]}"]`);
      } else {
        await page.click(`.c4-col[data-col="${cols[k]}"]`);
      }
      await wait(host, (n) => window.ddp.match.state.moves.length === n, base + k + 1);
      await wait(guest, (n) => window.ddp.match.state.moves.length === n, base + k + 1);
    }
    await wait(host, () => window.ddp.match.phase === "over");
    await wait(guest, () => window.ddp.match.phase === "over");
    assert.deepEqual(await host.evaluate(() => window.ddp.match.state), await guest.evaluate(() => window.ddp.match.state));
  }

  // Game 1: the friend stacks four in column 0; the host answers in column 1.
  // The host taps out of turn first and is told to wait.
  let [coral, teal] = await startedGame(1);
  assert.ok(await host.locator("#c4-clocks").isVisible());
  assert.match(await host.locator("#c4-clocks").innerText(), /\d:\d\d[\s\S]*\d+ s[\s\S]*\d:\d\d/);
  await teal.click('.c4-col[data-col="4"]', { force: true }); // aria-disabled, but a click still lands
  await teal.locator("#toast.show").filter({ hasText: "Wait for Bo" }).waitFor();
  assert.equal(await moveCount(teal), 0, "an out-of-turn drop is refused locally");
  await playOut([coral, teal], [0, 1, 0, 1, 0, 1, 0]);
  const col0 = await host.evaluate(() => window.ddp.match.state.line);
  assert.deepEqual(col0, [24, 32, 40, 48], "four up column 0 of an 8×7 board");
  assert.equal(await coral.locator(".c4-cell.win").count(), 4);
  assert.equal(await coral.locator("#result").innerText(), "You won");
  assert.equal(await teal.locator("#result").innerText(), "You lost");
  assert.match(await teal.locator("#result-reason").innerText(), /Bo connected four coral discs/);
  assert.match(await coral.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+\S+\s+0/);
  assert.match(await teal.locator("#score").innerText(), /You\s+0\s+Draws\s+0\s+\S+\s+1/);
  const clocks = await host.evaluate(() => window.ddp.match.state.clocks);
  assert.ok(clocks.every((ms) => ms < 180_000 && ms > 120_000), `both clocks were spent: ${clocks}`);
  await host.waitForTimeout(600); // let the last disc land
  await host.screenshot({ path: `${ARTIFACTS}/c4-1-win.png`, fullPage: true });
  await guest.screenshot({ path: `${ARTIFACTS}/c4-2-over-mobile-dark.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, empty board and fresh clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  [coral, teal] = await startedGame(2);
  assert.equal(await host.locator(".c4-disc").count(), 0, "an empty board");
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [180_000, 180_000]);

  // Game 2: the host lines up four along the bottom row, one drop by keyboard.
  await playOut([coral, teal], [0, 3, 0, 4, 7, 5, 7, 2], { keyboardAt: 3 });
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.line), [50, 51, 52, 53]);
  assert.equal(await host.locator("#result").innerText(), "You won");
  assert.equal(await guest.locator("#result").innerText(), "You lost");
  assert.match(await guest.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+Ada\s+1/);
  assert.ok(await noHorizontalScroll(guest));
  await guest.waitForTimeout(600);
  await guest.screenshot({ path: `${ARTIFACTS}/c4-3-rematch-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("Connect 4 vs the robot on a 360 px phone: a full game, a loss on the move clock, and a 9×9 board", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => (globalThis.ddpRobotPace = 0.1));
  await page.clock.install();

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="connect-4"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "size", "7x6");
  await pick(page, "moveSeconds", 10);
  await pick(page, "gameSeconds", 60);
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  // The choice is remembered on this device.
  await page.reload();
  assert.ok(await page.locator('input[name="c4-level"][value="hard"]').isChecked());
  assert.ok(await page.locator('input[name="c4-size"][value="7x6"]').isChecked());
  assert.ok(await page.locator('input[name="c4-moveSeconds"][value="10"]').isChecked());
  await page.screenshot({ path: `${ARTIFACTS}/c4-4-settings-mobile.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#c4-config").innerText(), "7 × 6, four in a row · 10 s a move · 1 min each · Hard robot");
  assert.equal(await page.evaluate(() => window.ddp.match.state.turn), 0, "the room setting says I start");
  assert.ok(await page.locator("#c4-move-left").isVisible());
  assert.ok(await noHorizontalScroll(page));

  // Take a winning column, else block, else the open column nearest the centre.
  async function playRobotGame() {
    while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
      await wait(page, () => window.ddp.match.canMove() || window.ddp.match.phase !== "playing");
      const col = await page.evaluate(() => {
        const { phase, me, state } = window.ddp.match;
        if (phase !== "playing") return -1;
        const { board, heights, cols, rows } = state;
        const open = [...Array(cols).keys()].filter((c) => heights[c] < rows).sort((a, b) => Math.abs(a - (cols - 1) / 2) - Math.abs(b - (cols - 1) / 2));
        const wins = (c, who) => {
          const r0 = rows - 1 - heights[c];
          return [[0, 1], [1, 0], [1, 1], [1, -1]].some(([dr, dc]) => {
            let run = 1;
            for (const s of [1, -1]) {
              for (let r = r0 + dr * s, cc = c + dc * s; r >= 0 && r < rows && cc >= 0 && cc < cols && board[r * cols + cc] === who; r += dr * s, cc += dc * s) run++;
            }
            return run >= 4;
          });
        };
        return open.find((c) => wins(c, me)) ?? open.find((c) => wins(c, 1 - me)) ?? open[0];
      });
      if (col < 0) break;
      const n = await moveCount(page);
      await page.tap(`.c4-col[data-col="${col}"]`);
      await wait(page, (k) => window.ddp.match.state.moves.length > k || window.ddp.match.phase !== "playing", n);
    }
    await wait(page, () => window.ddp.match.phase === "over");
    const st = await page.evaluate(() => window.ddp.match.state);
    const counts = [0, 1].map((p) => st.board.filter((v) => v === p).length);
    assert.ok(Math.abs(counts[0] - counts[1]) <= 1, "the robot made one legal move per turn");
    assert.equal(counts[0] + counts[1], st.moves.length);
    assert.deepEqual(st.heights, [...Array(st.cols).keys()].map((c) => st.moves.filter((m) => m === c).length));
    return st;
  }
  const first = await playRobotGame();
  assert.ok(["line", "draw"].includes(first.reason), first.reason);
  assert.match(await page.locator("#result").innerText(), /^(You won|You lost|Draw)$/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${ARTIFACTS}/c4-5-robot-light.png`, fullPage: true });

  // The robot accepts a rematch. This time let the 10 s move clock run out.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.clock.fastForward(3000);
  await page.screenshot({ path: `${ARTIFACTS}/c4-6-robot-dark-clock.png`, fullPage: true });
  await page.clock.fastForward(8000);
  await wait(page, () => window.ddp.match.phase === "over");
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "timeout");
  assert.equal(await page.locator("#result").innerText(), "You lost");
  assert.equal(await page.locator("#result-reason").innerText(), "Your clock ran out.");
  assert.match(await page.locator("#score").innerText(), /Robot\s+[1-2]/);

  // Back in the lobby: the biggest board still fits a phone, by touch and keyboard.
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  await pick(page, "size", "9x9");
  await pick(page, "moveSeconds", 0);
  await pick(page, "gameSeconds", 0);
  await pick(page, "level", "easy");
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.equal(await page.locator(".c4-cell").count(), 81);
  assert.equal(await page.locator("#c4-config").innerText(), "9 × 9, four in a row · no move limit · no game clock · Easy robot");
  assert.ok(await noHorizontalScroll(page), "9×9 fits at 360 px");
  const box = await page.locator("#c4-board").boundingBox();
  assert.ok(box.width >= 300 && box.width <= 340, `board width ${box.width}`);
  await page.locator('.c4-col[data-col="3"]').focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await wait(page, () => window.ddp.match.state.moves.length === 2);
  assert.equal(await page.evaluate(() => window.ddp.match.state.moves[0]), 4);
  await page.tap('.c4-col[data-col="4"]');
  await wait(page, () => window.ddp.match.state.moves.length === 4);
  assert.equal(await page.evaluate(() => window.ddp.match.state.heights[4] >= 2), true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${ARTIFACTS}/c4-7-robot-9x9-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
