// Headless-browser test for nickname rules: the lobby says why a nickname
// isn't used, never stores it, and in a friend game neither player sees a
// blocked name. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

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
const names = (page) => page.evaluate(() => window.ddp.session.players.map((p) => p.name));

test("the lobby explains a blocked nickname, and a friend game shows friendly default names instead", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, opts = {}) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts })).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  // On a phone: each kind of problem gets its own line under the field, and a good name clears it.
  const host = await open("host", { viewport: { width: 360, height: 760 }, hasTouch: true });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  const problem = host.locator("#nickname-problem");
  assert.equal(await problem.isVisible(), false);
  for (const [typed, why] of [["sh1t", /kinder/], ["evil.com", /links or @handles/], ["Bo!", /only letters/]]) {
    await host.fill("#nickname", typed);
    assert.match(await problem.innerText(), why, typed);
  }
  await host.fill("#nickname", "Ada");
  assert.equal(await problem.isVisible(), false);
  assert.equal(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");

  // A blocked name is never stored, and the host plays under a default name.
  await host.fill("#nickname", "f.u.c.k");
  await host.locator("#nickname").blur();
  assert.equal(await host.evaluate(() => localStorage.getItem("ddp-name")), null);
  await host.click("#play-friend");
  const invite = await host.locator("#invite-link").inputValue();

  // A name stored before this rule existed is not used either.
  const guest = await open("guest");
  await guest.addInitScript(() => localStorage.setItem("ddp-name", "BigAss"));
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  await guest.waitForFunction(() => window.ddp.session, null, { timeout: 20_000 });
  await host.waitForFunction(() => window.ddp.session, null, { timeout: 20_000 });
  const [hostName, guestName] = await names(host);
  assert.deepEqual(await names(guest), [hostName, guestName]);
  for (const name of [hostName, guestName]) assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  for (const page of [host, guest]) assert.doesNotMatch(await page.locator("body").innerText(), /f\.u\.c\.k|BigAss/);
  assert.deepEqual(errors, []);
});

test("a friend opening an invite link picks a nickname before joining", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    if (nickname) await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  const host = await open("host", "Ada");
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const code = (await host.locator("#room-code").innerText()).trim();

  // A returning friend sees their saved name, ready to change.
  const returning = await open("returning", "Cy");
  await returning.goto(invite);
  assert.equal(await returning.locator("#nickname").inputValue(), "Cy");
  await returning.close();

  // A first-time friend gets the card, not a connection, until they press Join.
  const guest = await open("guest");
  await guest.goto(invite);
  await guest.locator("#join-room").waitFor();
  assert.match(await guest.locator("#lobby").innerText(), new RegExp(`invited to room ${code}`));
  assert.match(await guest.locator("#nickname").inputValue(), /^[A-Z][a-z]+ [A-Z][a-z]+$/, "a default name, ready to change");
  assert.equal(await guest.evaluate(() => window.ddp.room), null, "nothing connects before Join");
  assert.match(await host.locator("#lobby-status").innerText(), /Waiting for your friend/);

  await guest.fill("#nickname", "Bo");
  await guest.press("#nickname", "Enter");
  await guest.waitForFunction(() => window.ddp.session, null, { timeout: 20_000 });
  await host.waitForFunction(() => window.ddp.session, null, { timeout: 20_000 });
  assert.deepEqual(await names(host), ["Ada", "Bo"]);
  assert.deepEqual(await names(guest), ["Ada", "Bo"]);
  assert.equal(await guest.evaluate(() => localStorage.getItem("ddp-name")), "Bo", "the name is kept for next time");
  assert.deepEqual(errors, []);
});

test("a toast with a 20-letter nickname stays on a 360px screen", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }

  // W is the widest letter, so this is the longest a one-word name gets.
  const long = "W".repeat(20);
  const host = await open("host", long);
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const guest = await open("guest", long);
  await guest.goto(invite);
  await guest.click("#join-room");
  for (const page of [host, guest]) await page.waitForFunction(() => window.ddp.match?.phase === "playing", null, { timeout: 20_000 });

  // Whoever waits taps a square and is told to wait for the other long name.
  const waiting = (await host.evaluate(() => window.ddp.match.canMove())) ? guest : host;
  await waiting.locator(".ttt-cell").first().click({ force: true }); // aria-disabled, but still tappable
  const toast = waiting.locator("#toast.show");
  await toast.filter({ hasText: `Wait for ${long}` }).waitFor();
  await waiting.waitForTimeout(300); // let the slide-in transition finish
  // Both the pill and the words in it: a long name can spill out of a narrow pill.
  const [box, text] = await toast.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [node, range].map((r) => r.getBoundingClientRect()).map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
  });
  for (const [what, r] of Object.entries({ box, text })) {
    assert.ok(r.left >= 16 && r.right <= 360 - 16, `toast ${what} spans ${r.left}..${r.right}`);
    assert.ok(r.top >= 0 && r.bottom <= 780, `toast ${what} spans ${r.top}..${r.bottom} vertically`);
  }
  assert.ok(text.left >= box.left && text.right <= box.right, "the words stay inside the pill");
  assert.deepEqual(errors, []);
});
