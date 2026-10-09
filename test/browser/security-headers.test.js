// Headless-browser test for the security headers: under connect-src 'self'
// the lobby still reaches /ws, and the Permissions-Policy still lets the
// invite link be copied and shared. Runs Chromium's new headless mode, which
// has navigator.share on macOS and Windows. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

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

test("the lobby reaches /ws, and the invite link copies and shares, under the security headers", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ channel: "chromium", args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const ctx = await browser.newContext();
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: srv.base });
  // Records how the page's own share call ends; a Permissions-Policy block rejects it with NotAllowedError.
  await ctx.addInitScript(() => {
    const share = navigator.share?.bind(navigator);
    if (!share) return;
    navigator.share = (data) => {
      window.shareResult = "pending";
      const done = share(data);
      done.then(() => (window.shareResult = "ok"), (e) => (window.shareResult = e.name));
      return done;
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => /Content Security Policy|Permissions policy/i.test(m.text()) && errors.push(m.text()));

  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.click("#play-friend");
  await page.locator("#room-code").waitFor({ timeout: 20_000 });
  const invite = await page.locator("#invite-link").inputValue();

  await page.click("#copy-link");
  await page.locator("#toast.show", { hasText: "Invite link copied" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), invite);

  // Chromium on Linux has no navigator.share, so the lobby shows no Share button there.
  if (await page.evaluate(() => "share" in navigator)) {
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.waitForFunction(() => window.shareResult);
    await page.waitForTimeout(500);
    assert.notEqual(await page.evaluate(() => window.shareResult), "NotAllowedError");
  } else t.diagnostic("no navigator.share in this browser: Share not checked");

  assert.deepEqual(errors, []);
});
