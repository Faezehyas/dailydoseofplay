// Headless-browser tests: every game tile on the home page is the same size,
// whatever its description's length, and a phone screen doesn't scroll
// sideways or hide the first tile below the hero; placeholders hold the
// tiles' places while the list loads, and a failed load offers Retry; the
// hero's scene loops, pauses off screen and in a hidden tab, and holds still
// with reduced motion. Skips if Playwright is missing.
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
    await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
    const cards = await page.locator(".game-card[data-slug]").evaluateAll((els) =>
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
      const iconBottom = await page.locator(".game-card[data-slug] .game-icon").first().evaluate((e) => e.getBoundingClientRect().bottom);
      assert.ok(iconBottom <= 640, `first tile's picture ends at ${iconBottom} px, below a 640 px phone screen`);
    }
    await page.screenshot({ path: `${ARTIFACTS}/home-${width}.png`, fullPage: true });
    await page.close();
  }
  assert.deepEqual(errors, []);
});

// Holds every games.json request until release() is called (or fails it),
// so the test can look at the page while the list is still loading.
async function holdGames(page, { fail = false } = {}) {
  let release;
  const released = new Promise((r) => (release = r));
  await page.unrouteAll();
  await page.route("**/games.json", async (route) => {
    await released;
    if (fail) await route.fulfill({ status: 500, body: "" });
    else await route.continue();
  });
  return release;
}

function footerTop(page) {
  return page.evaluate(() => document.querySelector(".site-footer").getBoundingClientRect().top + scrollY);
}

function tileHeights(page, selector) {
  return page.locator(selector).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
}

test("home page shows placeholders while loading and a Retry button on failure", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];

  // A wide font stands in for the fallback fonts on Linux and Windows, where a
  // long game name could otherwise wrap and make its tile taller.
  for (const [width, font] of [[1280], [360], [768, "monospace"]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));

    // Slow list: placeholders first, then real tiles in the same places.
    let release = await holdGames(page);
    await page.goto(`${srv.base}/`);
    if (font) await page.addStyleTag({ content: `body { font-family: ${font}; }` });
    const placeholders = page.locator(".game-card.placeholder");
    assert.equal(await placeholders.count(), games.length, `${width} px: one placeholder per game`);
    assert.equal(await page.locator("#games > li[aria-hidden='true']").count(), games.length, `${width} px: placeholders are hidden from screen readers`);
    assert.equal(await placeholders.first().locator(".game-icon").evaluate((e) => getComputedStyle(e).animationName), "shimmer");
    const before = { footer: await footerTop(page), tiles: await tileHeights(page, ".game-card.placeholder") };
    await page.screenshot({ path: `${ARTIFACTS}/home-loading-${width}.png`, fullPage: true });
    release();
    await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
    assert.equal(await placeholders.count(), 0, `${width} px: placeholders are gone`);
    const after = { footer: await footerTop(page), tiles: await tileHeights(page, ".game-card[data-slug]") };
    assert.ok(Math.abs(after.footer - before.footer) <= 2, `${width} px: footer moved from ${before.footer} to ${after.footer}`);
    for (const [i, h] of after.tiles.entries()) {
      assert.ok(Math.abs(h - before.tiles[i]) <= 2, `${width} px: tile ${i} is ${h} px, its placeholder ${before.tiles[i]} px`);
    }

    // Failed list: an error notice with Retry; a retry that works shows the tiles.
    release = await holdGames(page, { fail: true });
    await page.reload();
    release();
    const retry = page.getByRole("button", { name: "Retry" });
    await retry.waitFor();
    assert.match(await page.locator("#games [role='alert']").innerText(), /Couldn't load the game list/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width} px: no horizontal scroll`);
    await page.screenshot({ path: `${ARTIFACTS}/home-error-${width}.png`, fullPage: true });
    release = await holdGames(page);
    await retry.click();
    assert.equal(await placeholders.count(), games.length, `${width} px: placeholders return while retrying`);
    release();
    await page.locator(".game-card[data-slug]").nth(games.length - 1).waitFor();
    assert.equal(await retry.count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.matches(".game-card h2 a")), true, `${width} px: focus moves to the first tile`);
    await page.close();
  }

  // Reduced motion: the placeholders hold still.
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const release = await holdGames(page);
  await page.goto(`${srv.base}/`);
  assert.equal(await page.locator(".game-card.placeholder .game-icon").first().evaluate((e) => getComputedStyle(e).animationName), "none");
  release();
  await page.close();
  assert.deepEqual(errors, []);
});

test("the hero scene loops, plays a move on hover and pauses when unseen", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const states = (page) => page.evaluate(() => [...new Set(document.querySelector(".hero-scene").getAnimations({ subtree: true }).map((a) => a.playState))]);
  const setHidden = (page, hidden) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${srv.base}/`);
  const scene = page.locator(".hero-scene");
  assert.equal(await scene.getAttribute("aria-hidden"), "true");
  assert.ok((await scene.evaluate((e) => e.outerHTML.length)) < 25_000, "the scene's SVG is under 25 KB");
  assert.deepEqual(await states(page), ["running"]);

  await page.locator(".hero-scene .piece").nth(2).hover();
  assert.equal(await page.locator(".hero-scene .die").evaluate((e) => getComputedStyle(e).animationName), "scene-die", "hovering the die rolls it once");
  await page.mouse.move(0, 0);

  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.querySelector(".hero-scene").classList.contains("paused"));
  assert.deepEqual(await states(page), ["paused"], "off screen");
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => !document.querySelector(".hero-scene").classList.contains("paused"));
  await setHidden(page, true);
  assert.deepEqual(await states(page), ["paused"], "hidden tab");
  await setHidden(page, false);
  assert.deepEqual(await states(page), ["running"]);
  await page.close();

  // Reduced motion: a still scene, at each size and theme.
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [360, 1280]) {
      const still = await browser.newPage({ viewport: { width, height: 800 }, colorScheme, reducedMotion: "reduce" });
      still.on("pageerror", (e) => errors.push(e.message));
      await still.goto(`${srv.base}/`);
      await still.locator(".hero-scene .piece").nth(2).hover();
      assert.equal(await still.locator(".hero-scene").evaluate((e) => e.getAnimations({ subtree: true }).length), 0, `${width} px ${colorScheme}: no animations`);
      await still.screenshot({ path: `${ARTIFACTS}/home-scene-still-${width}-${colorScheme}.png` });
      await still.close();
    }
  }
  assert.deepEqual(errors, []);
});
