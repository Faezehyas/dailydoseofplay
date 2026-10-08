// Shared by the Backgammon browser tests: loads Playwright and the page helpers.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

export const ARTIFACTS = path.resolve("test-artifacts");
export const START = [0, 0, 0, 0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0];

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

export const pw = await loadPlaywright();
export const wait = (page, fn, arg, timeout = 20_000) => page.waitForFunction(fn, arg, { timeout });
export const ply = (page) => page.evaluate(() => window.ddp.match.state.ply);
export const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
export const pick = (page, name, value) => page.click(`#bg-settings label:has(input[name="bg-${name}"][value="${value}"])`);
export const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// Waits for this page's dice to roll themselves, then plays the whole turn by
// tapping (or clicking) checkers and points, and confirms.
export async function playTurnByHand(page, { tap = false } = {}) {
  await wait(page, () => window.ddp.match.canMove() && window.ddp.match.state.rolled);
  const press = (sel) => (tap ? page.tap(sel) : page.click(sel));
  const start = await ply(page);
  for (let k = 0; k < 4 && (await page.locator(".bg-cell.src").count()); k++) {
    if (!(await page.locator(".bg-cell.selected").count())) await press(".bg-cell.src >> nth=0");
    await page.locator(".bg-cell.dest").first().waitFor();
    await press(".bg-cell.dest >> nth=0");
  }
  // A turn with no choice in it ends by itself; otherwise you confirm it.
  if (await page.locator("#bg-undo").isEnabled()) {
    assert.ok(await page.locator("#bg-confirm").isEnabled(), "the whole roll is played");
    await press("#bg-confirm");
  }
  await wait(page, (n) => window.ddp.match.state.ply > n, start);
}

// Robot games only: puts the same position on both sides before the first
// roll, to reach a race or a forced turn quickly. Points use each side's own
// numbering; "bar" is the bar, and missing checkers are borne off.
export function setPosition(page, mine, theirs) {
  return page.evaluate(([mine, theirs]) => {
    const side = (spec) => {
      const s = Array(26).fill(0);
      for (const [k, v] of Object.entries(spec)) s[k === "bar" ? 25 : Number(k)] = v;
      s[0] = 15 - s.reduce((a, b) => a + b, 0);
      return s;
    };
    const pos = [side(mine), side(theirs)];
    window.ddp.match.state.pos = structuredClone(pos);
    window.ddp.robot.match.state.pos = structuredClone(pos);
    window.ddp.match.emit("update");
  }, [mine, theirs]);
}

// Plays this page's side by the robot's choices, at once, until the game ends.
export async function autoplay(page, ms = 20) {
  await page.evaluate(async (ms) => {
    const { chooseMove } = await import("/backgammon/robot.js");
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => {
      const match = window.ddp.match;
      if (match.phase !== "playing") return clearInterval(window.__autoplay);
      if (match.canMove()) match.play({ ...chooseMove(match.state, match.me, Math.random, { level: "medium" }), ms });
    }, 10);
  }, ms);
}
