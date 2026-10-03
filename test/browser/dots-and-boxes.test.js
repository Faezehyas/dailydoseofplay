// Headless-browser test for Dots and Boxes: two browser contexts play a
// friend match on the host's settings (3×3, clocks, host starts) through the
// invite link over a real WebRTC DataChannel, then a rematch; and a robot
// game on a phone with touch, the keyboard, the pen-stroke replay, sounds
// and the mute button. Skips if Playwright is missing.
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
const wait = (page, fn, arg, timeout = 20_000) => page.waitForFunction(fn, arg, { timeout });
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const pick = (page, name, value) => page.click(`#db-settings label:has(input[name="db-${name}"][value="${value}"])`);
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const state = (page) => page.evaluate(() => window.ddp.match.state);
const armed = (page) => page.evaluate(() => !!document.querySelector("#db-board.armed"));

// A sensible player: take a box when one is offered, else a line that
// gives nothing away, else anything.
const chooseLine = (page) =>
  page.evaluate(() => {
    const st = window.ddp.match.state;
    const n = st.size;
    const H = n * (n + 1);
    const boxLines = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) boxLines.push([r * n + c, (r + 1) * n + c, H + r * (n + 1) + c, H + r * (n + 1) + c + 1]);
    const sides = boxLines.map((ls) => ls.filter((l) => st.lines[l] !== -1).length);
    const free = st.lines.flatMap((v, l) => (v === -1 ? [l] : []));
    const boxesOf = (l) => boxLines.flatMap((ls, b) => (ls.includes(l) ? [b] : []));
    const take = free.find((l) => boxesOf(l).some((b) => sides[b] === 3));
    if (take !== undefined) return take;
    const safe = free.filter((l) => boxesOf(l).every((b) => sides[b] < 2));
    const pool = safe.length ? safe : free;
    return pool[Math.floor(Math.random() * pool.length)];
  });

async function drawLine(page, { tap = false } = {}) {
  const line = await chooseLine(page);
  const target = `#db-board [data-line="${line}"]`;
  await (tap ? page.tap(target) : page.click(target));
  return line;
}

