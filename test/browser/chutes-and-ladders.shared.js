// Shared by the Chutes and Ladders browser tests: loads Playwright and the page helpers.
import { execSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

export const ARTIFACTS = path.resolve("test-artifacts");

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
export const AUTO_SPIN_DELAY = 700; // as in main.js
export const wait = (page, fn, arg, timeout = 20_000) => page.waitForFunction(fn, arg, { timeout });
export const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// The settings fold to a summary line in the lobby card; open it first.
export async function pick(page, name, value) {
  if (!(await page.locator("#cl-settings[open]").count())) await page.click("#cl-settings > summary");
  await page.click(`#cl-settings label:has(input[name="cl-${name}"][value="${value}"])`);
}
export const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
export const state = (page) => page.evaluate(() => window.ddp.match.state);
// Each player's colour on this screen, by name, as the theme token their pill
// swatch and pawn resolve to, so screens in different themes compare.
export const colours = (page) =>
  page.evaluate(() => {
    const root = document.querySelector(".chutes-ladders");
    const resolve = (value) => {
      const i = document.createElement("i");
      i.style.color = value;
      root.append(i);
      const c = getComputedStyle(i).color;
      i.remove();
      return c;
    };
    const token = Object.fromEntries(["--accent", "--accent-2", "--cl-p2", "--cl-p3"].map((v) => [resolve(`var(${v})`), v]));
    return Object.fromEntries(
      [...document.querySelectorAll(".pb-who")].map((n) => {
        const seat = [...n.classList].find((c) => /^p\d$/.test(c));
        const swatch = getComputedStyle(n.querySelector(".swatch")).backgroundColor;
        const pawn = resolve(getComputedStyle(document.querySelector(`.cl-board .pawn.${seat}`)).getPropertyValue("--pawn"));
        return [n.querySelector(".pb-name").textContent.replace(" (you)", ""), `${token[swatch]} ${token[pawn]}`];
      }),
    );
  });

// The board has settled: no spin is being played out on screen.
export const settled = (page) => wait(page, () => !document.querySelector("#cl-status")?.textContent.match(/Spinning|spinning|moving|Hop|ladder|chute/i));

// Presses Spin whenever this page may, until the game ends.
export async function spinUntilOver(page, { tap = false, timeout = 120_000 } = {}) {
  const t0 = Date.now();
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    if (Date.now() - t0 > timeout) throw new Error("game did not finish");
    if (await page.locator("#cl-spin").isEnabled()) await (tap ? page.tap("#cl-spin") : page.click("#cl-spin"));
    await page.waitForTimeout(40);
  }
}

// A page set to spin by itself does so a beat after the board settles: jump
// its clock past each beat instead of waiting it out. Needs page.clock.install().
export async function skipAutoSpinBeats(page) {
  while ((await page.evaluate(() => window.ddp.match.phase)) === "playing") {
    if (await page.locator("#cl-spin").isEnabled()) await page.clock.fastForward(AUTO_SPIN_DELAY);
    else await page.waitForTimeout(40);
  }
}
