// Headless-browser test for Chutes and Ladders: two browser contexts play a
// friend match on the host's settings (bounce back, a 6 spins again, host
// starts) through the invite link over a real WebRTC DataChannel, then a
// rematch; four friends in four browsers through the hub; a robot game on a
// phone with the spinner, hops, sounds, the mute button and the keyboard; and
// a game against three robots. Skips if Playwright is missing.
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
const pick = (page, name, value) => page.click(`#cl-settings label:has(input[name="cl-${name}"][value="${value}"])`);
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const state = (page) => page.evaluate(() => window.ddp.match.state);
// The board has settled: no spin is being played out on screen.
const settled = (page) => wait(page, () => !document.querySelector("#cl-status")?.textContent.match(/Spinning|spinning|moving|Hop|ladder|chute/i));

// Presses Spin whenever this page may, until the game ends.
async function spinUntilOver(page, { tap = false, timeout = 120_000 } = {}) {
  const t0 = Date.now();
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    if (Date.now() - t0 > timeout) throw new Error("game did not finish");
    if (await page.locator("#cl-spin").isEnabled()) await (tap ? page.tap("#cl-spin") : page.click("#cl-spin"));
    await page.waitForTimeout(40);
  }
}

test("two friends play Chutes and Ladders on the host's settings through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 240_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    // Reduced motion plays every spin out at once, so whole games fit the test.
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  // Host (desktop, light) picks the house rules and lets the spinner go by itself.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/chutes-and-ladders/`);
  assert.equal(await host.locator('#cl-settings input[name="cl-finish"]:checked').getAttribute("value"), "exact", "classic rules by default");
  assert.equal(await host.locator('#cl-settings input[name="cl-sixAgain"]:checked').getAttribute("value"), "false");
  await pick(host, "finish", "bounce");
  await pick(host, "sixAgain", true);
  await pick(host, "first", "host");
  await pick(host, "spin", "auto");
  await host.click("#play-friend");
  assert.ok(await host.locator("#cl-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/chutes-and-ladders/\\?room=${code}&key=[\\w-]{22}$`));

  // The friend (360 px phone, dark) opens the link and spins by tapping.
  // The room takes up to four, so the host starts it once Bo is in.
  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  await host.click("#start-game");
  await host.locator("#cl-board").waitFor();
  await guest.locator("#cl-board").waitFor();
  await guest.locator("#cl-config").filter({ hasText: "bounce" }).waitFor();
  assert.equal(await guest.locator("#cl-config").innerText(), "bounce back off 100 · a 6 spins again", "the host's settings reach the friend");
  assert.equal(await host.locator("#cl-config").innerText(), await guest.locator("#cl-config").innerText());
  assert.match(await host.locator(".cl-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".cl-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));
  assert.equal(await host.locator(".cl-board .ladder").count(), 9);
  assert.equal(await host.locator(".cl-board .chute").count(), 10);

  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase !== "starting", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase !== "starting", m);
    assert.equal(await host.evaluate(() => window.ddp.match.state.first), 0, "the room says the host starts");
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), 0, "both browsers agree");
  }
  async function finish() {
    await spinUntilOver(guest, { tap: true }); // the host's spinner goes by itself
    await wait(host, () => window.ddp.match.phase === "over", undefined, 60_000);
    const [a, b] = [await state(host), await state(guest)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.equal(a.pos[a.winner], 100);
    assert.equal(a.finish, "bounce");
    return a;
  }

  // Game 1: the host's spinner spins by itself; the friend must tap.
  await startedGame(1);
  await wait(host, () => window.ddp.match.state.ply >= 1);
  assert.equal(await host.evaluate(() => window.ddp.match.state.last.player), 0, "the host's first spin happened by itself");
  await wait(guest, () => window.ddp.match.state.turn === 1);
  await settled(guest);
  assert.match(await guest.locator("#cl-status").innerText(), /Your turn\. Spin!/);
  assert.ok(await guest.locator("#cl-spin").isEnabled());
  assert.match(await host.locator("#cl-log").innerText(), /You spun \d/);
  assert.match(await guest.locator("#cl-log").innerText(), /Ada spun \d/);
  await guest.screenshot({ path: `${ARTIFACTS}/cl-1-friend-mobile-dark.png`, fullPage: true });
  const won = await finish();
  const [winner, loser] = won.winner === 0 ? [host, guest] : [guest, host];
  await winner.locator("#cl-result").filter({ hasText: "You win!" }).waitFor();
  assert.match(await loser.locator("#cl-result").innerText(), /wins$/);
  assert.match(await loser.locator("#cl-detail").innerText(), /reached 100 in \d+ spins?/);
  assert.match(await winner.locator("#cl-score").innerText(), /You\s+1\s+\S+\s+0/);
  assert.match(await loser.locator("#cl-score").innerText(), /You\s+0\s+\S+\s+1/);
  assert.ok(await winner.locator("#cl-over").isVisible());
  await host.screenshot({ path: `${ARTIFACTS}/cl-2-friend-over-light.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, everyone back on the lawn.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  await startedGame(2);
  assert.match(await host.locator("#cl-note").innerText(), /Rematch #1/);
  const again = await finish();
  assert.match(await host.locator("#cl-score").innerText(), new RegExp(`You\\s+${(won.winner === 0) + (again.winner === 0)}\\s+Bo\\s+${(won.winner === 1) + (again.winner === 1)}`));
  assert.ok(await noHorizontalScroll(guest));

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("Chutes and Ladders vs the robot on a 360 px phone: spinner, hops, sounds, mute and keyboard", { skip: !pw && "Playwright not installed", timeout: 240_000 }, async (t) => {
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
  await page.click('.game-card[data-slug="chutes-and-ladders"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "first", "host");
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/cl-3-settings-mobile-light.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".cl-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#cl-config").innerText(), "exact spin to finish · one spin a turn");
  assert.ok(await noHorizontalScroll(page));
  assert.match(await page.locator(".cl-players .who.p0").innerText(), /start/);

  // Spin by touch: the pointer spins and clicks, then the pawn hops square by square.
  await page.tap("#cl-spin");
  await page.locator("#cl-status").filter({ hasText: "Spinning" }).waitFor();
  assert.ok(await page.locator("#cl-spin").isDisabled(), "one spin at a time");
  await wait(page, () => window.ddp.match.state.ply >= 1);
  const first = (await state(page)).last;
  await wait(page, (n) => document.querySelector("#cl-spin-value").textContent === String(n), first.spin);
  await wait(page, () => window.ddp.match.state.turn === 0 && window.ddp.match.state.ply >= 2, undefined, 30_000);
  await settled(page);
  await page.screenshot({ path: `${ARTIFACTS}/cl-4-robot-mobile-light.png`, fullPage: true });
  const sounds = await heard();
  for (const name of ["flick", "tick", "settle", "hop"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);
  assert.ok(sounds.filter((n) => n === "hop").length >= first.path.length, "a hop sound per square");
  assert.equal(await page.locator("#cl-log li").count(), 2, "both spins are in the log");
  const shownMine = await page.evaluate(() => document.querySelector(".cl-players .who.p0 .where").textContent);
  assert.equal(shownMine, (await state(page)).pos[0] === 0 ? "start" : `square ${(await state(page)).pos[0]}`, "the pawn shows where the rules put it");

  // Spin by keyboard; with the sound muted nothing more plays.
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const before = (await heard()).length;
  await page.locator("#cl-spin").focus();
  await page.keyboard.press("Enter");
  await wait(page, () => window.ddp.match.state.ply >= 3);
  await wait(page, () => window.ddp.match.state.turn === 0 || window.ddp.match.phase !== "playing", undefined, 30_000);
  await settled(page);
  assert.equal((await heard()).length, before, "no sound while muted");
  await page.click("#sound-toggle");

  // The rest of the game at speed: reduced motion plays each spin out at once.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await spinUntilOver(page, { tap: true });
  const st = await state(page);
  assert.equal(st.pos[st.winner], 100);
  assert.equal(await page.evaluate(() => window.ddp.robot.match.state.ply), st.ply, "the robot saw every spin");
  await page.locator("#cl-result").waitFor();
  assert.match(await page.locator("#cl-result").innerText(), /^(You win!|Robot wins)$/);
  assert.ok((await heard()).includes(st.winner === 0 ? "win" : "lose"));
  assert.ok(await page.locator("#cl-over").isVisible());
  await page.screenshot({ path: `${ARTIFACTS}/cl-5-robot-over-light.png`, fullPage: true });

  // The robot accepts a rematch; dark mode still fits the phone.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  assert.deepEqual((await state(page)).pos, [0, 0]);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/cl-6-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});

test("four friends fill a Chutes and Ladders room and play a full game, then a rematch", { skip: !pw && "Playwright not installed", timeout: 240_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    return page;
  }
  const host = await open("Ada");
  await host.goto(`${srv.base}/chutes-and-ladders/`);
  assert.equal(await host.locator("#play-friend").innerText(), "Play with friends");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const friends = [];
  for (const [name, opts] of [["Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" }], ["Cy", {}], ["Di", {}]]) {
    const page = await open(name, opts);
    await page.goto(invite);
    friends.push(page);
  }
  // The fourth player fills the room, so the game starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  for (const p of pages) {
    assert.equal(await p.locator(".cl-board .pawn").count(), 4, "four pawns on the board");
    assert.equal(await p.locator(".cl-players .who").count(), 4);
    assert.equal(await p.locator("#cl-score > div").count(), 4);
  }
  assert.match(await friends[1].locator(".cl-players").innerText(), /Cy \(you\)[\s\S]*Ada[\s\S]*Bo[\s\S]*Di/, "you first, then the others in seat order");
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");
  await friends[0].screenshot({ path: `${ARTIFACTS}/cl-7-four-mobile-dark.png`, fullPage: true });

  async function playOut() {
    await Promise.all(pages.map((p) => spinUntilOver(p)));
    for (const p of pages) await wait(p, () => window.ddp.match.phase === "over", undefined, 60_000);
    const states = await Promise.all(pages.map(state));
    for (const st of states.slice(1)) assert.deepEqual(st, states[0], "all four browsers end on the same state");
    assert.equal(states[0].pos[states[0].winner], 100);
    assert.ok(states[0].spins.every((n) => n > 0), "everyone spun");
    return states[0];
  }
  const won = await playOut();
  const winnerPage = pages[won.winner];
  await winnerPage.locator("#cl-result").filter({ hasText: "You win!" }).waitFor();
  for (const p of pages.filter((p) => p !== winnerPage)) {
    await p.locator("#cl-detail").waitFor();
    assert.match(await p.locator("#cl-detail").innerText(), /reached 100 in \d+ spins?[\s\S]*Behind: .* and .*/);
  }
  await host.screenshot({ path: `${ARTIFACTS}/cl-8-four-over.png`, fullPage: true });

  // A rematch needs all four.
  for (const p of pages.slice(0, 3)) await p.click("#rematch");
  await friends[2].locator("#rematch-status").filter({ hasText: "Ada, Bo and Cy want a rematch!" }).waitFor();
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Di" }).waitFor();
  await friends[2].click("#rematch");
  for (const p of pages) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await playOut();

  // One player leaves: the game ends for the others.
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Cy (left the game|.*lost)/);
  }
  assert.deepEqual(errors, []);
});

test("Chutes and Ladders against three robots", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${srv.base}/chutes-and-ladders/`);
  await pick(page, "robots", 3);
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".cl-players").innerText(), /Robot 1[\s\S]*Robot 2[\s\S]*Robot 3/);
  assert.ok(await noHorizontalScroll(page));
  await spinUntilOver(page);
  const st = await state(page);
  assert.equal(st.players, 4);
  assert.equal(st.pos[st.winner], 100);
  for (let k = 0; k < 3; k++) assert.deepEqual(await page.evaluate((k) => window.ddp.robots[k].match.state, k), st, `robot ${k + 1} agrees`);
  await page.locator("#cl-result").waitFor();
  await page.screenshot({ path: `${ARTIFACTS}/cl-9-three-robots.png`, fullPage: true });
  assert.deepEqual(errors, []);
});
