// One HTTP server for the whole site:
//   /            home page (public/index.html)
//   /<slug>/     a game (public/<slug>/index.html)
//   /ws          shared signaling WebSocket, rooms scoped by game slug, own pages only
//   /healthz     JSON status, CORS open
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { createSignaling } from "./signaling.js";

export const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'";
// On every response, including redirects, errors and the /ws refusal.
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": CSP,
  "Strict-Transport-Security": "max-age=31536000",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};
// Only the card deck's worker compiles WebAssembly (see ARCHITECTURE.md).
const DECK_WORKER = path.join("engine", "deck-worker.js");
const DECK_WORKER_CSP = CSP.replace("default-src 'self';", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval';");

export function parseRegistry(text) {
  const games = new Map();
  for (const g of JSON.parse(text).games) {
    games.set(g.slug, { maxPlayers: Math.min(8, Math.max(2, Number(g.maxPlayers) || 2)), status: g.status });
  }
  return games;
}

// Callback fs.readFile only: it is on EdgeJS's proven API list.
function readText(file) {
  return new Promise((resolve, reject) => fs.readFile(file, "utf8", (err, text) => (err ? reject(err) : resolve(text))));
}

// Strong ETag from the bytes: FNV-1a 64-bit as two 32-bit halves, so no node:crypto.
function etagOf(data) {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (const byte of data) {
    lo = (lo ^ byte) >>> 0;
    // h * 0x100000001b3 = h * 0x1b3 + (h << 40), mod 2^64.
    const low = lo * 0x1b3;
    hi = (Math.imul(hi, 0x1b3) + Math.floor(low / 0x100000000) + (lo << 8)) >>> 0;
    lo = low >>> 0;
  }
  return `"${hi.toString(16).padStart(8, "0")}${lo.toString(16).padStart(8, "0")}"`;
}

// If-None-Match is "*" or a list of tags; it compares weakly, so a proxy's W/ prefix still matches.
function etagMatches(header, etag) {
  return String(header || "").split(",").some((tag) => {
    tag = tag.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

// Path of a request target, or null when it can't be parsed (e.g. "//[").
function pathOf(rawUrl) {
  try {
    return new URL(rawUrl || "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}

// Pages that may open /ws besides the one the request is addressed to.
export const SITE_ORIGINS = ["https://www.dailydoseofplay.com", "https://dailydoseofplay.com", "https://dailydoseofplay.wasmer.app"];

// "https://a.example, http://b.example:3000" (or an array) -> normalised origins; bad entries are dropped.
export function parseOrigins(list) {
  const items = Array.isArray(list) ? list : String(list || "").split(",");
  const origins = [];
  for (const item of items) {
    try {
      const url = new URL(String(item).trim());
      if (url.protocol === "http:" || url.protocol === "https:") origins.push(url.origin);
    } catch {}
  }
  return origins;
}

// A Host-style value ("192.168.1.5:8080") as URL.host would print it for this scheme, or null.
function hostFor(protocol, value) {
  if (typeof value !== "string" || !/^[\w.\-:[\]]+$/.test(value.trim())) return null;
  try {
    return new URL(`${protocol}//${value.trim()}`).host;
  } catch {
    return null;
  }
}

// Browsers always send Origin on a WebSocket handshake, so a cross-site page can't hide it.
// No Origin means a non-browser client, which could send any Origin anyway.
export function wsOriginAllowed(headers, extraOrigins = []) {
  const raw = headers.origin;
  if (raw === undefined) return true;
  let origin;
  try {
    origin = new URL(raw);
  } catch {
    return false;
  }
  if (origin.protocol !== "http:" && origin.protocol !== "https:") return false;
  if (SITE_ORIGINS.includes(origin.origin) || extraOrigins.includes(origin.origin)) return true;
  const forwarded = String(headers["x-forwarded-host"] || "").split(",")[0];
  return [headers.host, forwarded].some((h) => hostFor(origin.protocol, h) === origin.host);
}

export async function createApp({
  publicDir = PUBLIC_DIR,
  log = console.log,
  allowedOrigins = process.env.ALLOWED_ORIGINS,
  clientIpHeader = process.env.CLIENT_IP_HEADER,
  limits,
  now,
} = {}) {
  const extraOrigins = parseOrigins(allowedOrigins);
  const games = parseRegistry(await readText(path.join(publicDir, "games.json")));
  const signaling = createSignaling({ games, log, limits, clientIpHeader, now });
  const notFoundPage = path.join(publicDir, "404.html");

  // Plain fs.readFile: EdgeJS is not upstream Node, so stay on proven APIs.
  // The ETag is hashed on every request, so an edited file is never served stale.
  function sendFile(req, res, file) {
    fs.readFile(file, (err, data) => {
      if (err) return notFound(req, res);
      const security = path.relative(publicDir, file) === DECK_WORKER
        ? { ...SECURITY_HEADERS, "Content-Security-Policy": DECK_WORKER_CSP }
        : SECURITY_HEADERS;
      const etag = etagOf(data);
      if (etagMatches(req.headers["if-none-match"], etag)) {
        res.writeHead(304, { ...security, ETag: etag, "Cache-Control": "no-cache" });
        return res.end();
      }
      res.writeHead(200, {
        ...security,
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
        ETag: etag,
      });
      res.end(req.method === "HEAD" ? undefined : data);
    });
  }

  function notFound(req, res) {
    fs.readFile(notFoundPage, (err, data) => {
      res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": err ? "text/plain" : MIME[".html"] });
      res.end(req.method === "HEAD" ? undefined : err ? "Not Found" : data);
    });
  }

  function serveStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return notFound(req, res);
    }
    const segments = decoded.split("/").filter(Boolean);
    // No dotfiles, no traversal, no test files.
    if (segments.some((s) => s.startsWith(".") || s.includes("\\") || s.includes("\0"))) return notFound(req, res);
    if (/\.test\.m?js$/.test(decoded)) return notFound(req, res);
    let file = path.join(publicDir, ...segments);
    if (!file.startsWith(publicDir)) return notFound(req, res);
    if (decoded.endsWith("/") || segments.length === 0) file = path.join(file, "index.html");
    else if (segments.length === 1 && games.has(segments[0])) {
      // /sea-battle -> /sea-battle/ so relative URLs resolve inside the game folder.
      const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      res.writeHead(301, { ...SECURITY_HEADERS, Location: `/${segments[0]}/${query}` });
      return res.end();
    }
    sendFile(req, res, file);
  }

  const server = http.createServer((req, res) => {
    const pathname = pathOf(req.url);
    if (pathname === null) {
      res.writeHead(400, { ...SECURITY_HEADERS, "Content-Type": "text/plain" });
      return res.end("Bad Request");
    }
    if (pathname === "/healthz") {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify({ ok: true, ...signaling.stats() }));
    }
    if (pathname === "/ws") {
      res.writeHead(426, { ...SECURITY_HEADERS, "Content-Type": "text/plain" });
      return res.end("Upgrade Required");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...SECURITY_HEADERS, Allow: "GET, HEAD" });
      return res.end();
    }
    serveStatic(req, res, pathname);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  wss.on("connection", (ws, req) => signaling.handleConnection(ws, req));
  server.on("upgrade", (req, socket, head) => {
    if (pathOf(req.url) !== "/ws") return socket.destroy();
    if (!wsOriginAllowed(req.headers, extraOrigins)) {
      socket.once("finish", () => socket.destroy());
      const headers = Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}\r\n`).join("");
      return socket.end(`HTTP/1.1 403 Forbidden\r\n${headers}Connection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const sweeper = setInterval(() => signaling.sweep(wss.clients), 30_000);
  sweeper.unref?.();
  server.on("close", () => clearInterval(sweeper));

  return { server, wss, signaling };
}
