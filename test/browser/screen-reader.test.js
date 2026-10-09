// Headless-browser test for what a screen reader gets, read from Playwright's
// accessibility snapshot at 360 and 1280 px: the header is a banner with a
// navigation landmark and a skip link to <main> that shows on focus; the sound
// and theme toggles keep one label and give their state only through
// aria-pressed; the waiting room reads out "Room code" and then the code one
// letter at a time. Skips if Playwright is missing.
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

const SCREENS = [
  { width: 360, height: 640, colorScheme: "light" },
  { width: 1280, height: 800, colorScheme: "dark" },
];

// The skip link comes first, then the banner with its navigation, then <main>.
async function checkLandmarks(page, where) {
  const tree = await page.locator("body").ariaSnapshot();
  assert.match(tree, /^- link "Skip to content":\n\s+- \/url: "#main"\n- banner:\n\s+- navigation "Site":\n\s+- link "Daily Dose of Play"/, `${where}:\n${tree}`);
  assert.match(tree, /^- main:/m, `${where}:\n${tree}`);
  await page.keyboard.press("Tab");
  const skip = page.locator(".skip-link");
  assert.equal(await skip.evaluate((a) => a === document.activeElement), true, `${where}: the first Tab lands on the skip link`);
  const box = await skip.boundingBox();
  assert.ok(box.y >= 0, `${where}: the focused skip link is on screen, top at ${box.y}`);
}

// One state signal: the label stays the same and only aria-pressed changes.
async function checkToggle(page, id, label, where) {
  const button = page.locator(id);
  const read = async () => {
    const [, name, pressed] = (await button.ariaSnapshot()).match(/^- button "([^"]+)"( \[pressed\])?/);
    assert.equal(name, label, `${where}: ${id} reads "${name}"`);
    assert.equal(await button.getAttribute("title"), label, `${where}: ${id} has a tooltip that says something else`);
    return !!pressed;
  };
  const before = await read();
  await button.click();
  assert.equal(await read(), !before, `${where}: ${id} stays ${before ? "pressed" : "unpressed"} after a click`);
  await button.click();
}

for (const { width, height, colorScheme } of SCREENS) {
  test(`at ${width} px the landmarks, toggles and room code read right`, { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
    mkdirSync(ARTIFACTS, { recursive: true });
    const srv = await startServer();
    const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
    t.after(async () => {
      await browser.close();
      await srv.close();
    });
    const errors = [];
    const page = await browser.newPage({ viewport: { width, height }, colorScheme });
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto(`${srv.base}/`);
    await checkLandmarks(page, `home at ${width} px`);
    await page.screenshot({ path: `${ARTIFACTS}/screen-reader-home-${width}-${colorScheme}.png` });
    await checkToggle(page, "#theme-toggle", "Dark mode", `home at ${width} px`);

    await page.goto(`${srv.base}/tic-tac-toe/`);
    await checkLandmarks(page, `tic-tac-toe at ${width} px`);
    await checkToggle(page, "#theme-toggle", "Dark mode", `tic-tac-toe at ${width} px`);
    await checkToggle(page, "#sound-toggle", "Mute sounds", `tic-tac-toe at ${width} px`);

    await page.click("#play-friend");
    await page.locator("#room-code").waitFor();
    const code = (await page.locator("#room-code").innerText()).trim();
    assert.match(code, /^[A-Z0-9]{4}$/);
    const tree = await page.locator("main").ariaSnapshot();
    assert.ok(tree.includes(`- paragraph: Room code ${[...code].join(" ")}\n`), `the code is read out letter by letter:\n${tree}`);
    assert.doesNotMatch(tree, new RegExp(`[-:] ${code}$`, "m"), `the code is read out once, not also as a word:\n${tree}`);
    await page.waitForTimeout(400); // let the letters settle in
    await page.screenshot({ path: `${ARTIFACTS}/screen-reader-room-code-${width}-${colorScheme}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no sideways scroll");
    assert.deepEqual(errors, []);
  });
}
