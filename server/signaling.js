// Game-agnostic signaling: rooms scoped by game slug, plus an opaque relay
// for WebRTC SDP/ICE blobs. Gameplay never passes through here.
import { randomBytes } from "node:crypto";

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const MAX_ROOMS = 10000;
const IDLE_MS = 75_000;
const MAX_KNOCKS = 4;
export const DEFAULT_LIMITS = { failedJoins: 5, windowMs: 60_000, approvalMs: 60_000 };

// 128 random bits, base64url. ws itself loads node:crypto, so it is proven on EdgeJS.
function newInviteKey() {
  return randomBytes(16).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sameKey(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The first address in the client-IP header (X-Forwarded-For unless
// overridden), else the socket's. Used only as a rate-limit bucket, never logged.
export function clientIp(req, header = "x-forwarded-for") {
  const first = String(req?.headers?.[header.toLowerCase()] || "").split(",")[0].trim();
  return first || req?.socket?.remoteAddress || null;
}

export function createSignaling({ games, log = () => {}, limits = {}, clientIpHeader }) {
  // games: Map slug -> { maxPlayers }
  const { failedJoins, windowMs, approvalMs } = { ...DEFAULT_LIMITS, ...limits };
  // "slug/CODE" -> { game, code, secret, host, peers: Map id -> { ws, name }, knocks: Map id -> { ws, name, timer } }
  const rooms = new Map();
  const ipFailures = new Map(); // client IP -> timestamps of failed joins in the window
  let nextPeerId = 1;

  const key = (game, code) => `${game}/${code}`;

  function recent(list, now) {
    while (list.length && now - list[0] >= windowMs) list.shift();
    return list;
  }

  function ipList(ws, now) {
    const ip = ws.meta.ip;
    if (!ip) return null; // unknown address: one shared bucket would lock everyone out
    if (!ipFailures.has(ip)) ipFailures.set(ip, []);
    return recent(ipFailures.get(ip), now);
  }

  function overBudget(ws, now = Date.now()) {
    return recent(ws.meta.failures, now).length >= failedJoins || (ipList(ws, now)?.length ?? 0) >= failedJoins;
  }

  function failedJoin(ws, now = Date.now()) {
    ws.meta.failures.push(now);
    ipList(ws, now)?.push(now);
  }

  function refuse(ws) {
    send(ws, { t: "error", code: "rate_limited" });
    ws.close(1008, "rate_limited");
  }

  function newRoomCode(game) {
    for (;;) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
      }
      if (!rooms.has(key(game, code))) return code;
    }
  }

  function send(ws, msg) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(room, msg, except) {
    for (const [id, peer] of room.peers) if (id !== except) send(peer.ws, msg);
  }

  // A knock ends: admitted, declined, timed out, withdrawn or the room closed.
  function endKnock(room, id) {
    const knock = room.knocks.get(id);
    if (!knock) return null;
    room.knocks.delete(id);
    clearTimeout(knock.timer);
    knock.ws.meta.knock = null;
    return knock;
  }

  function closeKnock(knock, code) {
    send(knock.ws, { t: "error", code });
    knock.ws.close(1000, code);
  }

  function leave(ws) {
    if (ws.meta.knock) {
      const room = rooms.get(ws.meta.knock);
      if (room && endKnock(room, ws.meta.id)) send(room.peers.get(room.host)?.ws, { t: "knock-gone", id: ws.meta.id });
      ws.meta.knock = null;
    }
    const k = ws.meta.room;
    if (!k) return;
    ws.meta.room = null;
    const room = rooms.get(k);
    if (!room) return;
    room.peers.delete(ws.meta.id);
    if (room.host === ws.meta.id || room.peers.size === 0) {
      broadcast(room, { t: "host-left" });
      for (const peer of room.peers.values()) peer.ws.meta.room = null;
      for (const id of [...room.knocks.keys()]) closeKnock(endKnock(room, id), "host_left");
      rooms.delete(k);
      log(`room ${k} closed`);
    } else {
      broadcast(room, { t: "leave", id: ws.meta.id });
    }
  }

  function admit(ws, room, name) {
    leave(ws);
    room.peers.set(ws.meta.id, { ws, name });
    ws.meta.room = key(room.game, room.code);
    const peers = [...room.peers].map(([id, p]) => ({ id, name: p.name }));
    send(ws, { t: "joined", game: room.game, room: room.code, id: ws.meta.id, host: room.host, peers });
    broadcast(room, { t: "peer", id: ws.meta.id, name }, ws.meta.id);
  }

  function cleanName(raw) {
    const name = String(raw ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20);
    return name || "Player";
  }

  function onMessage(ws, raw) {
    ws.meta.lastSeen = Date.now();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { t: "error", code: "bad_json" });
    }
    if (!msg || typeof msg !== "object") return send(ws, { t: "error", code: "bad_json" });
    switch (msg.t) {
      case "ping":
        return send(ws, { t: "pong" });
      case "create": {
        const game = String(msg.game || "");
        if (!games.has(game)) return send(ws, { t: "error", code: "bad_game" });
        if (rooms.size >= MAX_ROOMS) return send(ws, { t: "error", code: "server_full" });
        leave(ws);
        const code = newRoomCode(game);
        const name = cleanName(msg.name);
        const secret = newInviteKey();
        rooms.set(key(game, code), {
          game,
          code,
          secret,
          host: ws.meta.id,
          peers: new Map([[ws.meta.id, { ws, name }]]),
          knocks: new Map(),
        });
        ws.meta.room = key(game, code);
        log(`room ${game}/${code} created by ${ws.meta.id}`);
        return send(ws, { t: "created", game, room: code, key: secret, id: ws.meta.id });
      }
      case "join": {
        const game = String(msg.game || "");
        if (!games.has(game)) return send(ws, { t: "error", code: "bad_game" });
        const code = String(msg.room || "").trim().toUpperCase();
        const given = typeof msg.key === "string" ? msg.key : "";
        const room = rooms.get(key(game, code));
        const keyOk = Boolean(room && given && sameKey(given, room.secret));
        // The right key can't be a guess. Anything else spends the budget, found or not.
        if (!keyOk && overBudget(ws)) return refuse(ws);
        if (!room || (given && !keyOk)) {
          failedJoin(ws);
          return send(ws, { t: "error", code: "no_such_room" });
        }
        if (room.peers.has(ws.meta.id) || room.knocks.has(ws.meta.id)) return send(ws, { t: "error", code: "already_in_room" });
        if (room.peers.size >= games.get(game).maxPlayers) return send(ws, { t: "error", code: "room_full" });
        const name = cleanName(msg.name);
        if (keyOk) return admit(ws, room, name);
        if (room.knocks.size >= MAX_KNOCKS) return send(ws, { t: "error", code: "room_busy" });
        leave(ws);
        const timer = setTimeout(() => {
          const knock = endKnock(room, ws.meta.id);
          if (!knock) return;
          send(room.peers.get(room.host)?.ws, { t: "knock-gone", id: ws.meta.id });
          closeKnock(knock, "no_answer");
        }, approvalMs);
        timer.unref?.();
        room.knocks.set(ws.meta.id, { ws, name, timer });
        ws.meta.knock = key(game, code);
        send(ws, { t: "knocking", game, room: code });
        return send(room.peers.get(room.host).ws, { t: "knock", id: ws.meta.id, name });
      }
      case "admit":
      case "decline": {
        const room = ws.meta.room && rooms.get(ws.meta.room);
        if (!room || room.host !== ws.meta.id) return send(ws, { t: "error", code: "not_host" });
        const knock = endKnock(room, String(msg.id));
        if (!knock) return send(ws, { t: "error", code: "no_such_peer" });
        if (msg.t === "decline") {
          failedJoin(knock.ws);
          return closeKnock(knock, "declined");
        }
        if (room.peers.size >= games.get(room.game).maxPlayers) return closeKnock(knock, "room_full");
        return admit(knock.ws, room, knock.name);
      }
      case "leave":
        leave(ws);
        return send(ws, { t: "left" });
      case "signal": {
        const room = ws.meta.room && rooms.get(ws.meta.room);
        if (!room) return send(ws, { t: "error", code: "not_in_room" });
        const target = room.peers.get(String(msg.to));
        if (!target || target.ws === ws) return send(ws, { t: "error", code: "no_such_peer" });
        return send(target.ws, { t: "signal", from: ws.meta.id, data: msg.data });
      }
      default:
        return send(ws, { t: "error", code: "unknown_type" });
    }
  }

  function handleConnection(ws, req) {
    const ip = clientIp(req, clientIpHeader || undefined);
    ws.meta = { id: String(nextPeerId++), room: null, knock: null, ip, failures: [], lastSeen: Date.now() };
    ws.on("message", (raw) => onMessage(ws, raw.toString()));
    ws.on("close", () => leave(ws));
    ws.on("error", () => leave(ws));
    send(ws, { t: "hello", id: ws.meta.id });
  }

  // Drop sockets that stopped pinging (clients ping every 25 s).
  function sweep(clients, now = Date.now()) {
    for (const ws of clients) {
      if (ws.meta && now - ws.meta.lastSeen > IDLE_MS) ws.terminate();
    }
    for (const [ip, list] of ipFailures) if (!recent(list, now).length) ipFailures.delete(ip);
  }

  function stats() {
    let players = 0;
    const perGame = {};
    for (const room of rooms.values()) {
      players += room.peers.size;
      perGame[room.game] = (perGame[room.game] || 0) + 1;
    }
    return { rooms: rooms.size, players, games: perGame };
  }

  return { handleConnection, sweep, stats };
}
