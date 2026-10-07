// Headless-browser test for Ludo: two friends play on the host's house rules
// through the invite link and the waiting room's Start button, over a real
// WebRTC DataChannel, then a rematch; four friends in four browsers fill a
// room and play for places, then one leaves; and a game against three robots
// on a 360 px phone with the die, hops, sounds, the mute button, the
// keyboard and the move timer; and a room where two friends use the invite
// key and a third is let in by the host. Skips if Playwright is missing.
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
const pick = (page, name, value) => page.click(`#ld-settings label:has(input[name="ld-${name}"][value="${value}"])`);
const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const state = (page) => page.evaluate(() => window.ddp.match.state);
// Where this screen draws the yard of a colour: its label's place on the board.
const yardCorner = (page, color) =>
  page.evaluate((c) => {
    const t = document.querySelector(`.yard-label.c-${c} .yard-mark`).transform.baseVal[0].matrix;
    return `${t.f > 300 ? "bottom" : "top"} ${t.e > 300 ? "right" : "left"}`;
  }, color);
// The result box is in view without scrolling.
const resultInView = (page) =>
  page.evaluate(() => {
    const r = document.querySelector(".ld-over-card").getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
  });

// Plays this page's turns in the page itself: rolls, and picks a random movable token.
function autoplay(page) {
  return page.evaluate(() => {
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const roll = document.querySelector("#ld-roll");
      if (roll && !roll.disabled) roll.click();
      const tokens = document.querySelectorAll(".hit-token");
      if (tokens.length) tokens[Math.floor(Math.random() * tokens.length)].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, 30);
  });
}
const stopAutoplay = (page) => page.evaluate(() => clearInterval(window.__autoplay));

