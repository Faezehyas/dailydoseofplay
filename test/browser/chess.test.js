// Headless-browser test for Chess: two browser contexts play a friend match
// on the host's settings (clocks, host plays White) through the invite link
// over a real WebRTC DataChannel, then a rematch with a promotion and a
// resignation; and a robot game on a 360 px phone, then a loss on the move
// clock. Skips if Playwright is missing.
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
const moveCount = (page) => page.evaluate(() => window.ddp.match.state.moves.length);
const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// The settings fold to a summary line in the lobby card; open it first.
async function pick(page, name, value) {
  if (!(await page.locator("#chess-settings[open]").count())) await page.click("#chess-settings > summary");
  await page.click(`#chess-settings label:has(input[name="chess-${name}"][value="${value}"])`);
}
const sq = (name) => (Number(name[1]) - 1) * 8 + "abcdefgh".indexOf(name[0]);
const square = (page, name) => page.locator(`.sq[data-sq="${sq(name)}"]`);
// Counts recorded piece sounds (short samples; the engine's noise buffers are
// seconds long). Capture clacks are the longer ones. Also counts animations.
const countEffects = () => {
  window.knocks = 0;
  window.clacks = 0;
  window.anims = 0;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    const d = this.buffer?.duration;
    if (d < 0.5) window[d > 0.28 ? "clacks" : "knocks"]++; // knocks are 0.26 s, clacks 0.30 s
    return start.apply(this, args);
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    window.anims++;
    return animate.apply(this, args);
  };
};
const effects = (page) => page.evaluate(() => ({ knocks: window.knocks, clacks: window.clacks, anims: window.anims }));
const knocks = async (page) => (await effects(page)).knocks;

