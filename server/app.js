// One HTTP server for the whole site:
//   /            home page (public/index.html)
//   /<slug>/     a game (public/<slug>/index.html)
//   /ws          shared signaling WebSocket, rooms scoped by game slug
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
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy":
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

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

// Path of a request target, or null when it can't be parsed (e.g. "//[").
function pathOf(rawUrl) {
  try {
    return new URL(rawUrl || "/", "http://localhost").pathname;
  } catch {
    return null;
  }
}

export async function createApp({ publicDir = PUBLIC_DIR, log = console.log } = {}) {
  const games = parseRegistry(await readText(path.join(publicDir, "games.json")));
  const signaling = createSignaling({ games, log });
  const notFoundPage = path.join(publicDir, "404.html");

  // Plain fs.readFile: EdgeJS is not upstream Node, so stay on proven APIs.
  function sendFile(req, res, file) {
    fs.readFile(file, (err, data) => {
      if (err) return notFound(req, res);
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
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
      res.writeHead(301, { Location: `/${segments[0]}/${query}` });
      return res.end();
    }
    sendFile(req, res, file);
  }

  const server = http.createServer((req, res) => {
    const pathname = pathOf(req.url);
    if (pathname === null) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      return res.end("Bad Request");
    }
    if (pathname === "/healthz") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end(JSON.stringify({ ok: true, ...signaling.stats() }));
    }
    if (pathname === "/ws") {
      res.writeHead(426, { "Content-Type": "text/plain" });
      return res.end("Upgrade Required");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    serveStatic(req, res, pathname);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  wss.on("connection", (ws) => signaling.handleConnection(ws));
  server.on("upgrade", (req, socket, head) => {
    if (pathOf(req.url) !== "/ws") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const sweeper = setInterval(() => signaling.sweep(wss.clients), 30_000);
  sweeper.unref?.();
  server.on("close", () => clearInterval(sweeper));

  return { server, wss, signaling };
}
