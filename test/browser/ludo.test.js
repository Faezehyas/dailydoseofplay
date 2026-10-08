// Headless-browser test for Ludo: two friends play on the host's house rules
// through the invite link and the waiting room's Start button, over a real
// WebRTC DataChannel, then a rematch; and a room where two friends use the
// invite key and a third is let in by the host. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, bg, state, yardCorner, resultInView, autoplay, stopAutoplay } from "./ludo.shared.js";

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
  await guest.click("#join-room");
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
    await page.click("#join-room");
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
