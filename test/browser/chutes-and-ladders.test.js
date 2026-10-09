// Headless-browser test for Chutes and Ladders: two browser contexts play a
// friend match on the host's settings (bounce back, a 6 spins again, host
// starts) through the invite link over a real WebRTC DataChannel, then a
// rematch. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, bg, state, settled, spinUntilOver, skipAutoSpinBeats } from "./chutes-and-ladders.shared.js";

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
    await page.clock.install();
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
  await guest.click("#join-room");
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  await host.click("#start-game");
  await host.locator("#cl-board").waitFor();
  await guest.locator("#cl-board").waitFor();
  await guest.locator("#cl-config").filter({ hasText: "bounce" }).waitFor();
  assert.equal(await guest.locator("#cl-config").innerText(), "bounce back off 100 · a 6 spins again", "the host's settings reach the friend");
  assert.equal(await host.locator("#cl-config").innerText(), await guest.locator("#cl-config").innerText());
  assert.match(await host.locator(".pb-players").innerText(), /Ada[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Ada/);
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
    // The host's spinner goes by itself.
    await Promise.all([spinUntilOver(guest, { tap: true }), skipAutoSpinBeats(host)]);
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
  assert.match(await winner.locator("#score").innerText(), /You\s+1\s+\S+\s+0/);
  assert.match(await loser.locator("#score").innerText(), /You\s+0\s+\S+\s+1/);
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
  assert.match(await host.locator("#score").innerText(), new RegExp(`You\\s+${(won.winner === 0) + (again.winner === 0)}\\s+Bo\\s+${(won.winner === 1) + (again.winner === 1)}`));
  assert.ok(await noHorizontalScroll(guest));

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});
