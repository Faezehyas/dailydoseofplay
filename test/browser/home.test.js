// Headless-browser test: every game tile on the home page is the same size,
// whatever its description's length, and a phone screen doesn't scroll
// sideways. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

const ARTIFACTS = path.resolve("test-artifacts");
const { games } = JSON.parse(readFileSync("public/games.json", "utf8"));

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

test("home page tiles are all the same size", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];

  for (const width of [1280, 768, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
    await page.goto(`${srv.base}/`);
    await page.locator(".game-card").nth(games.length - 1).waitFor();
    const cards = await page.locator(".game-card").evaluateAll((els) =>
      els.map((card) => {
        const box = card.getBoundingClientRect();
        const p = card.querySelector("p");
        return {
          height: box.height,
          right: box.right,
          metaGap: box.bottom - card.querySelector(".game-meta").getBoundingClientRect().bottom,
          lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)),
          text: p.textContent,
        };
      }),
    );
    assert.equal(cards.length, games.length);
    for (const [i, card] of cards.entries()) {
      const name = `${games[i].slug} at ${width} px`;
      assert.ok(Math.abs(card.height - cards[0].height) < 1, `${name}: height ${card.height}, first card ${cards[0].height}`);
      assert.ok(Math.abs(card.metaGap - cards[0].metaGap) < 1, `${name}: players line and badge sit at the bottom`);
      assert.ok(card.lines <= 2, `${name}: description shows ${card.lines} lines`);
      assert.equal(card.text, games[i].description, `${name}: the full description stays in the DOM`);
      assert.ok(card.right <= width, `${name}: card ends inside the screen`);
    }
    if (width === 360) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal scroll at 360 px");
    }
    await page.screenshot({ path: `${ARTIFACTS}/home-${width}.png`, fullPage: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
});