test("two friends play Chess on the host's settings through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 }, ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    await ctx.addInitScript(countEffects);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  // Host (desktop, light) picks 60 s a move, 5 min each and to play White,
  // then creates a room; the friend (360 px phone, dark) opens the link.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/chess/`);
  await pick(host, "moveSeconds", 60);
  await pick(host, "gameSeconds", 300);
  await pick(host, "first", "host");
  await host.click("#play-friend");
  assert.ok(await host.locator("#chess-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/chess/\\?room=${code}&key=[\\w-]{22}$`));

  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  await host.locator("#chess-board .sq").first().waitFor();
  await guest.locator("#chess-board .sq").first().waitFor();
  assert.equal(await guest.locator("#chess-config").innerText(), "60 s a move · 5 min each", "the host's settings reach the friend");
  assert.equal(await host.locator("#chess-config").innerText(), await guest.locator("#chess-config").innerText());
  assert.equal(await guest.evaluate(() => window.ddp.match.rules.config.first), "host");
  assert.match(await host.locator(".pb-players").innerText(), /Ada[\s\S]*Bo/);
  // "Ada vs Bo" stays together, centred over the scoreboard.
  const centre = (page, sel) => page.locator(sel).evaluate((n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; });
  assert.ok(Math.abs((await centre(host, ".pb-players")) - (await centre(host, "#score"))) < 2, "the players are centred");
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    assert.equal(await host.evaluate(() => window.ddp.match.state.white), 0, "the room says the host plays White");
    assert.equal(await guest.evaluate(() => window.ddp.match.state.white), 0, "both browsers agree");
    // Each player sees their own pieces at the bottom.
    assert.equal(await host.locator(".sq").first().getAttribute("data-sq"), String(sq("a8")));
    assert.equal(await guest.locator(".sq").first().getAttribute("data-sq"), String(sq("h1")));
    assert.match(await host.locator("#chess-status").innerText(), /Your move \(White\)/);
    assert.match(await guest.locator("#chess-status").innerText(), /Ada is thinking/);
  }
  async function bothSee(n) {
    await wait(host, (k) => window.ddp.match.state.moves.length === k, n);
    await wait(guest, (k) => window.ddp.match.state.moves.length === k, n);
  }
  // Moves by tapping the piece, then its destination. Both boards animate it.
  async function tapMove(page, from, to) {
    const n = await moveCount(page);
    const before = [(await effects(host)).anims, (await effects(guest)).anims];
    await wait(page, () => window.ddp.match.canMove());
    await square(page, from).click();
    await square(page, to).click();
    await bothSee(n + 1);
    assert.ok((await effects(host)).anims > before[0] && (await effects(guest)).anims > before[1], `${from}-${to} slides on both boards`);
  }

  // Game 1: the fastest mate. The host moves by tap, keyboard and drag; the friend by tap.
  await startedGame(1);
  assert.ok(await host.locator("#chess-clocks").isVisible());
  assert.match(await host.locator("#chess-clocks").innerText(), /5:00[\s\S]*\d+ s[\s\S]*5:00/);
  await tapMove(host, "f2", "f3");
  // The friend tries an impossible pawn move first.
  await wait(guest, () => window.ddp.match.canMove());
  await square(guest, "e7").click();
  assert.equal(await guest.locator(".sq.target").count(), 2, "e6 and e5 are marked");
  await square(guest, "e4").click();
  await guest.locator("#toast.show").filter({ hasText: "can't move there" }).waitFor();
  assert.equal(await moveCount(guest), 1, "an illegal move is refused locally");
  await tapMove(guest, "e7", "e5");
  // Keyboard: from g2, Enter, up twice, Enter.
  await wait(host, () => window.ddp.match.canMove());
  await square(host, "g2").focus();
  await host.keyboard.press("Enter");
  await host.keyboard.press("ArrowUp");
  await host.keyboard.press("ArrowUp");
  assert.equal(await host.evaluate(() => document.activeElement.dataset.sq), String(sq("g4")));
  await host.keyboard.press("Enter");
  await bothSee(3);
  await tapMove(guest, "d8", "h4");
  await wait(host, () => window.ddp.match.phase === "over");
  await wait(guest, () => window.ddp.match.phase === "over");
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state), await guest.evaluate(() => window.ddp.match.state));
  assert.equal(await host.evaluate(() => window.ddp.match.state.moves.map((m) => m.san).join(" ")), "f3 e5 g4 Qh4#");
  await host.waitForTimeout(400); // the last piece lands, then knocks
  assert.deepEqual(await host.evaluate(() => [window.knocks, window.clacks]), [4, 0], "every move lands with a knock");
  assert.equal(await knocks(guest), 4);
  assert.equal(await guest.locator("#result").innerText(), "You won");
  assert.equal(await host.locator("#result").innerText(), "You lost");
  assert.equal(await host.locator("#result-reason").innerText(), "Bo checkmated you with Qh4#.");
  assert.equal(await host.locator(".sq.check").count(), 1, "the mated king is marked");
  assert.match(await host.locator("#score").innerText(), /You\s+0\s+Draws\s+0\s+Bo\s+1/);
  assert.match(await guest.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+\S+\s+0/);
  const clocks = await host.evaluate(() => window.ddp.match.state.clocks);
  assert.ok(clocks.every((ms) => ms < 300_000 && ms > 200_000), `both clocks were spent: ${clocks}`);
  assert.ok(await noHorizontalScroll(guest));
  await host.screenshot({ path: `${ARTIFACTS}/chess-1-mate.png`, fullPage: true });
  await guest.screenshot({ path: `${ARTIFACTS}/chess-2-mate-mobile-dark.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, fresh board and clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  await startedGame(2);
  assert.equal(await moveCount(host), 0, "a fresh board");
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [300_000, 300_000]);

  // Game 2: the friend mutes sounds in the header. A pawn runs through to a8 and becomes
  // a knight (dragged with the mouse), then the friend resigns.
  await guest.click("#sound-toggle");
  for (const [page, from, to] of [[host, "e2", "e4"], [guest, "d7", "d5"], [host, "e4", "d5"], [guest, "c7", "c6"], [host, "d5", "c6"], [guest, "g8", "f6"], [host, "c6", "b7"], [guest, "b8", "d7"]]) {
    await tapMove(page, from, to);
  }
  await wait(host, () => window.ddp.match.canMove());
  const a = await square(host, "b7").boundingBox();
  const b = await square(host, "a8").boundingBox();
  await host.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await host.mouse.down();
  await host.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await host.mouse.up();
  await host.locator("#chess-promo").waitFor();
  assert.equal(await host.locator(".promo-opt").count(), 4);
  await host.screenshot({ path: `${ARTIFACTS}/chess-3-promotion.png` });
  const guestAnims = (await effects(guest)).anims;
  await host.click('.promo-opt[data-promo="n"]');
  await bothSee(9);
  await host.locator("#chess-promo").waitFor({ state: "hidden" });
  assert.equal(await guest.evaluate(() => window.ddp.match.state.moves.at(-1).san), "bxa8=N");
  assert.ok((await effects(guest)).anims >= guestAnims + 3, "the friend sees the pawn slide and the rook knocked off");
  await host.waitForTimeout(400);
  // Four of the nine moves were captures: exd5, dxc6, cxb7 and bxa8=N.
  assert.deepEqual(await host.evaluate(() => [window.knocks, window.clacks]), [4 + 5, 4], "captures clack");
  assert.deepEqual(await guest.evaluate(() => [window.knocks, window.clacks]), [4, 0], "muted: no more sounds");
  assert.match(await host.locator(".chess-taken.mine").innerHTML(), /pc b/, "the host's captures are shown");
  // On the friend's dark page, the black pieces Ada took get a light outline.
  const edge = await guest.locator(".chess-taken.theirs .pc.b").first().evaluate((n) => getComputedStyle(n).stroke);
  assert.equal(edge, "rgb(180, 188, 203)", "captured black pieces stay visible in dark mode");
  await wait(guest, () => window.ddp.match.canMove());
  await guest.click("#resign");
  assert.equal(await guest.locator("#resign").innerText(), "Tap again to resign");
  assert.equal(await moveCount(guest), 9, "one tap does not resign");
  await guest.click("#resign");
  await wait(host, () => window.ddp.match.phase === "over");
  assert.equal(await host.locator("#result").innerText(), "You won");
  assert.equal(await host.locator("#result-reason").innerText(), "Bo resigned.");
  assert.equal(await guest.locator("#result-reason").innerText(), "You resigned.");
  assert.match(await host.locator("#score").innerText(), /You\s+1\s+Draws\s+0\s+Bo\s+1/);
  assert.match(await host.locator("#chess-moves").innerText(), /1\.\s*e4\s*d5[\s\S]*5\.\s*bxa8=N/);
  assert.ok(await noHorizontalScroll(guest));
  await guest.screenshot({ path: `${ARTIFACTS}/chess-4-resign-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("Chess vs the robot on a 360 px phone: a full game, then a loss on the move clock", { skip: !pw && "Playwright not installed", timeout: 300_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "light" });
  await ctx.addInitScript(countEffects);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();

  await page.goto(`${srv.base}/`);
  await page.click('.game-card[data-slug="chess"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "moveSeconds", 30);
  await pick(page, "gameSeconds", 0);
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/chess-5-settings-mobile.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".pb-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#chess-config").innerText(), "30 s a move · no game clock · Hard robot");
  assert.equal(await page.evaluate(() => window.ddp.match.state.white), 0, "the room setting says I play White");
  assert.ok(await page.locator("#chess-move-left").isVisible());
  assert.ok(await noHorizontalScroll(page));

  // Play a full game by tapping: take the most valuable piece on offer, else the first legal move.
  await page.evaluate(async () => {
    window.chessRules = await import("/chess/rules.js");
  });
  let taps = 0;
  const replies = [];
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    await wait(page, () => window.ddp.match.canMove() || window.ddp.match.phase !== "playing");
    const move = await page.evaluate(() => {
      const { match } = window.ddp;
      if (match.phase !== "playing") return null;
      const moves = window.chessRules.listMoves(match.state);
      const value = (m) => [0, 1, 3, 3, 5, 9, 0][match.state.board[m.to] & 7];
      return moves.reduce((best, m) => (value(m) > value(best) ? m : best), moves[0]);
    });
    if (!move) break;
    const n = await moveCount(page);
    await page.tap(`.sq[data-sq="${move.from}"]`);
    await page.tap(`.sq[data-sq="${move.to}"]`);
    if (move.promo) await page.tap(`.promo-opt[data-promo="${move.promo}"]`);
    await wait(page, (k) => window.ddp.match.state.moves.length > k || window.ddp.match.phase !== "playing", n);
    assert.ok(await page.locator("#chess-promo").isHidden(), "the promotion picker closes");
    // How long the robot takes to answer, over its first few replies; then
    // it speeds up for the rest of the game.
    const t0 = Date.now();
    await wait(page, (k) => window.ddp.match.state.moves.length > k + 1 || window.ddp.match.phase !== "playing", n);
    if (replies.length < 4 && (await page.evaluate(() => window.ddp.match.phase)) === "playing") {
      replies.push(Date.now() - t0);
      if (replies.length === 4) await page.evaluate(() => (globalThis.ddpRobotPace = 0.1));
    }
    taps++;
  }
  await wait(page, () => window.ddp.match.phase === "over");
  const st = await page.evaluate(() => window.ddp.match.state);
  assert.ok(st.reason, `the game ended by rule: ${st.reason}`);
  assert.ok(st.moves.length >= 2 * taps - 1, "the robot answered every move");
  const fx = await effects(page);
  assert.ok(fx.knocks + fx.clacks >= st.moves.length - 1, `a sound for every move: ${JSON.stringify(fx)}`);
  assert.ok(fx.clacks > 0, "captures clack");
  assert.ok(Math.min(...replies) >= 250, `the robot never answers instantly: ${replies}`);
  const average = replies.reduce((a, b) => a + b, 0) / replies.length;
  assert.ok(average >= 700, `the robot takes its time: ${Math.round(average)} ms on average`);
  assert.match(await page.locator("#result").innerText(), /^(You won|You lost|Draw)$/);
  assert.ok(await noHorizontalScroll(page));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${ARTIFACTS}/chess-6-robot-light.png`, fullPage: true });

  // The robot accepts a rematch. This time let the 30 s move clock run out.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.clock.fastForward(3000);
  await page.screenshot({ path: `${ARTIFACTS}/chess-7-robot-dark-clock.png`, fullPage: true });
  await page.clock.fastForward(28_000);
  await wait(page, () => window.ddp.match.phase === "over");
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "timeout");
  assert.equal(await page.locator("#result").innerText(), "You lost");
  assert.equal(await page.locator("#result-reason").innerText(), "Your clock ran out.");
  assert.match(await page.locator("#score").innerText(), /Robot\s+[1-2]/);
  await page.screenshot({ path: `${ARTIFACTS}/chess-8-clock-loss-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
