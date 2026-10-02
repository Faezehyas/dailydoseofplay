// Headless-browser test for Tic Tac Toe: two browser contexts play a friend
// match through the invite link over a real WebRTC DataChannel, then a
// rematch; and a robot game on a phone. Skips if Playwright is missing.
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

test("two friends play Tic Tac Toe through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
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

  // Host (desktop, light) creates a room; the friend (360 px phone, dark) opens the link.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/tic-tac-toe/\\?room=${code}$`));

  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await host.locator("#ttt-board").waitFor();
  await guest.locator("#ttt-board").waitFor();
  assert.match(await host.locator(".ttt-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".ttt-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  // Both browsers agree on the coin toss; the starter plays X.
  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    const first = await host.evaluate(() => window.ddp.match.state.first);
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), first, "both browsers agree who starts");
    const x = first === 0 ? host : guest;
    const o = x === host ? guest : host;
    assert.match(await x.locator("#ttt-status").innerText(), /Your turn\. Place your X/);
    assert.match(await o.locator("#ttt-status").innerText(), /is thinking/);
    return [x, o];
  }

  // Play cells in order, X first, by tapping squares (or by keyboard when asked).
  async function playOut(players, cells, { keyboardAt = -1 } = {}) {
    const base = await moveCount(host);
    for (let k = 0; k < cells.length; k++) {
      const page = players[k % 2];
      await wait(page, () => window.ddp.match.canMove());
      if (k === keyboardAt) {
        // Arrow from the square to the left (wrapping), then Enter.
        const from = cells[k] % 3 === 0 ? cells[k] + 2 : cells[k] - 1;
        await page.locator(`.ttt-cell[data-i="${from}"]`).focus();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("Enter");
      } else {
        await page.click(`.ttt-cell[data-i="${cells[k]}"]`);
      }
      await wait(host, (n) => window.ddp.match.state.moves.length === n, base + k + 1);
      await wait(guest, (n) => window.ddp.match.state.moves.length === n, base + k + 1);
    }
    await wait(host, () => window.ddp.match.phase === "over");
    await wait(guest, () => window.ddp.match.phase === "over");
    assert.deepEqual(await host.evaluate(() => window.ddp.match.state), await guest.evaluate(() => window.ddp.match.state));
  }

  // Game 1: X takes the top row; O plays 3 and 4. O also tries a taken square.
  let [x, o] = await startedGame(1);
  await wait(x, () => window.ddp.match.canMove());
  await x.click('.ttt-cell[data-i="0"]');
  await wait(o, () => window.ddp.match.canMove());
  await o.click('.ttt-cell[data-i="0"]', { force: true }); // aria-disabled, but a tap still lands
  await o.locator("#toast.show").filter({ hasText: "taken" }).waitFor();
  assert.equal(await moveCount(o), 1, "a taken square is refused locally");
  await playOut([o, x], [3, 1, 4, 2], { keyboardAt: 1 });
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.line), [0, 1, 2]);
  assert.equal(await x.locator(".ttt-cell.win").count(), 3);
  assert.equal(await x.locator("#ttt-result").innerText(), "Victory!");
  assert.equal(await o.locator("#ttt-result").innerText(), "Defeat");
  assert.match(await x.locator("#ttt-score").innerText(), /You\s+1\s+Draws\s+0\s+\S+\s+0/);
  assert.match(await o.locator("#ttt-score").innerText(), /You\s+0\s+Draws\s+0\s+\S+\s+1/);
  await host.waitForTimeout(500); // let the last mark finish drawing
  await host.screenshot({ path: `${ARTIFACTS}/ttt-1-win.png`, fullPage: true });
  await guest.screenshot({ path: `${ARTIFACTS}/ttt-2-over-mobile-dark.png`, fullPage: true });

  // Rematch: host asks, the friend accepts, a new coin toss starts game 2.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  [x, o] = await startedGame(2);
  assert.equal(await host.locator(".ttt-cell .mark").count(), 0, "a fresh board");

  // Game 2 is a draw, each move blocking the last threat: O X X / X X O / O O X.
  await playOut([x, o], [4, 0, 2, 6, 3, 5, 1, 7, 8]);
  assert.equal(await host.evaluate(() => window.ddp.match.state.winner), 2);
  assert.equal(await host.locator("#ttt-result").innerText(), "Draw");
  assert.equal(await guest.locator("#ttt-result").innerText(), "Draw");
  assert.match(await host.locator("#ttt-score").innerText(), /Draws\s+1/);
  assert.ok(await noHorizontalScroll(guest));
  await guest.waitForTimeout(500);
  await guest.screenshot({ path: `${ARTIFACTS}/ttt-3-draw-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("a full Tic Tac Toe game vs the robot on a 360 px phone, light then dark", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
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

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="tic-tac-toe"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".ttt-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.ok(await noHorizontalScroll(page));

  // Take a winning square if there is one, else the first free one.
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    await wait(page, () => window.ddp.match.canMove() || window.ddp.match.phase !== "playing");
    const cell = await page.evaluate(() => {
      const { board } = window.ddp.match.state;
      const me = window.ddp.match.me;
      const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
      const free = board.flatMap((v, i) => (v === -1 ? [i] : []));
      if (window.ddp.match.phase !== "playing") return -1;
      return free.find((i) => lines.some((l) => l.includes(i) && l.every((j) => j === i || board[j] === me))) ?? free[0];
    });
    if (cell < 0) break;
    const n = await moveCount(page);
    await page.tap(`.ttt-cell[data-i="${cell}"]`);
    await wait(page, (k) => window.ddp.match.state.moves.length > k, n);
  }
  await wait(page, () => window.ddp.match.phase === "over");
  const st = await page.evaluate(() => window.ddp.match.state);
  const counts = [0, 1].map((p) => st.board.filter((v) => v === p).length);
  assert.ok(Math.abs(counts[0] - counts[1]) <= 1, "the robot made one legal move per turn");
  assert.equal(new Set(st.moves).size, st.moves.length);
  assert.match(await page.locator("#ttt-result").innerText(), /^(Victory!|Defeat|Draw)$/);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${ARTIFACTS}/ttt-4-robot-light.png`, fullPage: true });

  // The robot accepts a rematch, then switch to dark mode.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await wait(page, () => window.ddp.match.state.moves.length > 0 || window.ddp.match.canMove());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${ARTIFACTS}/ttt-5-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
