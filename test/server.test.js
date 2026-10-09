import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import WebSocket from "ws";
import { createApp, wsOriginAllowed } from "../server/app.js";
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
  assert.equal((await fetch(`${srv.base}/sea-battle/sounds/splash-heavy-1.mp3`)).headers.get("content-type"), "audio/mpeg");
});

test("sea battle: every recorded sound exists and is credited", () => {
  const main = fs.readFileSync(new URL("../public/sea-battle/sounds.js", import.meta.url), "utf8");
  const credits = fs.readFileSync(new URL("../public/sea-battle/sounds/LICENSE.txt", import.meta.url), "utf8");
  const names = [...main.matchAll(/rec\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"([\w-]+)"/g)].map((n) => n[1]));
  assert.ok(names.length >= 8, "found the sample lists");
  for (const n of names) {
    assert.ok(fs.existsSync(new URL(`../public/sea-battle/sounds/${n}.mp3`, import.meta.url)), `${n}.mp3`);
    assert.match(credits, new RegExp(`^${n}\\.mp3 `, "m"), `${n} credited`);
  }
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

// Raw request so the client library can't normalise the target away.
function rawRequest(base, text) {
  const { port } = new URL(base);
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => sock.write(text));
    let out = "";
    sock.on("data", (d) => (out += d));
    sock.on("close", () => resolve(out));
    sock.on("error", () => resolve(out));
    setTimeout(() => sock.destroy(), 1000);
  });
}

test("unparseable request targets get 400 and never crash the server", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const reply = await rawRequest(srv.base, "GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  assert.match(reply, /^HTTP\/1\.1 400/);
  await rawRequest(
    srv.base,
    "GET //[ HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
  );
  assert.equal((await fetch(`${srv.base}/healthz`)).status, 200, "still alive");
});

// Resolves with the HTTP status of the handshake: 101 when the socket opens, else the refusal.
function handshake(wsUrl, { origin, host } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { origin, headers: host ? { host } : {} });
    ws.on("open", () => {
      ws.close();
      resolve(101);
    });
    ws.on("unexpected-response", (req, res) => {
      req.destroy();
      resolve(res.statusCode);
    });
    ws.on("error", reject);
  });
}

test("lobby socket: our own pages connect, other sites get 403", async (t) => {
  const srv = await startServer({ allowedOrigins: "https://preview.example, http://10.0.0.7:3000" });
  t.after(() => srv.close());
  const { port } = new URL(srv.base);

  assert.equal(await handshake(srv.wsUrl), 101, "no Origin (non-browser client)");
  assert.equal(await handshake(srv.wsUrl, { origin: srv.base }), 101, "the server's own base URL");
  assert.equal(await handshake(srv.wsUrl, { origin: "http://192.168.1.20:8080", host: "192.168.1.20:8080" }), 101, "LAN address");
  assert.equal(await handshake(srv.wsUrl, { origin: "https://www.dailydoseofplay.com" }), 101);
  assert.equal(await handshake(srv.wsUrl, { origin: "https://dailydoseofplay.wasmer.app" }), 101);
  assert.equal(await handshake(srv.wsUrl, { origin: "https://preview.example" }), 101, "ALLOWED_ORIGINS");

  assert.equal(await handshake(srv.wsUrl, { origin: "https://evil.example" }), 403);
  assert.equal(await handshake(srv.wsUrl, { origin: "https://dailydoseofplay.com.evil.example" }), 403);
  assert.equal(await handshake(srv.wsUrl, { origin: "null" }), 403);
  assert.equal(await handshake(srv.wsUrl, { origin: `http://localhost:${Number(port) + 1}`, host: `localhost:${port}` }), 403);

  assert.equal((await fetch(`${srv.base}/healthz`)).status, 200, "still alive");
});

test("lobby socket: ALLOWED_ORIGINS is read from the environment", async (t) => {
  const before = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://staging.example";
  t.after(() => (before === undefined ? delete process.env.ALLOWED_ORIGINS : (process.env.ALLOWED_ORIGINS = before)));
  const { server, wss } = await createApp({ log: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const ws of wss.clients) ws.terminate();
    return new Promise((resolve) => server.close(resolve));
  });
  const wsUrl = `ws://127.0.0.1:${server.address().port}/ws`;
  assert.equal(await handshake(wsUrl, { origin: "https://staging.example" }), 101);
  assert.equal(await handshake(wsUrl, { origin: "https://other.example" }), 403);
});

test("wsOriginAllowed: whole-host match, rewritten Host plus X-Forwarded-Host", () => {
  const proxied = { host: "10.1.2.3:8080", "x-forwarded-host": "games.example, 10.1.2.3:8080" };
  assert.equal(wsOriginAllowed({ ...proxied, origin: "https://games.example" }), true);
  assert.equal(wsOriginAllowed({ host: "10.1.2.3:8080", origin: "https://games.example" }), false, "Host alone doesn't match");
  assert.equal(wsOriginAllowed({ ...proxied, origin: "https://evil.example" }), false);
  assert.equal(wsOriginAllowed({ ...proxied, origin: "https://other.example" }, ["https://other.example"]), true);
  assert.equal(wsOriginAllowed({ host: "games.example.evil.example", origin: "https://games.example" }), false);
  assert.equal(wsOriginAllowed({ host: "www.dailydoseofplay.com", origin: "https://www.dailydoseofplay.com.evil.example" }), false);
  assert.equal(wsOriginAllowed({ host: "games.example:443", origin: "https://games.example" }), true, "default port");
  assert.equal(wsOriginAllowed({ host: "games.example", origin: "http://games.example:8080" }), false, "port differs");
  assert.equal(wsOriginAllowed({ host: "games.example", origin: "null" }), false);
  assert.equal(wsOriginAllowed({ host: "games.example" }), true, "no Origin");
});
