// Headless-browser tests: after a robot game of Tic Tac Toe the home page
// shows that game first, labelled "Last played"; a stale value is ignored, and
// the page still works when localStorage throws. Skips if Playwright is missing.
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
const wait = (page, fn) => page.waitForFunction(fn, null, { timeout: 20_000 });

// A full robot game of Tic Tac Toe, taking the first free square each turn.
async function playRobotGame(page, base) {
  await page.goto(`${base}/tic-tac-toe/`);
  await page.click("#play-robot");
  while ((await page.evaluate(() => window.ddp.match?.phase)) !== "over") {
    await wait(page, () => window.ddp.match?.canMove() || window.ddp.match?.phase === "over");
    const cell = await page.evaluate(() => (window.ddp.match.canMove() ? window.ddp.match.state.board.indexOf(-1) : -1));
    if (cell >= 0) await page.click(`.ttt-cell[data-i="${cell}"]`);
  }
}

async function homeTiles(page, base) {
  await page.goto(`${base}/`);
  await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
  return page.locator(".game-card[data-slug]").evaluateAll((els) =>
    els.map((card) => ({ slug: card.dataset.slug, label: card.querySelector(".last-played")?.textContent ?? null })),
  );
}

test("the home page shows the last game played first", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true });
  await ctx.addInitScript(() => (globalThis.ddpRobotPace = 0.1));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  assert.deepEqual(
    (await homeTiles(page, srv.base)).map((c) => c.slug),
    games.map((g) => g.slug),
    "no game played yet: games.json order",
  );
  await playRobotGame(page, srv.base);
  assert.equal(await page.evaluate(() => localStorage.getItem("ddp-last-game")), "tic-tac-toe");

  // Back home by the header link, then at each size and theme.
  await Promise.all([page.waitForURL(`${srv.base}/`), page.click(".brand")]);
  for (const [width, colorScheme] of [[360, "light"], [360, "dark"], [1280, "light"], [1280, "dark"]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    const tiles = await homeTiles(page, srv.base);
    const name = `${width} px, ${colorScheme}`;
    assert.deepEqual(tiles[0], { slug: "tic-tac-toe", label: "Last played" }, `${name}: Tic Tac Toe comes first, labelled`);
    assert.deepEqual(tiles.slice(1).map((c) => c.slug), games.map((g) => g.slug).filter((s) => s !== "tic-tac-toe"), `${name}: the rest keep their order`);
    assert.equal(tiles.filter((c) => c.label).length, 1, `${name}: one label`);
    const heights = await page.locator(".game-card[data-slug]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert.ok(heights.every((h) => Math.abs(h - heights[0]) < 1), `${name}: the labelled tile is the same size as the others`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: no horizontal scroll`);
    await page.screenshot({ path: `${ARTIFACTS}/home-last-played-${width}-${colorScheme}.png` });
  }

  // A slug that isn't a ready game is ignored.
  await page.evaluate(() => localStorage.setItem("ddp-last-game", "no-such-game"));
  const tiles = await homeTiles(page, srv.base);
  assert.deepEqual(tiles.map((c) => c.slug), games.map((g) => g.slug));
  assert.equal(tiles.filter((c) => c.label).length, 0);
  assert.deepEqual(errors, []);
});

test("the home page and a robot game still work when localStorage throws", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    globalThis.ddpRobotPace = 0.1;
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  await playRobotGame(page, srv.base);
  const tiles = await homeTiles(page, srv.base);
  assert.deepEqual(tiles.map((c) => c.slug), games.map((g) => g.slug));
  assert.equal(tiles.filter((c) => c.label).length, 0);
  assert.deepEqual(errors, []);
});
