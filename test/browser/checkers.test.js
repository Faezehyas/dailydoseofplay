// Headless-browser test for Checkers: two browser contexts play a friend
// match on the host's settings (clocks, host starts) through the invite link
// over a real WebRTC DataChannel, then a rematch the friend loses on the move
// clock; a full robot game on a phone; a robot that moves first on a
// plain-http page without WebCrypto; move sounds with the mute button; and a
// move dot centred where a piece was just captured. Skips if Playwright is missing.
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
// The settings fold to a summary line in the lobby card; open it first.
async function pick(page, name, value) {
  if (!(await page.locator("#ck-settings[open]").count())) await page.click("#ck-settings > summary");
  await page.click(`#ck-settings label:has(input[name="ck-${name}"][value="${value}"])`);
}
const square = (sq) => `.ck-sq[data-sq="${sq}"]`;

// The path the page's player should play now: the robot's best move at
// `level`, or the first legal move ("first"). Loaded from the page's own modules.
function nextPath(page, level) {
  return page.evaluate(async (level) => {
    const match = window.ddp.match;
    if (level === "first") {
      const { legalMoves } = await import("/checkers/rules.js");
      return legalMoves(match.state.board, match.me)[0];
    }
    const { chooseMove } = await import("/checkers/robot.js");
    return chooseMove(match.state, match.me, Math.random, { level, randomChance: 0 }).path;
  }, level);
}

// Play a path on the board: tap or click each square, or use the keyboard.
async function playPath(page, path, how) {
  for (const sq of path) {
    if (how === "tap") await page.tap(square(sq));
    else if (how === "click") await page.click(square(sq));
    else {
      // Keyboard (host, so the board is not turned): from the dark square two
      // columns over in the same row, arrow across, then Enter.
      const fromLeft = (sq & 7) >= 2;
      await page.locator(square(fromLeft ? sq - 2 : sq + 2)).focus();
      await page.keyboard.press(fromLeft ? "ArrowRight" : "ArrowLeft");
      assert.equal(await page.evaluate(() => Number(document.activeElement.dataset.sq)), sq);
      await page.keyboard.press("Enter");
    }
  }
}

