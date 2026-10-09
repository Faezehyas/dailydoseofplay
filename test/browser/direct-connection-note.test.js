// Headless-browser test: each game's lobby says, under "Play with a friend",
// that games connect browsers directly. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startServer } from "../helpers.js";
import { noHorizontalScroll, pw } from "./ludo.shared.js";

const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");
const NOTE = "Games connect your browser directly to your friends'. Play with people you know.";

test("every lobby says games connect directly", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const game of GAMES) {
    await page.goto(`${srv.base}/${game.slug}/`);
    const note = page.locator(".lobby-card #direct-note");
    await note.waitFor();
    assert.equal(await note.textContent(), NOTE, game.name);
    const friend = await page.locator("#play-friend").boundingBox();
    const box = await note.boundingBox();
    assert.ok(box.y >= friend.y + friend.height, `${game.name}: the note is under Play with a friend`);
    assert.ok(await noHorizontalScroll(page), `${game.name}: no sideways scroll`);
  }
  assert.deepEqual(errors, []);
});
