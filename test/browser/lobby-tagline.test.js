// Headless-browser test: each game's lobby shows its description from
// games.json under the title, and the lobby doesn't wait for the file.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer } from "../helpers.js";
import { pw } from "./ludo.shared.js";

const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");

async function setup(t) {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { srv, page, errors };
}

test("the lobby tagline is the game's description in games.json", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const { srv, page, errors } = await setup(t);
  for (const game of GAMES) {
    await page.goto(`${srv.base}/${game.slug}/`);
    const tagline = page.locator(".lobby-card .tagline");
    await tagline.waitFor();
    assert.equal(await tagline.textContent(), game.description, game.name);
  }
  assert.deepEqual(errors, []);
});

test("the lobby shows before games.json arrives", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, page, errors } = await setup(t);
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route("**/games.json", async (route) => (await held, route.continue()));
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.locator("#play-friend").waitFor();
  assert.equal(await page.locator(".lobby-card .tagline").isVisible(), false, "no empty line while it loads");

  release();
  const tagline = page.locator(".lobby-card .tagline");
  await tagline.waitFor();
  assert.equal(await tagline.textContent(), GAMES.find((g) => g.slug === "tic-tac-toe").description);
  assert.deepEqual(errors, []);
});