test("two friends play Checkers on the host's settings through the invite link, then a rematch lost on the clock", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
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

  // Host (desktop, light) picks 1 min a move, 5 min each and to start, then
  // creates a room. The friend (360 px phone, dark) has other settings saved,
  // and a clock we can move forward later.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/checkers/`);
  await pick(host, "moveSeconds", 60);
  await pick(host, "gameSeconds", 300);
  await pick(host, "first", "host");
  await host.click("#play-friend");
  assert.ok(await host.locator("#ck-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/checkers/\\?room=${code}&key=[\\w-]{22}$`));

  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.addInitScript(() => localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 30, gameSeconds: 0, first: "guest", level: "hard" })));
  await guest.clock.install();
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  await wait(host, () => window.ddp.match?.phase === "playing");
  await wait(guest, () => window.ddp.match?.phase === "playing");
  assert.equal(await guest.locator("#ck-config").innerText(), "8 × 8 checkers · 1 min a move · 5 min each", "the host's settings reach the friend");
  assert.equal(await host.locator("#ck-config").innerText(), await guest.locator("#ck-config").innerText());
  const guestState = await guest.evaluate(() => window.ddp.match.state);
  assert.equal(guestState.moveMs, 60_000);
  assert.deepEqual(guestState.clocks, [300_000, 300_000]);
  assert.equal(guestState.first, 0, "the host starts, as the host's settings say");
  assert.match(await host.locator(".pb-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));
  // Each player sees their own men at the bottom.
  const bottomLeft = (page) => page.evaluate(() => Number(document.querySelectorAll("#ck-board .ck-sq")[56].dataset.sq));
  assert.equal(await bottomLeft(host), 56);
  assert.equal(await bottomLeft(guest), 7);
  assert.equal(await host.locator(".ck-sq .piece.a").count(), 12, "the starter's pieces");
  assert.match(await host.locator("#ck-status").innerText(), /^Your turn\.$/);
  assert.match(await guest.locator("#ck-status").innerText(), /Ada is thinking/);
  assert.ok(await host.locator("#ck-clocks").isVisible());
  assert.match(await host.locator("#ck-clocks").innerText(), /5:00[\s\S]*\d+ s[\s\S]*5:00/);

  // Game 1: the host plays strong moves (the first by keyboard), the friend the
  // first legal move each time, by touch. Once, the friend tries a piece that
  // can't capture while a capture is due.
  let triedWrongPiece = false;
  for (let k = 0; ; k++) {
    if ((await host.evaluate(() => window.ddp.match.phase)) !== "playing") break;
    const hostTurn = (await host.evaluate(() => window.ddp.match.state.turn)) === 0;
    const page = hostTurn ? host : guest;
    await wait(page, () => window.ddp.match.canMove());
    const n = await moveCount(page);
    if (!hostTurn && !triedWrongPiece) {
      const wrong = await guest.evaluate(async () => {
        const { legalMoves, isJump, owner, EMPTY } = await import("/checkers/rules.js");
        const { board } = window.ddp.match.state;
        const legal = legalMoves(board, 1);
        if (!isJump(legal[0])) return -1;
        return board.findIndex((v, sq) => v !== EMPTY && owner(v) === 1 && !legal.some((m) => m[0] === sq));
      });
      if (wrong >= 0) {
        triedWrongPiece = true;
        await guest.tap(square(wrong), { force: true }); // aria-disabled, but a tap still lands
        await guest.locator("#toast.show").filter({ hasText: "You must capture" }).waitFor();
        assert.equal(await moveCount(guest), n, "nothing was played");
      }
    }
    const pathNow = await nextPath(page, hostTurn ? "hard" : "first");
    if (k === 0) {
      // Pick, put back with Escape, then play by keyboard.
      await playPath(host, pathNow.slice(0, 1), "keyboard");
      assert.equal(await host.locator(".ck-sq.picked").count(), 1);
      await host.keyboard.press("Escape");
      assert.equal(await host.locator(".ck-sq.picked").count(), 0);
      await playPath(host, pathNow, "keyboard");
    } else await playPath(page, pathNow, hostTurn ? "click" : "tap");
    await wait(host, (m) => window.ddp.match.state.moves.length === m, n + 1);
    await wait(guest, (m) => window.ddp.match.state.moves.length === m, n + 1);
    assert.ok(k < 200, "the game ends");
  }
  await wait(host, () => window.ddp.match.phase === "over");
  await wait(guest, () => window.ddp.match.phase === "over");
  assert.ok(triedWrongPiece, "a forced capture came up");
  const final = await host.evaluate(() => window.ddp.match.state);
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state), final, "both browsers agree on every move");
  assert.equal(final.winner, 0, `the strong side wins (${final.reason})`);
  assert.ok(final.clocks.every((ms) => ms < 300_000 && ms > 0), `both clocks were spent: ${final.clocks}`);
  assert.equal(await host.locator("#result").innerText(), "You won");
  assert.equal(await guest.locator("#result").innerText(), "You lost");
  assert.match(await guest.locator("#result-reason").innerText(), /Ada captured all your pieces|You have no legal move left/);
  assert.match(await host.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+Bo\s+0/);
  assert.match(await guest.locator("#score").innerText(), /You\s+0\s+Draws\s+0\s+Ada\s+1/);
  await host.waitForTimeout(700); // let the last capture fade
  await host.screenshot({ path: `${ARTIFACTS}/checkers-1-win.png`, fullPage: true });
  await guest.screenshot({ path: `${ARTIFACTS}/checkers-2-over-mobile-dark.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, fresh board and clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.tap("#rematch");
  await wait(host, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await wait(guest, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  assert.equal(await guest.locator(".ck-sq .piece:not(.ghost)").count(), 24, "a fresh board");
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [300_000, 300_000]);

  // Game 2: the host moves, then the friend's 1-minute move clock runs out.
  await wait(host, () => window.ddp.match.canMove());
  await playPath(host, await nextPath(host, "hard"), "click");
  await wait(guest, () => window.ddp.match.canMove());
  await guest.tap(square((await nextPath(guest, "first"))[0]));
  assert.equal(await guest.locator(".ck-sq.picked").count(), 1);
  assert.ok(await noHorizontalScroll(guest));
  await guest.screenshot({ path: `${ARTIFACTS}/checkers-3-rematch-picked-mobile-dark.png`, fullPage: true });
  await guest.clock.fastForward("01:01");
  await wait(host, () => window.ddp.match.phase === "over");
  await wait(guest, () => window.ddp.match.phase === "over");
  const timedOut = await host.evaluate(() => window.ddp.match.state);
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state), timedOut);
  assert.equal(timedOut.reason, "timeout");
  assert.equal(timedOut.winner, 0);
  assert.equal(await guest.locator("#result").innerText(), "You lost");
  assert.equal(await guest.locator("#result-reason").innerText(), "Your clock ran out.");
  assert.equal(await host.locator("#result-reason").innerText(), "Bo's clock ran out.");
  assert.match(await host.locator("#score").innerText(), /You\s+2\s+Draws\s+0\s+Bo\s+0/);
  await guest.screenshot({ path: `${ARTIFACTS}/checkers-4-clock-loss-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("Checkers vs the robot on a 360 px phone: a full game by touch, then a rematch in dark mode", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
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

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="checkers"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  assert.equal(await page.locator('#ck-settings input[name="ck-level"]:checked').getAttribute("value"), "easy", "Easy is the default level");
  await pick(page, "first", "host");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/checkers-5-lobby-mobile-light.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#ck-config").innerText(), "8 × 8 checkers · no move limit · no game clock · Easy robot");
  assert.ok(await page.locator("#ck-clocks").isHidden(), "no clocks by default");
  assert.equal(await page.evaluate(() => window.ddp.match.state.turn), 0, "the room setting says I start");
  assert.ok(await noHorizontalScroll(page));

  // Tap out strong moves until the game ends; the robot answers each one.
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    await wait(page, () => window.ddp.match.canMove() || window.ddp.match.phase !== "playing");
    if ((await page.evaluate(() => window.ddp.match.phase)) !== "playing") break;
    const n = await moveCount(page);
    await playPath(page, await nextPath(page, "hard"), "tap");
    await wait(page, (k) => window.ddp.match.state.moves.length > k, n);
    if (n === 20) await page.screenshot({ path: `${ARTIFACTS}/checkers-6-robot-midgame-light.png`, fullPage: true });
  }
  await wait(page, () => window.ddp.match.phase === "over");
  const st = await page.evaluate(() => window.ddp.match.state);
  assert.equal(st.winner, 0, `beating the Easy robot (${st.reason})`);
  assert.equal(await page.locator("#result").innerText(), "You won");
  assert.match(await page.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+Robot\s+0/);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${ARTIFACTS}/checkers-7-robot-win-light.png`, fullPage: true });

  // The robot accepts a rematch; switch to dark mode and play a couple of moves.
  await page.tap("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  for (let k = 0; k < 2; k++) {
    await wait(page, () => window.ddp.match.canMove());
    const n = await moveCount(page);
    await playPath(page, await nextPath(page, "hard"), "tap");
    await wait(page, (m) => window.ddp.match.state.moves.length >= m + 2, n);
  }
  assert.ok(await noHorizontalScroll(page));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${ARTIFACTS}/checkers-8-robot-dark.png`, fullPage: true });

  // A double jump, set up on both sides' boards: 56 over 49 to 42, over 35 to 28.
  await wait(page, () => window.ddp.match.canMove());
  await page.evaluate(() => {
    const board = Array(64).fill(-1);
    Object.assign(board, { 56: 0, 62: 0, 49: 1, 35: 1, 8: 1 });
    for (const match of [window.ddp.match, window.ddp.robot.match]) match.state.board = board.slice();
    window.ddp.match.emit("update");
  });
  assert.match(await page.locator("#ck-status").innerText(), /You must capture/);
  assert.deepEqual(await page.locator(".ck-sq.can").evaluateAll((els) => els.map((e) => Number(e.dataset.sq))), [56], "only the piece that can jump");
  await page.tap(square(56));
  await page.tap(square(42));
  assert.equal(await page.locator("#ck-status").innerText(), "Keep jumping!");
  assert.equal(await page.locator(`${square(56)} .piece`).count(), 0, "the piece is drawn where it has got to");
  assert.equal(await page.locator(`${square(42)} .piece`).count(), 1);
  assert.equal(await page.locator(".ck-sq.taking").count(), 1);
  assert.equal(await page.locator(".ck-sq.target").count(), 1);
  await page.screenshot({ path: `${ARTIFACTS}/checkers-9-keep-jumping-dark.png`, fullPage: true });
  await page.tap(square(56)); // back to the start square: start over
  assert.equal(await page.locator(".ck-sq.picked").count(), 0);
  await page.tap(square(56));
  assert.deepEqual(await page.locator(".ck-sq.end").evaluateAll((els) => els.map((e) => Number(e.dataset.sq))), [28], "where the jump ends is marked");
  await page.screenshot({ path: `${ARTIFACTS}/checkers-10-jump-end-marked-dark.png`, fullPage: true });
  const n = await moveCount(page);
  await page.tap(square(28)); // the last landing square plays the whole jump
  await wait(page, (k) => window.ddp.match.state.moves.length > k, n);
  assert.deepEqual(await page.evaluate(() => window.ddp.match.state.moves.at(-1)), [56, 42, 28]);
  await wait(page, (k) => window.ddp.robot.match.state.moves.length > k, n);
  assert.deepEqual(await page.evaluate(() => window.ddp.match.state.board), await page.evaluate(() => window.ddp.robot.match.state.board));
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});

