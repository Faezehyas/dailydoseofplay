// Headless-browser test for default names: two fresh browsers (no nickname
// saved) each get a friendly generated name in the nickname field, play a
// friend game of Tic Tac Toe under those names, and neither ever shows a role
// word (Host, Guest, Friend) as a player. Skips if Playwright is missing.
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
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20_000 });
const DEFAULT = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const ROLE_WORDS = /\b(Host|Guest|Friend)\b/;

test("two fresh browsers play a friend game under friendly default names", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(who, opts) {
    const page = await (await browser.newContext(opts)).newPage();
    page.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
    return page;
  }
  // The default fills the nickname field and is saved, ready to change.
  async function defaultIn(page) {
    const name = await page.locator("#nickname").inputValue();
    assert.match(name, DEFAULT);
    assert.equal(await page.evaluate(() => localStorage.getItem("ddp-name")), name);
    return name;
  }
  const noRoleWords = async (page, what) => assert.doesNotMatch(await page.locator("main").innerText(), ROLE_WORDS, what);

  const host = await open("host", { viewport: { width: 360, height: 760 }, hasTouch: true });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  const hostName = await defaultIn(host);
  await host.reload();
  assert.equal(await host.locator("#nickname").inputValue(), hostName, "the same default comes back");
  await host.click("#play-friend");
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);

  const guest = await open("guest", { viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  await guest.goto(invite);
  const guestName = await defaultIn(guest);
  await guest.click("#join-room");
  for (const page of [host, guest]) await wait(page, () => window.ddp.match?.phase === "playing");

  // Each sees their own name marked "(you)", by seat, and the other's name.
  const pills = (page) => page.locator(".pb-name").allInnerTexts();
  assert.deepEqual(await pills(host), [`${hostName} (you)`, guestName]);
  assert.deepEqual(await pills(guest), [`${guestName} (you)`, hostName]);
  for (const page of [host, guest]) await noRoleWords(page, "during the game");

  // X takes the top row while O plays the middle row.
  const x = (await host.evaluate(() => window.ddp.match.canMove())) ? host : guest;
  const o = x === host ? guest : host;
  for (const [k, cell] of [0, 3, 1, 4, 2].entries()) {
    const page = k % 2 ? o : x;
    await wait(page, () => window.ddp.match.canMove());
    await page.click(`.ttt-cell[data-i="${cell}"]`);
  }
  for (const page of [host, guest]) await wait(page, () => window.ddp.match.phase === "over");
  assert.equal(await x.locator("#result").innerText(), "You won");
  for (const page of [host, guest]) await noRoleWords(page, "after the game");
  assert.deepEqual(errors, []);
});
