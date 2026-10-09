// Headless-browser tests: a ready game's home tile swaps its icon for a short
// preview of the game on hover or keyboard focus, plays it once and plays it
// again next time, without changing size; on a touch screen it plays once as
// the tile scrolls into view; with reduced motion, or without a preview, the
// icon stays. Skips if Playwright is missing.
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
const ready = games.filter((g) => g.status === "ready");

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

// The tile's preview, if it has been swapped in: its animations' play states
// and when the last one ends.
function preview(page, slug) {
  return page.evaluate((slug) => {
    const svg = document.querySelector(`.game-card[data-slug="${slug}"] .game-icon svg.tile-preview`);
    if (!svg) return null;
    const animations = svg.getAnimations({ subtree: true });
    return {
      states: [...new Set(animations.map((a) => a.playState))],
      end: Math.max(...animations.map((a) => a.effect.getComputedTiming().endTime)),
      hidden: svg.getAttribute("aria-hidden"),
    };
  }, slug);
}

const tileSize = (page, slug) => page.locator(`.game-card[data-slug="${slug}"]`).evaluate((e) => [e.offsetWidth, e.offsetHeight]);

async function openHome(browser, srv, errors, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...options });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${srv.base}/`);
  await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
  return page;
}

test("hovering or focusing a tile plays its game's preview", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];

  for (const colorScheme of ["light", "dark"]) {
    for (const width of [1280, 360]) {
      const page = await openHome(browser, srv, errors, { viewport: { width, height: 900 }, colorScheme });
      const fetched = [];
      page.on("request", (r) => r.url().endsWith("/preview.svg") && fetched.push(r.url()));
      assert.equal(await page.locator("svg.tile-preview").count(), 0, "no preview before a hover");

      for (const { slug } of ready) {
        const tile = page.locator(`.game-card[data-slug="${slug}"]`);
        await tile.scrollIntoViewIfNeeded();
        const before = await tileSize(page, slug);
        await tile.hover();
        await tile.locator("svg.tile-preview").waitFor();
        const shown = await preview(page, slug);
        assert.deepEqual(shown.states, ["running"], `${slug} at ${width} px ${colorScheme}: the preview plays`);
        assert.ok(shown.end >= 3000 && shown.end <= 5000, `${slug}: the preview lasts ${shown.end} ms`);
        assert.equal(shown.hidden, "true", `${slug}: the preview is decorative`);
        assert.equal(await tile.locator(".game-icon img").count(), 0, `${slug}: the preview replaced the icon`);
        assert.deepEqual(await tileSize(page, slug), before, `${slug} at ${width} px: the tile keeps its size`);
      }
      assert.equal(fetched.length, ready.length, "each preview is fetched once");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} px: no horizontal scroll`);

      // Hold a preview at its last frame, then hover it again: it plays again.
      const { slug } = ready[0];
      await page.locator(`.game-card[data-slug="${slug}"]`).scrollIntoViewIfNeeded();
      await page.evaluate((slug) => {
        for (const a of document.querySelector(`.game-card[data-slug="${slug}"] svg.tile-preview`).getAnimations({ subtree: true })) a.finish();
      }, slug);
      assert.deepEqual((await preview(page, slug)).states, ["finished"], "the preview stops on its last frame");
      await page.screenshot({ path: `${ARTIFACTS}/home-previews-${width}-${colorScheme}.png` });
      await page.mouse.move(0, 0);
      await page.locator(`.game-card[data-slug="${slug}"]`).hover();
      assert.deepEqual((await preview(page, slug)).states, ["running"], "the preview plays again on the next hover");
      await page.close();
    }
  }

  // Keyboard: tabbing into a tile plays its preview.
  const page = await openHome(browser, srv, errors);
  const first = await page.locator(".game-card[data-slug]").first().getAttribute("data-slug");
  for (let i = 0; i < 20 && !(await page.evaluate(() => !!document.activeElement.closest(".game-card"))); i++) await page.keyboard.press("Tab");
  await page.locator(`.game-card[data-slug="${first}"] svg.tile-preview`).waitFor();
  assert.deepEqual((await preview(page, first)).states, ["running"], "focusing a tile with Tab plays its preview");
  await page.close();
  assert.deepEqual(errors, []);
});

test("previews play once in view on a touch screen and never with reduced motion", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];

  // Touch: only the tiles that have come into view play.
  const phone = await openHome(browser, srv, errors, { viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });
  const last = ready.at(-1).slug;
  assert.equal(await preview(phone, last), null, "a tile below the screen waits");
  await phone.locator(`.game-card[data-slug="${last}"]`).scrollIntoViewIfNeeded();
  await phone.locator(`.game-card[data-slug="${last}"] svg.tile-preview`).waitFor();
  assert.deepEqual((await preview(phone, last)).states, ["running"], "it plays once it is in view");
  await phone.close();

  // Reduced motion: hovering and focusing leave the icons alone.
  const still = await openHome(browser, srv, errors, { reducedMotion: "reduce" });
  for (const { slug } of ready.slice(0, 3)) await still.locator(`.game-card[data-slug="${slug}"]`).hover();
  await still.locator(".game-card[data-slug] h2 a").first().focus();
  await still.waitForTimeout(300);
  assert.equal(await still.locator("svg.tile-preview").count(), 0, "no preview with reduced motion");
  assert.equal(await still.locator("#games").evaluate((e) => e.getAnimations({ subtree: true }).length), 0, "nothing animates");
  await still.close();

  // A missing preview: the icon stays.
  const missing = await openHome(browser, srv, errors);
  await missing.route("**/preview.svg", (route) => route.fulfill({ status: 404, body: "" }));
  const tile = missing.locator(`.game-card[data-slug="${ready[0].slug}"]`);
  await tile.hover();
  await missing.waitForTimeout(300);
  assert.equal(await tile.locator(".game-icon img").count(), 1, "the icon stays without a preview");
  assert.equal(await missing.locator("svg.tile-preview").count(), 0);
  await missing.close();
  assert.deepEqual(errors.filter((e) => !/404/.test(e)), []);
});
