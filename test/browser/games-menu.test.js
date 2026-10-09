// Headless-browser tests for the header's Games menu and the lobby's "More
// games" row: the menu opens from the keyboard, marks this page's game, lists
// every game with its player count, closes on Esc and on a tap elsewhere, and
// leads to another game's lobby; the header fits a 360 px phone. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { startServer } from "../helpers.js";
import { pw } from "./ludo.shared.js";

const ARTIFACTS = path.resolve("test-artifacts");
const { games } = JSON.parse(readFileSync("public/games.json", "utf8"));
const ready = games.filter((g) => g.status === "ready");

const SCREENS = [
  { width: 360, height: 740, colorScheme: "light" },
  { width: 1280, height: 800, colorScheme: "dark" },
];

const focusedId = (page) => page.evaluate(() => document.activeElement.id);

async function setup(t) {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  return { srv, browser };
}

// The header's controls sit side by side inside the 16px gutters.
async function checkHeaderFits(page, width, where) {
  const boxes = await page.evaluate(() =>
    [".brand", "#games-toggle", "#sound-toggle", "#theme-toggle"].map((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { sel, left: r.left, right: r.right, middle: r.top + r.height / 2 };
    }),
  );
  for (const [i, box] of boxes.entries()) {
    assert.ok(box.left >= 16 && box.right <= width - 16, `${where}: ${box.sel} runs from ${box.left} to ${box.right}`);
    if (i) assert.ok(box.left >= boxes[i - 1].right, `${where}: ${box.sel} overlaps ${boxes[i - 1].sel}`);
  }
  for (const box of boxes) assert.ok(Math.abs(box.middle - boxes[0].middle) <= 1, `${where}: ${box.sel} is off the header's row`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${where}: no sideways scroll`);
}

for (const { width, height, colorScheme } of SCREENS) {
  test(`at ${width} px the Games menu works from the keyboard and leads to another lobby`, { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
    const { srv, browser } = await setup(t);
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height }, colorScheme });
    page.on("pageerror", (e) => errors.push(e.message));
    const toggle = page.locator("#games-toggle");
    const menu = page.locator("#games-menu");

    await page.goto(`${srv.base}/tic-tac-toe/`);
    await page.locator("#play-friend").waitFor();
    assert.equal(await page.locator(".header-game").count(), 0, "the header no longer repeats the game's name");
    await checkHeaderFits(page, width, `tic-tac-toe at ${width} px`);
    assert.match(await page.locator("header nav").ariaSnapshot(), /- button "Games"$/, "the Games button is in the site nav");

    // Tab to the Games button and open it with Enter.
    for (let i = 0; i < 5 && (await focusedId(page)) !== "games-toggle"; i++) await page.keyboard.press("Tab");
    assert.equal(await focusedId(page), "games-toggle");
    await page.keyboard.press("Enter");
    await menu.locator("a").first().waitFor();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const items = await menu.locator("li").evaluateAll((lis) => lis.map((li) => li.textContent));
    assert.deepEqual(items, games.map((g) => `${g.name}${g.players}`), "every game, with its player count");
    assert.equal(await menu.locator("a").count(), ready.length);
    assert.deepEqual(await menu.locator("[aria-current='page']").evaluateAll((a) => a.map((x) => x.getAttribute("href"))), ["/tic-tac-toe/"]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the open menu doesn't scroll sideways");
    await page.screenshot({ path: `${ARTIFACTS}/games-menu-open-${width}-${colorScheme}.png` });

    // Esc closes it and gives focus back; Space opens it again.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    assert.equal(await menu.isHidden(), true, "Esc closes the menu");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await focusedId(page), "games-toggle", "Esc returns focus to the button");
    await page.keyboard.press("Space");
    assert.equal(await menu.isVisible(), true, "Space opens the menu");

    // Tab through to Ludo and follow it.
    const ludo = menu.locator("a[href='/ludo/']");
    for (let i = 0; i <= ready.length && !(await ludo.evaluate((a) => a === document.activeElement)); i++) await page.keyboard.press("Tab");
    assert.equal(await ludo.evaluate((a) => a === document.activeElement), true, "Tab reaches Ludo");
    await page.keyboard.press("Enter");
    await page.waitForURL(`${srv.base}/ludo/`);
    await page.locator("#play-friend").waitFor();
    assert.equal(await page.locator("#lobby h1").innerText(), "Ludo");
    await page.locator(".more-games a").first().waitFor();
    await checkHeaderFits(page, width, `ludo at ${width} px`);
    await page.screenshot({ path: `${ARTIFACTS}/games-menu-ludo-lobby-${width}-${colorScheme}.png`, fullPage: true });

    // Tabbing out of the menu closes it.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await menu.locator("a").first().waitFor();
    await page.locator(".games-menu a").last().focus();
    await page.keyboard.press("Tab");
    assert.equal(await menu.isHidden(), true, "focus leaving the menu closes it");
    assert.deepEqual(errors, []);
  });
}

test("the home page has the same header, and a tap elsewhere closes the menu", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, browser } = await setup(t);
  for (const { width, height, colorScheme } of SCREENS) {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme, hasTouch: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${srv.base}/`);
    await page.locator(".game-card[data-slug]").first().waitFor();
    await checkHeaderFits(page, width, `home at ${width} px`);
    await page.locator("#games-toggle").tap();
    await page.locator("#games-menu a").first().waitFor();
    assert.equal(await page.locator("#games-menu [aria-current]").count(), 0, "no game is current on the home page");
    await page.screenshot({ path: `${ARTIFACTS}/games-menu-home-${width}-${colorScheme}.png` });
    await page.touchscreen.tap(width - 8, 4); // the header's corner, outside every control
    assert.equal(await page.locator("#games-menu").isHidden(), true, "a tap outside closes the menu");
    await page.locator("#games-toggle").tap();
    await page.locator("#games-menu a[href='/chess/']").tap();
    await page.waitForURL(`${srv.base}/chess/`);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("the lobby's More games row lists the other ready games and hides during a game", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, browser } = await setup(t);
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${srv.base}/chess/`);
  const row = page.locator("nav.more-games");
  await row.locator("a").first().waitFor();
  assert.match(await row.ariaSnapshot(), /^- navigation "More games":/);
  const hrefs = await row.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  assert.deepEqual(hrefs, ready.filter((g) => g.slug !== "chess").map((g) => `/${g.slug}/`));
  const [card, more] = await Promise.all([page.locator("#lobby .lobby-card").boundingBox(), row.boundingBox()]);
  assert.ok(more.y >= card.y + card.height, "the row sits under the lobby card");
  await page.click("#play-robot");
  await page.locator("#game:not([hidden])").waitFor();
  assert.equal(await row.isHidden(), true, "the row hides while a game is on show");
  assert.deepEqual(errors, []);
});
