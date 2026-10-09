import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
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
  assert.doesNotMatch(home.headers.get("content-security-policy"), /eval/, "pages can't compile code");
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
  assert.equal((await fetch(`${srv.base}/engine/fonts/fredoka.woff2`)).headers.get("content-type"), "font/woff2");
  const wasm = await fetch(`${srv.base}/engine/vendor/mental-poker/cards_play_bg.wasm`);
  assert.equal(wasm.headers.get("content-type"), "application/wasm", "WebAssembly.instantiateStreaming needs it");
  // Only the deck worker, which runs under its own script's policy, may compile WebAssembly.
  const worker = (await fetch(`${srv.base}/engine/deck-worker.js`)).headers.get("content-security-policy");
  assert.match(worker, /^default-src 'self'; script-src 'self' 'wasm-unsafe-eval';/);
  assert.doesNotMatch(worker, /'unsafe-eval'/);
  assert.doesNotMatch((await fetch(`${srv.base}/engine/deck-crypto.js`)).headers.get("content-security-policy"), /eval/);
});

test("static files: ETag, 304 when it matches, a new ETag after an edit", async (t) => {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "ddp-public-"));
  t.after(() => fs.rmSync(publicDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(publicDir, "games.json"), JSON.stringify({ games: [] }));
  fs.writeFileSync(path.join(publicDir, "app.js"), "export const v = 1;\n");
  const srv = await startServer({ publicDir });
  t.after(() => srv.close());
  const url = `${srv.base}/app.js`;

  const first = await fetch(url);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-cache");
  const etag = first.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{16}"$/);
  assert.equal(await first.text(), "export const v = 1;\n");

  for (const method of ["GET", "HEAD"]) {
    const again = await fetch(url, { method, headers: { "If-None-Match": etag } });
    assert.equal(again.status, 304, method);
    assert.equal(again.headers.get("etag"), etag);
    assert.equal(await again.text(), "");
  }
  assert.equal((await fetch(url, { headers: { "If-None-Match": `"other", W/${etag}` } })).status, 304, "list with a weak tag");
  assert.equal((await fetch(url, { headers: { "If-None-Match": '"0000000000000000"' } })).status, 200);

  fs.writeFileSync(path.join(publicDir, "app.js"), "export const v = 2;\n");
  const edited = await fetch(url, { headers: { "If-None-Match": etag } });
  assert.equal(edited.status, 200);
  assert.notEqual(edited.headers.get("etag"), etag);
  assert.equal(await edited.text(), "export const v = 2;\n");
});

test("privacy page: served, and it names every localStorage key in public/", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const res = await fetch(`${srv.base}/privacy/`);
  assert.equal(res.status, 200);
  const page = await res.text();
  const publicDir = new URL("../public/", import.meta.url);
  const keys = new Set();
  for (const file of fs.readdirSync(publicDir, { recursive: true })) {
    if (!file.endsWith(".js") || file.endsWith(".test.js")) continue;
    for (const [, key] of fs.readFileSync(new URL(file, publicDir), "utf8").matchAll(/["'`](ddp-[\w-]+)["'`]/g)) keys.add(key);
  }
  assert.ok(keys.has("ddp-name"), "found the keys");
  for (const key of keys) assert.ok(page.includes(`<code>${key}</code>`), `public/privacy/index.html lists ${key}`);
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

test("registry: every entry is well formed and every ready game has a folder", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
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
      // The optional preview is inlined in the home page: same-origin and script-free.
      if (fs.existsSync(new URL(`../public/${g.slug}/preview.svg`, import.meta.url))) {
        const res = await fetch(`${srv.base}/${g.slug}/preview.svg`);
        assert.equal(res.headers.get("content-type"), "image/svg+xml", `${g.slug}/preview.svg`);
        const svg = await res.text();
        assert.doesNotMatch(svg, /<script|\son\w+=|@import|(href|src)="(?!#)|url\((?!#)/i, `${g.slug}/preview.svg has no external references`);
      }
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

test("security headers on every response: pages, files, 304, 301, 404, 400, 405, 426, healthz and the /ws refusal", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  const expected = {
    "content-security-policy":
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    "strict-transport-security": "max-age=31536000",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
  };
  const check = (get, label) => {
    for (const [name, value] of Object.entries(expected)) assert.equal(get(name), value, `${label}: ${name}`);
  };
  const checkRaw = (reply, status, label) => {
    assert.match(reply, new RegExp(`^HTTP/1\\.1 ${status}`), label);
    const head = reply.split("\r\n\r\n")[0].split("\r\n").slice(1);
    const headers = new Map(head.map((line) => [line.slice(0, line.indexOf(":")).toLowerCase(), line.slice(line.indexOf(":") + 1).trim()]));
    check((name) => headers.get(name), label);
  };

  const etag = (await fetch(`${srv.base}/engine/lobby.js`)).headers.get("etag");
  const cases = [
    ["/", {}, 200],
    ["/engine/lobby.js", {}, 200],
    ["/engine/lobby.js", { headers: { "If-None-Match": etag } }, 304],
    ["/tic-tac-toe", { redirect: "manual" }, 301],
    ["/nope/", {}, 404],
    ["/", { method: "POST" }, 405],
    ["/ws", {}, 426],
  ];
  for (const [url, opts, status] of cases) {
    const res = await fetch(`${srv.base}${url}`, opts);
    assert.equal(res.status, status, url);
    check((name) => res.headers.get(name), `${status} ${url}`);
  }

  const health = await fetch(`${srv.base}/healthz`);
  check((name) => health.headers.get(name), "/healthz");
  assert.equal(health.headers.get("access-control-allow-origin"), "*");
  assert.equal(health.headers.get("content-type"), "application/json");
  assert.equal((await health.json()).ok, true);

  checkRaw(await rawRequest(srv.base, "GET //[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"), 400, "bad target");
  checkRaw(
    await rawRequest(
      srv.base,
      "GET /ws HTTP/1.1\r\nHost: x\r\nOrigin: https://evil.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    ),
    403,
    "/ws refusal",
  );
});