test("the robot moves first on a plain-http page without WebCrypto (http://0.0.0.0, a LAN IP)", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const ctx = await browser.newContext();
  // Browsers only give secure origins (https, localhost) crypto.subtle.
  await ctx.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "subtle", { get: () => undefined });
    localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 0, gameSeconds: 0, first: "guest", level: "hard" }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${srv.base}/checkers/`);
  assert.equal(await page.evaluate(() => crypto.subtle), undefined);
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.state?.moves.length === 1);
  assert.equal(await page.evaluate(() => window.ddp.match.state.first), 1, "the robot started");
  assert.equal(await page.locator("#ck-status").innerText(), "Your turn.");
  await playPath(page, await nextPath(page, "first"), "click");
  await wait(page, () => window.ddp.match.state.moves.length === 3);
  assert.deepEqual(errors, []);
});

test("moves play a wooden clack, and the mute button silences them", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const ctx = await browser.newContext();
  // Count the oscillators started (one per clack) and remember the context state.
  await ctx.addInitScript(() => {
    window.soundLog = { clacks: 0, state: null };
    const proto = BaseAudioContext.prototype;
    const create = proto.createOscillator;
    proto.createOscillator = function (...args) {
      window.soundLog.clacks++;
      window.soundLog.state = this.state;
      return create.apply(this, args);
    };
    localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 0, gameSeconds: 0, first: "host", level: "easy" }));
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${srv.base}/checkers/`);
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.canMove());
  const clacks = () => page.evaluate(() => window.soundLog.clacks);
  assert.equal(await clacks(), 0, "nothing plays before a move");

  // My move, then the robot's: each lands with a clack.
  await playPath(page, await nextPath(page, "first"), "click");
  await wait(page, () => window.soundLog.clacks >= 1);
  assert.equal(await page.evaluate(() => window.soundLog.state), "running");
  const afterMine = await clacks();
  await wait(page, () => window.ddp.match.canMove());
  assert.ok((await clacks()) > afterMine, "the robot's move sounds too");

  // Muted from the header: moves are silent.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const muted = await clacks();
  const n = await moveCount(page);
  await playPath(page, await nextPath(page, "first"), "click");
  await wait(page, (k) => window.ddp.match.state.moves.length >= k + 2 && window.ddp.match.canMove(), n);
  assert.equal(await clacks(), muted, "no sound while muted");
  assert.deepEqual(errors, []);
});

