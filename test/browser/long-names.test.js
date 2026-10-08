// Headless-browser test: the longest one-word nicknames stay on a phone
// screen in a friend game of tic-tac-toe. body has overflow-x: hidden, so a
// line that runs off the edge is clipped, not scrollable: scrollWidth can't
// see it, and an element's box can stay inside while its text spills out.
// So the checks measure the text itself, with a Range. Skips if Playwright
// is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";
import { NAME_MAX } from "../../public/engine/names.js";

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
const LONG = "W".repeat(NAME_MAX);

// Where the text of `selector` lies on screen, and whether it is cut short with an ellipsis.
const textSpan = (page, selector) =>
  page.locator(selector).evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const { left, right } = range.getBoundingClientRect();
    return { text: node.textContent, left, right, width: innerWidth, ellipsis: getComputedStyle(node).textOverflow === "ellipsis" };
  });

async function assertOnScreen(page, selector) {
  const t = await textSpan(page, selector);
  assert.ok(t.left >= 0 && t.right <= t.width, `${selector} "${t.text}" spans ${Math.round(t.left)}..${Math.round(t.right)} on a ${t.width} px screen`);
}

test("a 20-letter nickname stays on a 360 px screen in the status, note and rematch lines", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), LONG);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }
  const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20_000 });

  const host = await open("host");
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const guest = await open("guest");
  await guest.goto(invite);
  await guest.click("#join-room");
  const pages = [host, guest];
  for (const page of pages) await wait(page, () => window.ddp.match?.phase === "playing");

  // The player waiting sees "<name> is thinking…", and the coin toss names whoever starts.
  const first = await host.evaluate(() => window.ddp.match.state.turn);
  const [mover, waiter] = first === 0 ? [host, guest] : [guest, host];
  assert.match(await waiter.locator("#ttt-status").innerText(), new RegExp(`^${LONG} is thinking`));
  assert.match(await waiter.locator("#ttt-note").innerText(), new RegExp(`${LONG} starts`));
  for (const page of pages) {
    await assertOnScreen(page, "#ttt-status");
    await assertOnScreen(page, "#ttt-note");
  }

  // The scoreboard label for the opponent is cut short instead.
  const label = await textSpan(waiter, "#ttt-score .theirs dt");
  assert.ok(label.ellipsis, "the opponent's score label ends in an ellipsis");
  const box = await waiter.locator("#ttt-score .theirs dt").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 360, "the score label's box is on screen");

  // The first player lines up the top row: "<name> wins this round."
  const cells = [0, 3, 1, 4, 2];
  for (let k = 0; k < cells.length; k++) {
    const page = k % 2 === 0 ? mover : waiter;
    await wait(page, () => window.ddp.match.canMove());
    await page.tap(`.ttt-cell[data-i="${cells[k]}"]`);
    await wait(page, (n) => window.ddp.match.state.moves.length === n, k + 1);
  }
  for (const page of pages) await wait(page, () => window.ddp.match.phase === "over");
  assert.match(await waiter.locator("#ttt-status").innerText(), new RegExp(`^${LONG} wins`));
  await assertOnScreen(waiter, "#ttt-status");

  // A rematch request: "<name> wants a rematch!"
  await mover.click("#rematch");
  await waiter.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await assertOnScreen(waiter, "#rematch-status");
  await assertOnScreen(mover, "#rematch-status");
  assert.deepEqual(errors, []);
});
