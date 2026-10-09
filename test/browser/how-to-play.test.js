// Headless-browser test: every ready game's "How to play" uses the same
// sections in the same order (a game may leave some out), and the lobby's
// "How to play" link opens the panel and moves focus to it. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer } from "../helpers.js";
import { noHorizontalScroll, pw } from "./ludo.shared.js";

const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");
const SECTIONS = ["Goal", "Players", "Setup", "On your turn", "Winning", "Settings and clocks", "Fair play", "Keyboard"];

test("every game's How to play has the same sections, and the lobby link opens it", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const game of GAMES) {
    await page.goto(`${srv.base}/${game.slug}/`);
    const headings = await page.locator("details.rules > h3").allTextContents();
    const order = headings.map((h) => SECTIONS.indexOf(h));
    assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), `${game.name}: ${headings.join(", ")}`);
    assert.ok(headings.includes("Goal") && headings.includes("Winning"), `${game.name}: has a Goal and a Winning section`);

    const panel = page.locator("details.rules");
    assert.equal(await panel.evaluate((d) => d.open), false, `${game.name}: closed on load`);
    await page.locator(".lobby-card #how-to-play-link").click();
    assert.equal(await panel.evaluate((d) => d.open), true, `${game.name}: the link opens the panel`);
    assert.equal(await page.evaluate(() => document.activeElement.matches("details.rules > summary")), true, `${game.name}: focus moves to the panel`);
    assert.ok(await panel.locator("h3").first().isVisible(), `${game.name}: the panel is on screen`);
    const top = await panel.evaluate((d) => d.getBoundingClientRect().top);
    assert.ok(top >= 0 && top < 740, `${game.name}: the panel is scrolled into view (top at ${Math.round(top)})`);
    assert.ok(await noHorizontalScroll(page), `${game.name}: no sideways scroll`);
  }

  // By keyboard: Enter on the link does the same.
  await page.goto(`${srv.base}/ludo/`);
  await page.locator("#how-to-play-link").focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("details.rules").evaluate((d) => d.open), true, "Enter opens the panel");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "How to play");
  assert.deepEqual(errors, []);
});