test("two friends play Dots and Boxes on the host's settings through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 240_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    // Reduced motion plays every line out at once, so whole games fit the test.
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  // Host (desktop, light) picks a small board with clocks and starts.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/dots-and-boxes/`);
  assert.equal(await host.locator('#db-settings input[name="db-size"]:checked').getAttribute("value"), "4", "4×4 by default");
  await pick(host, "size", 3);
  await pick(host, "moveSeconds", 30);
  await pick(host, "gameSeconds", 180);
  await pick(host, "first", "host");
  await host.click("#play-friend");
  assert.ok(await host.locator("#db-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/dots-and-boxes/\\?room=${code}$`));

  // The friend (360 px phone, dark) opens the link and plays by touch.
  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await host.locator("#db-board").waitFor();
  await guest.locator("#db-board").waitFor();
  await guest.locator("#db-config").filter({ hasText: "3×3" }).waitFor();
  assert.equal(await guest.locator("#db-config").innerText(), "3×3 boxes · 30 s a line · 3 min each", "the host's settings reach the friend");
  assert.equal(await host.locator("#db-config").innerText(), await guest.locator("#db-config").innerText());
  assert.match(await host.locator(".db-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".db-players").innerText(), /Bo[\s\S]*Ada/);
  assert.equal(await host.locator("#db-board .dot").count(), 16);
  assert.equal(await guest.locator("#db-board .hit").count(), 24, "a tap target for every line");
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    assert.equal(await host.evaluate(() => window.ddp.match.state.first), 0, "the room says the host starts");
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), 0, "both browsers agree");
  }

  // Whoever may draw does, until the board is full; counts extra turns.
  async function finish() {
    let extra = 0;
    const t0 = Date.now();
    while ((await host.evaluate(() => window.ddp.match.phase)) === "playing") {
      if (Date.now() - t0 > 90_000) throw new Error("game did not finish");
      for (const [page, tap] of [[host, false], [guest, true]]) {
        if (!(await armed(page))) continue;
        const before = await state(page);
        await drawLine(page, { tap });
        await wait(page, (n) => window.ddp.match.state.drawn > n, before.drawn);
        const after = await state(page);
        if (after.last.boxes.length && after.winner === -1) {
          assert.equal(after.turn, before.turn, "a box keeps the turn");
          extra++;
        }
      }
      await host.waitForTimeout(20);
    }
    await wait(guest, () => window.ddp.match.phase === "over");
    const [a, b] = [await state(host), await state(guest)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.equal(a.score[0] + a.score[1], 9);
    assert.ok(a.clocks[0] < 180_000 && a.clocks[1] < 180_000, "both clocks ran");
    return { st: a, extra };
  }

  // Game 1: clocks are shown; the host draws first.
  await startedGame(1);
  assert.ok(await host.locator("#db-clocks").isVisible());
  assert.match(await host.locator("#db-status").innerText(), /Your turn/);
  assert.match(await guest.locator("#db-status").innerText(), /Ada's turn/);
  await guest.locator("#db-board .hit").first().tap();
  await guest.locator("#toast").filter({ hasText: "Wait for Ada" }).waitFor();
  const first = await drawLine(host);
  await wait(guest, (l) => window.ddp.match.state.lines[l] === 0, first);
  await guest.locator(`#db-board .line[data-l="${first}"]`).waitFor();
  assert.ok(await guest.locator(`#db-board .line[data-l="${first}"]`).evaluate((n) => n.classList.contains("p1")), "the host's line is teal on the friend's screen");
  await wait(guest, () => !!document.querySelector("#db-board.armed"));
  await guest.screenshot({ path: `${ARTIFACTS}/db-1-friend-mobile-dark.png`, fullPage: true });
  const { st: won, extra } = await finish();
  assert.ok(extra > 0, "someone closed a box and went again");
  const [winner, loser] = won.winner === 0 ? [host, guest] : [guest, host];
  await winner.locator("#db-result").filter({ hasText: "You win!" }).waitFor();
  assert.match(await loser.locator("#db-result").innerText(), /wins$/);
  assert.match(await loser.locator("#db-detail").innerText(), /took \d of 9 boxes/);
  assert.match(await winner.locator("#db-score").innerText(), /You\s+1\s+\S+\s+0/);
  assert.match(await loser.locator("#db-score").innerText(), /You\s+0\s+\S+\s+1/);
  assert.equal(await host.locator("#db-board .box").count(), 9);
  assert.equal(await host.locator("#db-board .box.p0").count(), won.score[0], "your boxes are coral on your screen");
  assert.equal(await guest.locator("#db-board .box.p0").count(), won.score[1], "and theirs are coral on theirs");
  for (const page of [host, guest]) {
    const r = await page.locator("#db-over").boundingBox();
    assert.ok(r && r.y >= 0 && r.y + r.height <= page.viewportSize().height + 1, "the result is on screen");
  }
  await host.screenshot({ path: `${ARTIFACTS}/db-2-friend-over-light.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/db-3-friend-over-mobile-dark.png` });

  // Rematch: host asks, the friend accepts; same settings, a clean sheet.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.tap("#rematch");
  await startedGame(2);
  assert.equal(await host.locator("#db-board .line").count(), 0, "a clean sheet");
  assert.match(await host.locator("#db-note").innerText(), /Rematch #1/);
  const { st: again } = await finish();
  const wins = (p) => (won.winner === p) + (again.winner === p);
  assert.match(await host.locator("#db-score").innerText(), new RegExp(`You\\s+${wins(0)}\\s+Bo\\s+${wins(1)}`));
  assert.ok(await noHorizontalScroll(guest));

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("Dots and Boxes vs the robot on a 360 px phone: touch, keyboard, pen strokes, sounds and mute", { skip: !pw && "Playwright not installed", timeout: 240_000 }, async (t) => {
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
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const heard = () => page.evaluate(() => window.ddpSounds.slice());

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="dots-and-boxes"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "size", 4);
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/db-4-settings-mobile-light.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".db-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#db-config").innerText(), "4×4 boxes · no clocks · Hard robot");
  assert.ok(await page.locator("#db-clocks").isHidden(), "no clocks, no clock row");
  assert.ok(await noHorizontalScroll(page));
  assert.equal(await page.locator(".db-players .p0 .swatch").innerText(), "C", "your initial");

  // Draw by touch: the line strokes itself in, then the robot's is replayed.
  await wait(page, () => !!document.querySelector("#db-board.armed"));
  const mine = await drawLine(page, { tap: true });
  await wait(page, () => window.ddp.match.state.drawn >= 1);
  assert.equal((await state(page)).lines[mine], 0);
  await page.locator("#db-status").filter({ hasText: "Robot" }).waitFor();
  await wait(page, () => window.ddp.match.state.drawn >= 2);
  await page.locator("#db-status").filter({ hasText: "Robot is drawing" }).waitFor();
  assert.equal(await armed(page), false, "you wait while the robot's line is replayed");
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${ARTIFACTS}/db-5-robot-replay-mobile.png` });
  await wait(page, () => !!document.querySelector("#db-board.armed"));
  assert.match(await page.locator("#db-status").innerText(), /Your turn/);
  const robotLine = (await state(page)).last.line;
  assert.ok(await page.locator(`#db-board .line.p1[data-l="${robotLine}"]`).evaluate((n) => n.classList.contains("fresh")), "the robot's latest line is marked");
  let sounds = await heard();
  assert.ok(sounds.filter((n) => n === "line").length >= 2, `a pencil scratch per line: ${sounds.join(" ")}`);
  assert.ok(sounds.includes("turn"), "a chime when your turn comes back");

  // By keyboard: Tab to the board, arrows to a free line, Enter.
  await page.locator("#leave").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "db-board");
  let cursor = null;
  for (let i = 0; i < 12 && !(cursor || "").endsWith("free"); i++) {
    await page.keyboard.press(i % 2 ? "ArrowDown" : "ArrowRight");
    cursor = await page.locator("#db-cursor").innerText();
  }
  assert.match(cursor, /^(Across|Down) from [A-E]\d to [A-E]\d: free$/);
  const drawnBefore = (await state(page)).drawn;
  await page.keyboard.press("Enter");
  await wait(page, (n) => window.ddp.match.state.drawn > n, drawnBefore);
  assert.equal((await state(page)).lines[(await state(page)).last.line], 0);

  // With the sound muted nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  await wait(page, () => !!document.querySelector("#db-board.armed"), undefined, 30_000);
  const before = (await heard()).length;
  await drawLine(page, { tap: true });
  await wait(page, () => !!document.querySelector("#db-board.armed") || window.ddp.match.phase !== "playing", undefined, 30_000);
  assert.equal((await heard()).length, before, "no sound while muted");
  await page.click("#sound-toggle");

  // The rest of the game at speed: reduced motion plays each line out at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const t0 = Date.now();
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    if (Date.now() - t0 > 120_000) throw new Error("game did not finish");
    if (await armed(page)) await drawLine(page, { tap: true });
    else await page.waitForTimeout(40);
  }
  const st = await state(page);
  assert.equal(st.score[0] + st.score[1], 16);
  assert.equal(await page.evaluate(() => window.ddp.robot.match.state.drawn), 40, "the robot saw every line");
  await page.locator("#db-result").waitFor();
  assert.match(await page.locator("#db-result").innerText(), /^(You win!|Robot wins|It's a draw)$/);
  sounds = await heard();
  assert.ok(sounds.includes("box"), "boxes pop with a note");
  assert.ok(sounds.includes(st.winner === 2 ? "draw" : st.winner === 0 ? "win" : "lose"));
  const r = await page.locator("#db-over").boundingBox();
  assert.ok(r.y >= 0 && r.y + r.height <= 740, `the result is on the phone's screen (${Math.round(r.y)}–${Math.round(r.y + r.height)})`);
  await page.screenshot({ path: `${ARTIFACTS}/db-6-robot-over-mobile-light.png` });

  // The robot accepts a rematch; dark mode still fits the phone.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  assert.equal((await state(page)).drawn, 0);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/db-7-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
