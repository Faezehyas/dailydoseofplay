// Headless-browser test for Backgammon: two browser contexts play a friend
// match on the host's settings (clocks, host starts) through the invite link
// over a real WebRTC DataChannel, then a rematch. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, START, pw, wait, noHorizontalScroll, pick, bg, playTurnByHand, autoplay } from "./backgammon.shared.js";

test("two friends play Backgammon on the host's settings through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 180_000 }, async (t) => {
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

  // Host (desktop, light) picks clocks and to start; the friend (360 px phone, dark) opens the link.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/backgammon/`);
  assert.equal(await host.locator('#bg-settings input[name="bg-moveSeconds"]:checked').getAttribute("value"), "0", "papergames' default: no turn limit");
  assert.equal(await host.locator('#bg-settings input[name="bg-level"]:checked').getAttribute("value"), "easy");
  await pick(host, "moveSeconds", 60);
  await pick(host, "gameSeconds", 300);
  await pick(host, "first", "host");
  await host.click("#play-friend");
  assert.ok(await host.locator("#bg-settings").isHidden(), "settings are only on the home screen");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/backgammon/\\?room=${code}&key=[\\w-]{22}$`));

  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  await host.locator("#bg-board .bg-cell").first().waitFor();
  await guest.locator("#bg-board .bg-cell").first().waitFor();
  await guest.locator("#bg-config").filter({ hasText: "a turn" }).waitFor();
  assert.equal(await guest.locator("#bg-config").innerText(), "1 min a turn · 5 min each", "the host's settings reach the friend");
  assert.equal(await host.locator("#bg-config").innerText(), await guest.locator("#bg-config").innerText());
  assert.match(await host.locator(".pb-players").innerText(), /Ada[\s\S]*Bo/);
  // "Ada vs Bo" stays together, centred over the scoreboard.
  const centre = (page, sel) => page.locator(sel).evaluate((n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; });
  assert.ok(Math.abs((await centre(host, ".pb-players")) - (await centre(host, "#score"))) < 2, "the players are centred");
  assert.match(await guest.locator(".pb-players").innerText(), /Bo[\s\S]*Ada/);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  assert.notEqual(await bg(host), await bg(guest));

  async function startedGame(m) {
    await wait(host, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    await wait(guest, (n) => window.ddp.match.m === n && window.ddp.match.phase === "playing", m);
    assert.equal(await host.evaluate(() => window.ddp.match.state.first), 0, "the room says the host starts");
    assert.equal(await guest.evaluate(() => window.ddp.match.state.first), 0, "both browsers agree");
    assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.pos), [START, START]);
  }
  async function finish() {
    await autoplay(host);
    await autoplay(guest);
    await wait(host, () => window.ddp.match.phase === "over", undefined, 90_000);
    await wait(guest, () => window.ddp.match.phase === "over");
    const [a, b] = [await host.evaluate(() => window.ddp.match.state), await guest.evaluate(() => window.ddp.match.state)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.equal(a.reason, "off");
    assert.equal(a.pos[a.winner][0], 15);
    return a;
  }

  // Game 1: the host's dice roll by themselves; one turn each by hand, then the rest at speed.
  await startedGame(1);
  assert.ok(await host.locator("#bg-clocks").isVisible());
  await wait(host, () => window.ddp.match.state.rolled);
  assert.match(await host.locator("#bg-status").innerText(), /You rolled .* Pick a checker/);
  assert.match(await guest.locator("#bg-status").innerText(), /Ada rolled/);
  assert.ok((await host.locator("#bg-dice .die").count()) >= 2);
  // Pick, move, undo, then play the turn again and confirm.
  await host.click(".bg-cell.src >> nth=0");
  await host.click(".bg-cell.dest >> nth=0");
  assert.ok(await host.locator("#bg-undo").isEnabled());
  await host.click("#bg-undo");
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.pos[0]), START, "undo never touched the real position");
  await playTurnByHand(host);
  await wait(guest, () => window.ddp.match.state.ply === 2);
  assert.deepEqual(await host.evaluate(() => window.ddp.match.state.pos), await guest.evaluate(() => window.ddp.match.state.pos));
  await playTurnByHand(guest, { tap: true });
  await guest.screenshot({ path: `${ARTIFACTS}/bg-1-friend-mobile-dark.png`, fullPage: true });
  const won = await finish();
  const [winner, loser] = won.winner === 0 ? [host, guest] : [guest, host];
  await winner.locator("#bg-result").filter({ hasText: "Victory!" }).waitFor();
  assert.equal(await loser.locator("#bg-result").innerText(), "Defeat");
  assert.match(await loser.locator("#bg-detail").innerText(), /bore off all fifteen checkers/);
  assert.match(await winner.locator("#score").innerText(), /You\s+1\s+\S+\s+0/);
  assert.match(await loser.locator("#score").innerText(), /You\s+0\s+\S+\s+1/);
  assert.ok(won.clocks.every((ms) => ms < 300_000 && ms > 0), `both clocks were spent: ${won.clocks}`);
  await host.screenshot({ path: `${ARTIFACTS}/bg-2-friend-over-light.png`, fullPage: true });

  // Rematch: host asks, the friend accepts; same settings, fresh board and clocks.
  await host.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Bo" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  await startedGame(2);
  assert.deepEqual(await guest.evaluate(() => window.ddp.match.state.clocks), [300_000, 300_000]);
  assert.match(await host.locator("#bg-note").innerText(), /Rematch #1/);
  const again = await finish();
  assert.match(await host.locator("#score").innerText(), new RegExp(`You\\s+${(won.winner === 0) + (again.winner === 0)}\\s+Bo\\s+${(won.winner === 1) + (again.winner === 1)}`));
  assert.ok(await noHorizontalScroll(guest));
  await guest.screenshot({ path: `${ARTIFACTS}/bg-3-rematch-mobile-dark.png`, fullPage: true });

  // The friend closes the tab: the host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});
