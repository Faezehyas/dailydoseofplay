// Headless-browser test for toasts: in a robot game at 360 and 1280 px the
// first toast shows below the header, clear of the sound and theme buttons
// and above the board; a repeated message empties the toast and fills it
// again, so a screen reader announces it again. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

const ARTIFACTS = path.resolve("test-artifacts");

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
const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const SCREENS = [
  { width: 360, height: 640, colorScheme: "light" },
  { width: 1280, height: 800, colorScheme: "dark" },
];
const GAMES = [
  { slug: "tic-tac-toe", board: "#ttt-board" },
  { slug: "gomoku", board: ".gmk-board-wrap" },
];

for (const { width, height, colorScheme } of SCREENS) {
  test(`at ${width} px a toast sits below the header, clear of its buttons and the board`, { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
    mkdirSync(ARTIFACTS, { recursive: true });
    const srv = await startServer();
    const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
    t.after(async () => {
      await browser.close();
      await srv.close();
    });
    const errors = [];
    for (const game of GAMES) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme });
      page.on("pageerror", (e) => errors.push(`${game.slug}: ${e.message}`));
      await page.goto(`${srv.base}/${game.slug}/`);
      await page.click("#play-robot");
      await page.locator("#toast.show").waitFor();
      await page.waitForTimeout(300); // let the slide-in transition finish
      const box = await page.evaluate((board) => {
        const rect = (sel) => {
          const { left, right, top, bottom } = document.querySelector(sel).getBoundingClientRect();
          return { left, right, top, bottom };
        };
        return { toast: rect("#toast"), header: rect(".site-header"), sound: rect("#sound-toggle"), theme: rect("#theme-toggle"), board: rect(board) };
      }, game.board);
      const where = `${game.slug} at ${width} px: toast spans ${box.toast.top}..${box.toast.bottom}`;
      assert.ok(!overlaps(box.toast, box.sound), `${where}, over the sound button`);
      assert.ok(!overlaps(box.toast, box.theme), `${where}, over the theme button`);
      assert.ok(box.toast.top >= box.header.bottom, `${where}, header ends at ${box.header.bottom}`);
      assert.ok(box.toast.bottom <= box.board.top, `${where}, board starts at ${box.board.top}`);
      await page.screenshot({ path: `${ARTIFACTS}/toast-${game.slug}-${width}-${colorScheme}.png` });
      await page.close();
    }
    assert.deepEqual(errors, []);
  });
}

test("a repeated toast empties and fills again, so it is announced again", { skip: !pw && "Playwright not installed", timeout: 30_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  await page.goto(`${srv.base}/`);
  const texts = await page.evaluate(async () => {
    const { toast } = await import("/engine/shell.js");
    toast("Square taken");
    const node = document.querySelector("#toast");
    const seen = [node.textContent];
    new MutationObserver(() => seen.push(node.textContent)).observe(node, { childList: true });
    toast("Square taken");
    await new Promise((resolve) => setTimeout(resolve, 300));
    return seen;
  });
  assert.deepEqual(texts, ["Square taken", "", "Square taken"]);
  const toast = page.locator("#toast");
  assert.equal(await toast.getAttribute("role"), "status");
  assert.equal(await toast.evaluate((node) => getComputedStyle(node).pointerEvents), "none");
  assert.ok(await toast.evaluate((node) => node.classList.contains("show")));
});