test("a move dot stays centred on a square where a piece was just captured", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem("ddp-checkers-settings", JSON.stringify({ moveSeconds: 0, gameSeconds: 0, first: "host", level: "easy" })));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${srv.base}/checkers/`);
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.canMove());
  // The robot just jumped 19 -> 33 over my man on 26; my man on 40 can now jump to 26.
  await page.evaluate(() => {
    const board = Array(64).fill(-1);
    Object.assign(board, { 33: 1, 40: 0, 42: 0, 10: 1, 62: 0 });
    for (const match of [window.ddp.match, window.ddp.robot.match]) {
      match.state.board = board.slice();
      match.state.moves = [[19, 33]];
    }
    window.ddp.match.emit("update");
  });
  assert.equal(await page.locator(`${square(26)} .piece.ghost`).count(), 1, "the captured man fades out");
  await page.click(square(40));
  const layout = await page.evaluate(() => {
    const cell = document.querySelector('.ck-sq[data-sq="26"]');
    const box = (r) => [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
    return {
      target: cell.classList.contains("target"),
      rows: getComputedStyle(cell).gridTemplateRows.split(" ").length,
      dotArea: getComputedStyle(cell, "::after").gridArea,
      cell: box(cell.getBoundingClientRect()),
      ghost: box(cell.querySelector(".piece.ghost").getBoundingClientRect()),
    };
  });
  assert.ok(layout.target);
  assert.equal(layout.rows, 1, "the ghost and the dot share one grid cell");
  assert.match(layout.dotArea, /^1 \/ 1/);
  assert.deepEqual(layout.ghost, layout.cell, "and both sit in the middle of the square");
  assert.deepEqual(errors, []);
});
