// Headless-browser test: keyboard focus and screen-reader progress in the
// lobby. Each new screen moves focus to its heading, progress is read out from
// one status line, and the first page load leaves focus alone. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { pw, wait } from "./ludo.shared.js";

async function setup(t) {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: "reduce" });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    return page;
  }
  return { srv, open, errors };
}

const focused = (page) => page.evaluate(() => `${document.activeElement.tagName} ${document.activeElement.textContent}`);
const press = async (page, locator, key = "Enter") => (await locator.focus(), page.keyboard.press(key));

test("lobby screens move focus to their heading", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const page = await open("Ada");
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.locator("#play-friend").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, "the first load leaves focus alone");
  assert.equal(await page.locator("#lobby").getAttribute("aria-live"), null, "the lobby isn't one big live region");

  await press(page, page.locator("#play-friend"));
  await page.locator("#room-code").waitFor();
  assert.equal(await focused(page), "H1 Invite a friend");
  await page.locator("#lobby-progress", { hasText: "Waiting for your friend to join…" }).waitFor();

  await press(page, page.getByRole("button", { name: "Cancel" }));
  await page.locator("#play-friend").waitFor();
  assert.equal(await focused(page), "H1 Tic Tac Toe");
  // Tab goes on from the heading to the page's controls.
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "nickname");
  assert.deepEqual(errors, []);
});

test("a 4-seat room reads out who joins and keeps focus after Accept", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
  await press(host, host.locator("#play-friend"));
  await host.locator("#room-code").waitFor();
  assert.equal(await focused(host), "H1 Invite friends");
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const code = (await host.locator("#room-code").innerText()).trim();

  const bo = await open("Bo");
  await bo.goto(invite);
  await press(bo, bo.locator("#join-room"));
  await host.locator("#lobby-progress", { hasText: "Bo joined" }).waitFor();
  await bo.locator("#lobby-progress", { hasText: "Connected!" }).waitFor();

  // A typed code knocks; Accept goes away with its row, and focus stays in the room.
  const cy = await open("Cy");
  await cy.goto(`${srv.base}/ludo/`);
  await cy.locator("#join-code").fill(code);
  await host.locator("#lobby-progress", { hasText: "Cy wants to join" }).waitFor();
  await press(host, host.getByRole("button", { name: "Accept" }));
  await host.locator("#lobby-progress", { hasText: "Cy joined" }).waitFor();
  assert.equal(await focused(host), "H1 Invite friends");

  // Someone leaving mid-game: the overlay's heading takes focus.
  await press(host, host.locator("#start-game"));
  for (const p of [host, bo, cy]) await wait(p, () => window.ddp.match?.phase === "playing");
  await cy.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.equal(await focused(host), "H2 Game ended");
  assert.match(await host.locator("#ended h2").evaluate((h) => document.getElementById(h.getAttribute("aria-describedby")).textContent), /Cy (left the game|.*lost)/);
  await press(host, host.getByRole("button", { name: "Back to lobby" }));
  assert.equal(await focused(host), "H1 Ludo");
  assert.deepEqual(errors, []);
});
