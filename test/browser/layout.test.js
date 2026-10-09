// Headless-browser test: every game page uses one column. In the lobby and
// during a robot game, the view on show and "How to play" (.rules) share
// their left and right edges, at 1280 and 360 px, with no sideways scroll,
// and Leave sits at the top right of the player bar.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const GAMES = JSON.parse(readFileSync(new URL("../../public/games.json", import.meta.url), "utf8")).games.filter((g) => g.status === "ready");
// The column at 1280 px: the lobby is always narrow.
const WIDTHS = { narrow: 520, medium: 640, wide: 980 };

// Edges of every visible view (lobby card, the game's own box) and of the rules panel.
const measure = (page) =>
  page.evaluate(() => {
    const box = (node) => {
      const r = node.getBoundingClientRect();
      return { name: node.id || node.className, left: r.left, right: r.right, width: r.width };
    };
    const shown = (node) => node.getClientRects().length > 0;
    const views = [...document.querySelectorAll("#lobby > .card, #game > :not(.overlay)")].filter(shown);
    const { view, layout } = document.querySelector(".page").dataset;
    return { view, layout, views: views.map(box), rules: box(document.querySelector(".rules")), scroll: document.documentElement.scrollWidth, inner: innerWidth };
  });

function assertColumn(m, where, width) {
  assert.ok(m.views.length > 0, `${where}: no view on show`);
  assert.ok(m.scroll <= m.inner, `${where}: page scrolls sideways (${m.scroll} > ${m.inner})`);
  for (const v of m.views) {
    const at = `${where}: ${v.name} spans ${Math.round(v.left)}..${Math.round(v.right)}, .rules ${Math.round(m.rules.left)}..${Math.round(m.rules.right)}`;
    assert.ok(Math.abs(v.left - m.rules.left) <= 1 && Math.abs(v.right - m.rules.right) <= 1, at);
    assert.ok(Math.abs(v.width - width) <= 1, `${at}; expected ${width} px wide`);
  }
}

for (const width of [1280, 360]) {
  test(`at ${width} px the lobby, the game and "How to play" share one column in every game`, { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
    const srv = await startServer();
    const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
    t.after(async () => {
      await browser.close();
      await srv.close();
    });
    const errors = [];
    // Inside the 16 px page gutters on a phone.
    const column = (layout) => (width === 360 ? 328 : WIDTHS[layout]);
    for (const game of GAMES) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on("pageerror", (e) => errors.push(`${game.slug}: ${e.message}`));
      await page.goto(`${srv.base}/${game.slug}/`);
      await page.locator("#play-friend").waitFor();
      const lobby = await measure(page);
      assert.equal(lobby.view, "lobby");
      assert.ok(Object.hasOwn(WIDTHS, lobby.layout), `${game.slug}: unknown layout "${lobby.layout}"`);
      assert.ok(await page.locator(".lobby-card .settings").isVisible(), `${game.slug}: the settings show inside the lobby card`);
      assertColumn(lobby, `${game.slug} lobby`, column("narrow"));

      await page.click("#play-robot");
      await page.locator("#game > :not(.overlay)").first().waitFor();
      const playing = await measure(page);
      assert.equal(playing.view, "game");
      assertColumn(playing, `${game.slug} robot game`, column(lobby.layout));
      // Every game's player bar spans the column, with Leave at its top right.
      const bar = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const [b, l, g] = [box(".player-bar"), box("#leave"), box("#game")];
        return { width: b.width - g.width, right: b.right - l.right, top: l.top - b.top };
      });
      assert.ok(Object.values(bar).every((d) => Math.abs(d) <= 1), `${game.slug}: Leave is at the player bar's top right (${JSON.stringify(bar)})`);
      await page.close();
    }
    assert.deepEqual(errors, []);
  });
}

test("a game that passes no layout gets the wide column, and its rules panel matches it", { skip: !pw && "Playwright not installed", timeout: 30_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // A game written before layouts existed: no layout, and its own narrower box.
  await page.route("**/tic-tac-toe/main.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `import { startGameShell } from "../engine/lobby.js";
        import { el } from "../engine/shell.js";
        startGameShell({
          slug: "tic-tac-toe",
          title: "Old game",
          createRobot: () => ({ destroy() {} }),
          onSession(session, root) {
            root.append(el("div", { class: "card", id: "old-game", style: "max-width: 480px; margin: 0 auto" }, "Playing"));
            return { destroy() {} };
          },
        });`,
    }),
  );
  await page.goto(`${srv.base}/tic-tac-toe/`);
  await page.locator("#play-robot").click();
  await page.locator("#old-game").waitFor();
  const m = await measure(page);
  assert.equal(m.layout, "wide");
  const game = await page.locator("#game").boundingBox();
  assert.equal(Math.round(game.width), WIDTHS.wide);
  assert.ok(Math.abs(game.x - m.rules.left) <= 1 && Math.abs(game.x + game.width - m.rules.right) <= 1, "the rules panel matches the column");
  const old = m.views.find((v) => v.name === "old-game");
  assert.equal(Math.round(old.width), 480, "the game's own box is untouched");
});
