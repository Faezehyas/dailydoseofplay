// Headless-browser test for Gomoku: two browser contexts play a friend match
// on the host's settings through the invite link over a real WebRTC
// DataChannel, with a rematch and a stalled opponent; and robot games on a
// phone, including a loss on the move clock. Skips if Playwright is missing.
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
const at = (r, c) => r * 15 + c;
const wait = (page, fn, arg, timeout = 20_000) => page.waitForFunction(fn, arg, { timeout });
const moveCount = (page) => page.evaluate(() => window.ddp.match.state.moves.length);
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const pick = (page, name, value) => page.click(`#gmk-settings label:has(input[name="gmk-${name}"][value="${value}"])`);
const point = (i) => `.gmk-cell[data-i="${i}"]`;
// Let the last stone finish growing and any toast fade before a screenshot.
async function settle(page) {
  await page.waitForTimeout(300);
  await page.locator("#toast.show").waitFor({ state: "detached", timeout: 5000 });
}

test("two friends play Gomoku on the host's settings through the invite link, with a rematch and a stalled clock", { skip: !pw && "Playwright not installed", timeout: 150_000 }, async (t) => {
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

  // Host (desktop, light) picks 20 s a move, 3 min each and to start, then
  // creates a room; the friend (360 px phone, dark) opens the link.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/gomoku/`);
  await pick(host, "moveSeconds", 20);
  await pick(host, "gameSeconds", 180);
  await pick(host, "first", "host");
  await host.reload();
  assert.ok(await host.locator('input[name="gmk-moveSeconds"][value="20"]').isChecked(), "the choice is remembered");
  await host.click("#play-friend");
  assert.ok(await host.locator("#gmk-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/gomoku/\\?room=${code}$`));

  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  for (const page of [host, guest]) await wait(page, () => window.ddp.match?.phase === "playing");
  assert.equal(await guest.locator(".gmk-cell").count(), 225);
  assert.equal(await guest.locator("#gmk-config").innerText(), "15 × 15, five in a row · 20 s a move · 3 min each", "the host's settings reach the friend");
  assert.equal(await host.locator("#gmk-config").innerText(), await guest.locator("#gmk-config").innerText());
  assert.deepEqual(await guest.evaluate(() => [window.ddp.match.state.moveMs, window.ddp.match.state.clocks]), [20_000, [180_000, 180_000]]);
  assert.match(await host.locator(".gmk-players").innerText(), /Ada[\s\S]*Bo/);
  // "Ada vs Bo" stays together, centred over the scoreboard.
  const centre = (page, sel) => page.locator(sel).evaluate((n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; });
  assert.ok(Math.abs((await centre(host, ".gmk-players")) - (await centre(host, "#gmk-score"))) < 2, "the players are centred");
  assert.match(await guest.locator(".gmk-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));
  assert.equal(await host.locator('#gmk-board [tabindex="0"]').count(), 1, "the board is one tab stop");

  // Both browsers agree who starts (the host, by the room's setting).
  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    const first = await host.evaluate(() => window.ddp.match.state.first);
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), first, "both browsers agree who starts");
    assert.equal(first, 0);
    assert.match(await host.locator("#gmk-status").innerText(), /Your turn\. Play anywhere/);
    assert.match(await guest.locator("#gmk-status").innerText(), /is thinking/);
  }

  // Alternate moves, host first: the host clicks, the friend taps.
  async function playOut(cells, { keyboardAt = -1 } = {}) {
    const base = await moveCount(host);
    for (let k = 0; k < cells.length; k++) {
      const page = k % 2 ? guest : host;
      await wait(page, () => window.ddp.match.canMove());
      if (k === keyboardAt) {
        // Arrow in from the point to the left, then Enter.
        await page.locator(point(cells[k] - 1)).focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(await page.evaluate(() => document.activeElement.dataset.i), String(cells[k]));
        await page.keyboard.press("Enter");
      } else if (page === guest) {
        await guest.tap(point(cells[k]));
      } else {
        await host.click(point(cells[k]));
      }
      await wait(host, (n) => window.ddp.match.state.moves.length === n, base + k + 1);
      await wait(guest, (n) => window.ddp.match.state.moves.length === n, base + k + 1);
    }
    await wait(host, () => window.ddp.match.phase === "over");
    await wait(guest, () => window.ddp.match.phase === "over");
    assert.deepEqual(await host.evaluate(() => window.ddp.match.state), await guest.evaluate(() => window.ddp.match.state));
  }

  // Game 1: the host lines up five across row 8; the friend plays row 10 and
  // first tries the host's point.
  await startedGame(1);
  assert.ok(await host.locator("#gmk-clocks").isVisible());
  assert.match(await host.locator("#gmk-clocks").innerText(), /\d:\d\d[\s\S]*\d+ s[\s\S]*\d:\d\d/);
  await host.click(point(at(7, 3)));
  await wait(guest, () => window.ddp.match.canMove());
  await guest.tap(point(at(7, 3)), { force: true }); // aria-disabled, but a tap still lands
  await guest.locator("#toast.show").filter({ hasText: "taken" }).waitFor();
  assert.equal(await moveCount(guest), 1, "a taken point is refused locally");
  await guest.tap(point(at(9, 3)));
  await wait(host, () => window.ddp.match.state.moves.length === 2);
  await playOut([at(7, 4), at(9, 4), at(7, 5), at(9, 5), at(7, 6), at(9, 6), at(7, 7)], { keyboardAt: 2 });
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.line), [at(7, 3), at(7, 4), at(7, 5), at(7, 6), at(7, 7)]);
  assert.equal(await host.locator(".gmk-cell.win").count(), 5);
  assert.equal(await host.locator("#gmk-result").innerText(), "Victory!");
  assert.equal(await guest.locator("#gmk-result").innerText(), "Defeat");
  assert.equal(await guest.locator("#gmk-detail").innerText(), "Ada lined up five stones.");
  assert.match(await host.locator("#gmk-score").innerText(), /You\s+1\s+Draws\s+0\s+Bo\s+0/);
  assert.match(await guest.locator("#gmk-score").innerText(), /You\s+0\s+Draws\s+0\s+Ada\s+1/);
  const clocks = await host.evaluate(() => window.ddp.match.state.clocks);
  assert.ok(clocks.every((ms) => ms < 180_000 && ms > 150_000), `both clocks were spent: ${clocks}`);
  await settle(host);
  await settle(guest);
  await host.screenshot({ path: `${ARTIFACTS}/gomoku-1-win.png`, fullPage: true });
  await guest.screenshot({ path: `${ARTIFACTS}/gomoku-2-over-mobile-dark.png`, fullPage: true });

  // Rematch: the host asks, the friend accepts; same settings, fresh board and clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.tap("#rematch");
  await startedGame(2);
  assert.equal(await host.locator('.gmk-cell:not([data-v=""])').count(), 0, "a fresh board");
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [180_000, 180_000]);

  // Game 2: the friend fills the gap in a diagonal and wins with six (an overline).
  await playOut([at(12, 0), at(2, 2), at(12, 2), at(3, 3), at(12, 4), at(4, 4), at(12, 6), at(6, 6), at(12, 8), at(7, 7), at(12, 10), at(5, 5)]);
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.line), [2, 3, 4, 5, 6, 7].map((k) => at(k, k)));
  assert.equal(await guest.locator("#gmk-result").innerText(), "Victory!");
  assert.equal(await guest.locator("#gmk-status").innerText(), "You win with six in a row!");
  assert.equal(await host.locator("#gmk-detail").innerText(), "Bo lined up six stones.");
  assert.match(await host.locator("#gmk-score").innerText(), /You\s+1\s+Draws\s+0\s+Bo\s+1/);
  assert.ok(await noHorizontalScroll(guest));
  await settle(guest);
  await guest.screenshot({ path: `${ARTIFACTS}/gomoku-3-rematch-mobile-dark.png`, fullPage: true });

  // Game 3: the friend's browser goes quiet on its turn (it never sends the
  // forfeit). 5 s past the 20 s limit, the host stops the match.
  await host.click("#rematch");
  await guest.tap("#rematch");
  await startedGame(3);
  await host.click(point(at(7, 7)));
  await wait(guest, () => window.ddp.match.canMove());
  await guest.evaluate(() => (window.ddp.match.play = () => {}));
  await wait(host, () => window.ddp.match.phase === "aborted", undefined, 35_000);
  assert.equal(await host.locator("#gmk-result").innerText(), "Match stopped");
  assert.equal(await host.locator("#gmk-detail").innerText(), "Bo's clock ran out and their browser stopped answering.");
  await wait(guest, () => window.ddp.match.phase === "aborted");
  assert.match(await guest.locator("#gmk-detail").innerText(), /your clock ran out/);

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("Gomoku vs the robot on a 360 px phone: a full game, then a loss on the move clock", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
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
  await page.click('.game-card[data-slug="gomoku"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "moveSeconds", 10);
  await pick(page, "gameSeconds", 0);
  await pick(page, "first", "host");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/gomoku-4-lobby-mobile.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".gmk-players").innerText(), /Cleo[\s\S]*Robot/);
  // On a phone the names use the full width, from the scoreboard's left edge.
  const left = (sel) => page.locator(sel).evaluate((n) => n.getBoundingClientRect().left);
  assert.ok(Math.abs((await left(".gmk-players")) - (await left("#gmk-score"))) < 1, "the names start at the scoreboard's edge");
  assert.equal(await page.locator("#gmk-config").innerText(), "15 × 15, five in a row · 10 s a move · no game clock");
  assert.equal(await page.evaluate(() => window.ddp.match.state.turn), 0, "the room setting says I start");
  assert.ok(await page.locator("#gmk-move-left").isVisible());
  assert.ok(await noHorizontalScroll(page));

  // Take a winning point if there is one, block the robot's if it has one,
  // else grow a line from the centre.
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    await wait(page, () => window.ddp.match.canMove() || window.ddp.match.phase !== "playing");
    const cell = await page.evaluate(() => {
      const { phase, me, state } = window.ddp.match;
      if (phase !== "playing") return -1;
      const { board } = state;
      const fives = (who, i) =>
        [[0, 1], [1, 0], [1, 1], [1, -1]].some(([dr, dc]) => {
          let n = 1;
          for (const s of [1, -1]) {
            for (let k = 1; k < 5; k++) {
              const r = Math.floor(i / 15) + dr * k * s;
              const c = (i % 15) + dc * k * s;
              if (r < 0 || r > 14 || c < 0 || c > 14 || board[r * 15 + c] !== who) break;
              n++;
            }
          }
          return n >= 5;
        });
      const free = board.flatMap((v, i) => (v === -1 ? [i] : []));
      return free.find((i) => fives(me, i)) ?? free.find((i) => fives(1 - me, i)) ?? [112, 113, 111, 114, 110, 97, 127].find((i) => board[i] === -1) ?? free[0];
    });
    if (cell < 0) break;
    const n = await moveCount(page);
    await page.tap(point(cell));
    await wait(page, (k) => window.ddp.match.state.moves.length > k, n);
  }
  await wait(page, () => window.ddp.match.phase === "over");
  const st = await page.evaluate(() => window.ddp.match.state);
  const counts = [0, 1].map((p) => st.board.filter((v) => v === p).length);
  assert.ok(counts[0] - counts[1] === 0 || counts[0] - counts[1] === 1, "the robot made one legal move per turn");
  assert.equal(new Set(st.moves).size, st.moves.length);
  assert.match(await page.locator("#gmk-result").innerText(), /^(Victory!|Defeat|Draw)$/);
  assert.ok(await page.locator("#rematch").isVisible());
  await settle(page);
  await page.screenshot({ path: `${ARTIFACTS}/gomoku-5-robot-light.png`, fullPage: true });

  // The robot accepts a rematch. This time let the 10 s move clock run out.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${ARTIFACTS}/gomoku-6-robot-dark-clock.png`, fullPage: true });
  await wait(page, () => window.ddp.match.phase === "over");
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "timeout");
  assert.equal(await page.locator("#gmk-result").innerText(), "Defeat");
  assert.equal(await page.locator("#gmk-detail").innerText(), "Your clock ran out.");
  assert.match(await page.locator("#gmk-score").innerText(), /Robot\s+[1-2]/);
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