test("two friends play Ludo on the host's house rules through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 300_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    // Reduced motion applies every move at once, so whole games fit the test.
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  // Host (laptop, light) turns on blocks and the capture bonus, and starts.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/ludo/`);
  for (const [name, value] of [["threeSixes", "true"], ["blocks", "false"], ["captureBonus", "false"], ["places", "true"], ["moveSeconds", "0"], ["level", "easy"], ["robots", "3"]]) {
    assert.equal(await host.locator(`#ld-settings input[name="ld-${name}"]:checked`).getAttribute("value"), value, `classic default for ${name}`);
  }
  await pick(host, "blocks", true);
  await pick(host, "captureBonus", true);
  await pick(host, "first", "host");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  assert.match(invite, /\/ludo\/\?room=[A-Z0-9]{4}&key=[\w-]{22}$/);

  // The friend (360 px phone, dark) opens the link; the host presses Start with two in.
  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.match(await host.locator("#start-game").innerText(), /2 players/);
  await host.click("#start-game");
  await host.locator("#ld-board").waitFor();
  await guest.locator("#ld-config").filter({ hasText: "blocks on" }).waitFor();
  assert.equal(await guest.locator("#ld-config").innerText(), "three 6s lose the turn · blocks on · a capture rolls again");
  assert.equal(await host.locator("#ld-config").innerText(), await guest.locator("#ld-config").innerText(), "the host's settings reach the friend");
  assert.match(await host.locator(".ld-players").innerText(), /Ada \(you\)[\s\S]*Bo/);
  assert.match(await guest.locator(".ld-players").innerText(), /Bo \(you\)[\s\S]*Ada/);
  // Two players sit opposite: red and yellow, and each sees their own yard bottom left.
  assert.equal(await yardCorner(host, "red"), "bottom left");
  assert.equal(await yardCorner(guest, "yellow"), "bottom left");
  assert.equal(await yardCorner(guest, "red"), "top right");
  assert.equal(await host.locator(".ld-players .who.c-red").count(), 1);
  assert.equal(await guest.locator(".ld-players .who.c-yellow", { hasText: "Bo" }).count(), 1, "Bo is yellow on both screens");
  assert.equal(await host.locator(".ld-players .who.c-yellow", { hasText: "Bo" }).count(), 1);
  assert.equal(await host.locator(".ld-board .pawn").count(), 8);
  assert.equal(await host.locator(".yard.empty").count(), 2, "green and blue sit out");
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  async function startedGame(m) {
    for (const p of [host, guest]) await wait(p, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    assert.equal((await state(host)).first, 0, "the room says the host rolls first");
    assert.equal((await state(guest)).first, 0);
  }
  async function finish() {
    await Promise.all([autoplay(host), autoplay(guest)]);
    for (const p of [host, guest]) await wait(p, () => window.ddp.match.phase === "over", undefined, 120_000);
    await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
    const [a, b] = [await state(host), await state(guest)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.ok(a.tokens[a.winner].every((r) => r === 56));
    assert.deepEqual(a.order.length, 2);
    return a;
  }

  // Game 1. The host must roll; the friend waits.
  await startedGame(1);
  await host.locator("#ld-status").filter({ hasText: "Your turn. Roll the die!" }).waitFor();
  assert.ok(await host.locator("#ld-roll").isEnabled());
  assert.ok(await guest.locator("#ld-roll").isDisabled());
  assert.match(await guest.locator("#ld-status").innerText(), /Ada's turn/);
  await guest.screenshot({ path: `${ARTIFACTS}/ld-1-friend-mobile-dark.png`, fullPage: true });
  const won = await finish();
  const [winner, loser] = won.winner === 0 ? [host, guest] : [guest, host];
  await winner.locator("#ld-result").filter({ hasText: "You win!" }).waitFor();
  assert.match(await loser.locator("#ld-result").innerText(), /wins$/);
  assert.match(await loser.locator("#ld-detail").innerText(), /brought all four home in \d+ rolls/);
  assert.equal(await host.locator("#ld-standings li").count(), 2);
  assert.match(await winner.locator("#ld-score").innerText(), /You\s+1\s+\S+\s+0/);
  assert.match(await loser.locator("#ld-score").innerText(), /You\s+0\s+\S+\s+1/);
  assert.ok(await resultInView(host), "the result shows on a laptop without scrolling");
  assert.ok(await resultInView(guest), "and on a phone");
  await host.screenshot({ path: `${ARTIFACTS}/ld-2-friend-over-light.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/ld-3-friend-over-mobile-dark.png` });

  // Rematch: the host asks, the friend accepts; same settings, everyone back in the yard.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "Ada wants a rematch!" }).waitFor();
  await guest.click("#rematch");
  await startedGame(2);
  assert.deepEqual((await state(host)).tokens, [[-1, -1, -1, -1], [-1, -1, -1, -1]]);
  assert.match(await host.locator("#ld-note").innerText(), /Rematch #1/);
  const again = await finish();
  const wins = (seat) => (won.winner === seat) + (again.winner === seat);
  assert.match(await host.locator("#ld-score").innerText(), new RegExp(`You\\s+${wins(0)}\\s+Bo\\s+${wins(1)}`));

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("four friends fill a Ludo room in four browsers and play for places, then one leaves", { skip: !pw && "Playwright not installed", timeout: 360_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    return page;
  }
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  assert.equal(await host.locator("#play-friend").innerText(), "Play with friends");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const friends = [];
  for (const [name, opts] of [["Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" }], ["Cy", {}], ["Di", {}]]) {
    const page = await open(name, opts);
    await page.goto(invite);
    friends.push(page);
    if (friends.length === 2) {
      // Three in: the host could start now.
      await host.locator("#roster li.ready", { hasText: "Cy" }).waitFor();
      assert.match(await host.locator("#start-game").innerText(), /3 players/);
      assert.ok(await host.locator("#start-game").isEnabled());
    }
  }
  // The fourth player fills the room, so the game starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  const colors = ["red", "green", "yellow", "blue"];
  for (const [seat, p] of pages.entries()) {
    assert.equal(await p.locator(".ld-board .pawn").count(), 16, "sixteen tokens on the board");
    assert.equal(await p.locator(".ld-players .who").count(), 4);
    assert.equal(await p.locator("#ld-score > div").count(), 4);
    assert.equal(await yardCorner(p, colors[seat]), "bottom left", `${colors[seat]} sees their own yard bottom left`);
    // Each player's colour is the same on every screen.
    assert.equal(await p.locator(".ld-players .who.c-green").innerText().then((s) => s.split("\n")[0]), seat === 1 ? "Bo (you)" : "Bo");
  }
  assert.match(await friends[1].locator(".ld-players").innerText(), /Cy \(you\)[\s\S]*Ada[\s\S]*Bo[\s\S]*Di/, "you first, then the others in seat order");
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-4-four-mobile-dark.png`, fullPage: true });

  await Promise.all(pages.map(autoplay));
  // Mid-game, on the phone.
  await wait(friends[0], () => window.ddp.match.state.tokens.flat().filter((r) => r >= 0).length >= 6, undefined, 120_000);
  // Bo only rolls now, until a token waits to be picked.
  await friends[0].evaluate(() => {
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => document.querySelector("#ld-roll:not(:disabled)")?.click(), 30);
  });
  await wait(friends[0], () => document.querySelectorAll(".hit-token").length > 1 || window.ddp.match.phase !== "playing", undefined, 120_000);
  await stopAutoplay(friends[0]);
  await friends[0].waitForTimeout(300);
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-5-four-mobile-midgame.png`, fullPage: true });
  await autoplay(friends[0]);
  for (const p of pages) await wait(p, () => window.ddp.match.phase === "over", undefined, 240_000);
  await Promise.all(pages.map(stopAutoplay));
  const states = await Promise.all(pages.map(state));
  for (const st of states.slice(1)) assert.deepEqual(st, states[0], "all four browsers end on the same state");
  const st = states[0];
  assert.equal(st.order.length, 4);
  for (const p of st.order.slice(0, 3)) assert.ok(st.tokens[p].every((r) => r === 56), "three players finished for places");
  for (const p of pages) {
    await p.locator("#ld-standings").waitFor();
    assert.equal(await p.locator("#ld-standings li").count(), 4);
    assert.match(await p.locator("#ld-standings").innerText(), /1st[\s\S]*2nd[\s\S]*3rd[\s\S]*4th/);
  }
  assert.ok(await resultInView(friends[0]), "the standings fit a phone without scrolling");
  await host.screenshot({ path: `${ARTIFACTS}/ld-6-four-over.png` });
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-7-four-over-mobile.png` });

  // All four agree to a rematch; partway in, one player leaves. The game
  // ends for everyone, and the screen says why and where everyone stood.
  for (const p of pages.slice(0, 3)) await p.click("#rematch");
  await friends[2].locator("#rematch-status").filter({ hasText: "Ada, Bo and Cy want a rematch!" }).waitFor();
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Di" }).waitFor();
  await friends[2].click("#rematch");
  for (const p of pages) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await Promise.all(pages.map(autoplay));
  await wait(host, () => window.ddp.match.state.ply >= 40, undefined, 60_000);
  await Promise.all(pages.map(stopAutoplay));
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Cy (left the game|.*lost)/);
    assert.match(await p.locator("#ld-ended").innerText(), /game is over for all 4 of you[\s\S]*Cy: \d\/4 home \(left\)/);
  }
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-8-four-left-mobile.png` });
  assert.deepEqual(errors, []);
});

