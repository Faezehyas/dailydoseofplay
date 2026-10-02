import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { startServer } from "./helpers.js";

const registry = JSON.parse(fs.readFileSync(new URL("../public/games.json", import.meta.url)));

test("HTTP routes: home, games, healthz, ws, 404s", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const home = await fetch(`${srv.base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(await home.text(), /Daily Dose of Play/);

  const health = await fetch(`${srv.base}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), "*");
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.rooms, 0);

  assert.equal((await fetch(`${srv.base}/ws`)).status, 426);
  assert.equal((await fetch(`${srv.base}/games.json`)).status, 200);

  for (const game of registry.games.filter((g) => g.status === "ready")) {
    const page = await fetch(`${srv.base}/${game.slug}/`);
    assert.equal(page.status, 200, game.slug);
    assert.match(await page.text(), new RegExp(game.name));
    const bare = await fetch(`${srv.base}/${game.slug}?room=ABCD`, { redirect: "manual" });
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get("location"), `/${game.slug}/?room=ABCD`);
  }

  for (const bad of ["/../package.json", "/%2e%2e/package.json", "/.git/config", "/sea-battle/rules.test.js", "/nope/", "/engine/missing.js"]) {
    const res = await fetch(`${srv.base}${bad}`);
    assert.equal(res.status, 404, bad);
  }
  assert.equal((await fetch(`${srv.base}/`, { method: "POST" })).status, 405);

  const js = await fetch(`${srv.base}/engine/lobby.js`);
  assert.match(js.headers.get("content-type"), /javascript/);
  assert.equal((await fetch(`${srv.base}/sea-battle/icon.svg`)).headers.get("content-type"), "image/svg+xml");
  assert.equal((await fetch(`${srv.base}/engine/`)).status, 404, "no directory listings");
});

test("registry: every entry is well formed and every ready game has a folder", () => {
  const slugs = new Set();
  for (const g of registry.games) {
    assert.match(g.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!["engine", "ws", "healthz"].includes(g.slug));
    assert.ok(!slugs.has(g.slug), `duplicate ${g.slug}`);
    slugs.add(g.slug);
    assert.ok(g.name && g.description && g.players, g.slug);
    assert.ok(["ready", "soon"].includes(g.status), g.slug);
    if (g.status === "ready") {
      assert.ok(fs.existsSync(new URL(`../public/${g.slug}/index.html`, import.meta.url)), `${g.slug}/index.html`);
      assert.ok(fs.existsSync(new URL(`../public/${g.slug}/icon.svg`, import.meta.url)), `${g.slug}/icon.svg`);
    }
  }
});
