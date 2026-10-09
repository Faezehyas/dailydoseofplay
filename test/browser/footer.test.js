// Headless-browser test: the home page, every game page and the 404 page end
// with the same footer, below <main>, with its line on how games run and its
// links to "How it works" and the GitHub repository, at 360 px in light and
// 1280 px in dark, with no sideways scroll. Skips if Playwright is missing.
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
const REPO = "https://github.com/Faezehyas/dailydoseofplay";

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

const SCREENS = [
  { width: 360, height: 640, colorScheme: "light" },
  { width: 1280, height: 800, colorScheme: "dark" },
];
const PAGES = [{ name: "home", url: "/" }, ...games.map((g) => ({ name: g.slug, url: `/${g.slug}/` })), { name: "404", url: "/no-such-page/" }];

for (const { width, height, colorScheme } of SCREENS) {
  test(`at ${width} px every page ends with the footer and its links`, { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
    mkdirSync(ARTIFACTS, { recursive: true });
    const srv = await startServer();
    const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
    t.after(async () => {
      await browser.close();
      await srv.close();
    });
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height }, colorScheme });
    page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));

    for (const { name, url } of PAGES) {
      await page.goto(`${srv.base}${url}`);
      const footer = page.locator("body > footer.site-footer");
      await footer.waitFor();
      assert.equal(await page.locator(".site-footer").count(), 1, `${name}: one footer`);
      assert.match(await footer.innerText(), /run directly between your browsers\. Nothing to install/, `${name}: the footer says how games run`);
      assert.equal(await footer.getByRole("link", { name: "How it works" }).getAttribute("href"), `${REPO}/blob/main/ARCHITECTURE.md`, `${name}: "How it works" link`);
      assert.equal(await footer.getByRole("link", { name: "GitHub" }).getAttribute("href"), REPO, `${name}: GitHub link`);
      assert.match(await page.locator("body").ariaSnapshot(), /^- contentinfo:/m, `${name}: the footer is a contentinfo landmark`);
      const layout = await page.evaluate(() => ({
        footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
        mainBottom: document.querySelector("main").getBoundingClientRect().bottom,
        sideways: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.ok(layout.footerTop >= layout.mainBottom, `${name}: the footer (top ${layout.footerTop}) sits below <main> (bottom ${layout.mainBottom})`);
      assert.equal(layout.sideways, false, `${name}: no sideways scroll`);
      await page.screenshot({ path: `${ARTIFACTS}/footer-${name}-${width}-${colorScheme}.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
  });
}