test("a four-seat Ludo room: two friends join by the invite key, a third types the code and is let in from the player list", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    return page;
  }
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const code = (await host.locator("#room-code").innerText()).trim();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const friends = [];
  for (const name of ["Bo", "Cy"]) {
    const page = await open(name);
    await page.goto(invite);
    await host.locator("#roster li.ready", { hasText: name }).waitFor();
    friends.push(page);
  }
  assert.equal(await host.locator("#roster li.knock").count(), 0, "keyed guests are never asked about");
  assert.match(await host.locator("#start-game").innerText(), /3 players/);

  const di = await open("Di");
  await di.goto(`${srv.base}/ludo/`);
  await di.fill("#join-code", code);
  await di.click(".join-row button");
  const knock = host.locator("#roster li.knock", { hasText: "Di wants to join" });
  await knock.waitFor();
  assert.match(await host.locator("#roster").innerText(), /Ada\s+host[\s\S]*Bo\s+in[\s\S]*Cy\s+in[\s\S]*Di wants to join/, "the knock sits in the player list");
  assert.match(await host.locator("#start-game").innerText(), /3 players/, "a knock is not a player");
  await knock.getByRole("button", { name: "Accept" }).click();

  // Di fills the room, so the game starts by itself.
  const pages = [host, ...friends, di];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  assert.deepEqual(errors, []);
});

test("Ludo against three robots on a 360 px phone: die, hops, sounds, mute, keyboard and the move timer", { skip: !pw && "Playwright not installed", timeout: 360_000 }, async (t) => {
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
  await page.click('.game-card[data-slug="ludo"]');
  await page.fill("#nickname", "Cleopatra Philopator"); // 20 characters, the longest allowed
  await pick(page, "first", "host");
  await pick(page, "level", "hard");
  await pick(page, "moveSeconds", 10);
  assert.ok(await noHorizontalScroll(page), "settings fit at 360 px");
  await page.screenshot({ path: `${ARTIFACTS}/ld-9-settings-mobile.png`, fullPage: true });
  await page.click("#play-robot");
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.match(await page.locator(".ld-players").innerText(), /Cleo[\s\S]*Robot 1[\s\S]*Robot 2[\s\S]*Robot 3/);
  assert.equal(await page.locator("#ld-config").innerText(), "three 6s lose the turn · no blocks · no capture bonus · play for places · 10 s to move · Hard robots");
  assert.equal(await yardCorner(page, "red"), "bottom left");
  assert.ok(await noHorizontalScroll(page));
  assert.ok(await page.locator("#ld-timer").isVisible(), "the move timer runs");

  // Roll by touch: the die tumbles and lands.
  await page.tap("#ld-roll");
  assert.ok(await page.locator("#ld-die.tumbling").count(), "the die tumbles");
  await page.screenshot({ path: `${ARTIFACTS}/ld-10-robot-rolling.png` });
  await wait(page, () => window.ddp.match.state.ply >= 1);
  const first = (await state(page)).last;
  await wait(page, (v) => document.querySelector("#ld-die .face").dataset.value === String(v), first.value);
  assert.ok((await heard()).includes("dice"), "the die rattles");

  // Keep rolling by touch until a token is out and moves square by square.
  const t0 = Date.now();
  while (!(await heard()).includes("hop")) {
    if (Date.now() - t0 > 120_000) throw new Error("no hop heard");
    if (await page.locator("#ld-roll").isEnabled()) await page.tap("#ld-roll");
    const token = page.locator(".hit-token").first();
    if (await token.count()) await token.dispatchEvent("click").catch(() => {});
    await page.waitForTimeout(60);
  }
  await page.screenshot({ path: `${ARTIFACTS}/ld-11-robot-moving.png` });
  const sounds = await heard();
  for (const name of ["dice", "out", "hop"]) assert.ok(sounds.includes(name), `played ${name}: ${sounds.join(" ")}`);

  // A choice: movable tokens glow and their landing spots show. Pick by keyboard.
  // From here on reduced motion applies moves at once, so the robots keep up.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.__autoplay = setInterval(() => {
      const roll = document.querySelector("#ld-roll");
      if (roll && !roll.disabled && document.querySelectorAll(".pawn.movable").length === 0) roll.click();
    }, 60);
  });
  await wait(page, () => new Set([...document.querySelectorAll(".hit-dest")].map((d) => d.getAttribute("cx") + d.getAttribute("cy"))).size > 1, undefined, 180_000);
  await stopAutoplay(page);
  assert.ok((await page.locator(".pawn.movable").count()) >= 2);
  assert.ok((await page.locator(".dest").count()) >= 2, "each choice shows where it lands");
  await page.locator(".hit-token").first().focus();
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: `${ARTIFACTS}/ld-12-robot-choice.png` });
  assert.ok(await page.locator(".dest.focus").count(), "the focused token's landing spot stands out");
  const chosen = await page.evaluate(() => document.activeElement.classList.contains("hit-token") && Number(document.activeElement.dataset.token));
  assert.equal(typeof chosen, "number", "the arrow key moved focus to another token");
  const ply = (await state(page)).ply;
  await page.keyboard.press("Enter");
  await wait(page, (n) => window.ddp.match.state.ply > n, ply);
  const played = (await state(page)).last;
  assert.deepEqual([played.type, played.player, played.token], ["move", 0, chosen], "Enter moved the focused token");

  // Muted: nothing more plays. Roll with the keyboard.
  await wait(page, () => !document.querySelector("#ld-roll").disabled || window.ddp.match.state.turn !== 0, undefined, 60_000);
  await page.click("#sound-toggle");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  const before = (await heard()).length;
  await wait(page, () => !document.querySelector("#ld-roll").disabled, undefined, 60_000);
  await page.locator("#ld-roll").focus();
  await page.keyboard.press("Enter");
  await wait(page, () => window.ddp.match.state.turn !== 0 || window.ddp.match.state.rolled, undefined, 30_000);
  await page.waitForTimeout(1500);
  assert.equal((await heard()).length, before, "no sound while muted");
  await page.click("#sound-toggle");

  // The move timer: leave the die alone and the game rolls for you.
  await wait(page, () => !document.querySelector("#ld-roll").disabled, undefined, 90_000);
  const waited = (await state(page)).ply;
  await wait(page, (n) => window.ddp.match.state.ply > n, waited, 15_000);
  assert.equal((await state(page)).last.player, 0, "your roll was made for you");
  assert.equal((await state(page)).last.type, "roll");

  // The rest at speed.
  await autoplay(page);
  await wait(page, () => window.ddp.match.phase === "over", undefined, 300_000);
  await stopAutoplay(page);
  const st = await state(page);
  assert.equal(st.players, 4);
  for (let k = 0; k < 3; k++) assert.deepEqual(await page.evaluate((i) => window.ddp.robots[i].match.state, k), st, `robot ${k + 1} agrees`);
  await page.locator("#ld-result").waitFor();
  assert.match(await page.locator("#ld-result").innerText(), /^(You win!|Robot \d wins · you're (2nd|3rd|4th))$/);
  assert.ok((await heard()).includes(st.winner === 0 ? "win" : "lose"));
  assert.ok(await resultInView(page), "the result fits the phone without scrolling");
  await page.screenshot({ path: `${ARTIFACTS}/ld-13-robot-over.png` });

  // The robots accept a rematch; dark mode still fits the phone.
  await page.click("#rematch");
  await wait(page, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  assert.deepEqual((await state(page)).tokens.flat(), Array(16).fill(-1));
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.ok(await noHorizontalScroll(page));
  await page.screenshot({ path: `${ARTIFACTS}/ld-14-robot-dark.png`, fullPage: true });
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});
