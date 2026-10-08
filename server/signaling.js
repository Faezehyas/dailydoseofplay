// Game-agnostic signaling: rooms scoped by game slug, plus an opaque relay
// for WebRTC SDP/ICE blobs. Gameplay never passes through here.
import { randomBytes } from "node:crypto";
import { clientIp, createQuota, createTokenBucket } from "./limits.js";
import { cleanName } from "../public/engine/names.js";

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const MAX_ROOMS = 10000;
const IDLE_MS = 75_000;
const MAX_KNOCKS = 4;
export const DEFAULT_LIMITS = {
  failedJoins: 5,
  windowMs: 60_000,
  approvalMs: 60_000,
  connectionsPerIp: 20,
  roomsPerIp: 5,
  messagesPerSecond: 20,
  messageBurst: 60,
  signalBytes: 16 * 1024,
  roomMs: 30 * 60_000,
};

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

export function createSignaling({ games, log = () => {}, limits = {}, clientIpHeader, now = Date.now }) {
  // games: Map slug -> { maxPlayers }
  const { failedJoins, windowMs, approvalMs, connectionsPerIp, roomsPerIp, messagesPerSecond, messageBurst, signalBytes, roomMs } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };
  // "slug/CODE" -> { game, code, secret, host, ip, createdAt, peers: Map id -> { ws, name }, knocks: Map id -> { ws, name, timer } }
  const rooms = new Map();
  const ipFailures = new Map(); // client IP -> timestamps of failed joins in the window
  const ipConnections = createQuota(connectionsPerIp);
  const ipRooms = createQuota(roomsPerIp); // every room is waiting: the host frees it when the game starts
  let nextPeerId = 1;

  const key = (game, code) => `${game}/${code}`;

  function recent(list, t) {
    while (list.length && t - list[0] >= windowMs) list.shift();
    return list;
  }

  function ipList(ws, t) {
    const ip = ws.meta.ip;
    if (!ip) return null; // unknown address: one shared bucket would lock everyone out
    if (!ipFailures.has(ip)) ipFailures.set(ip, []);
    return recent(ipFailures.get(ip), t);
  }

  function overBudget(ws, t = now()) {
    return recent(ws.meta.failures, t).length >= failedJoins || (ipList(ws, t)?.length ?? 0) >= failedJoins;
  }

  function failedJoin(ws, t = now()) {
    ws.meta.failures.push(t);
    ipList(ws, t)?.push(t);
  }

  function refuse(ws, code = "rate_limited") {
    send(ws, { t: "error", code });
    ws.close(1008, code);
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

  function dismiss(ws, code) {
    send(ws, { t: "error", code });
    ws.close(1000, code);
  }

  function closeRoom(room, code) {
    const k = key(room.game, room.code);
    rooms.delete(k);
    ipRooms.give(room.ip);
    for (const peer of room.peers.values()) peer.ws.meta.room = null;
    for (const id of [...room.knocks.keys()]) dismiss(endKnock(room, id).ws, code);
    log(`room ${k} closed`);
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
      closeRoom(room, "host_left");
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

  function onMessage(ws, raw) {
    if (ws.readyState !== 1) return; // refused or closing: ignore what was already in flight
    if (!ws.meta.bucket.take()) return refuse(ws, "too_fast");
    ws.meta.lastSeen = now();
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
        if (!ipRooms.take(ws.meta.ip)) return send(ws, { t: "error", code: "too_many_rooms" });
        const code = newRoomCode(game);
        const name = cleanName(msg.name, "Player");
        const secret = newInviteKey();
        rooms.set(key(game, code), {
          game,
          code,
          secret,
          host: ws.meta.id,
          ip: ws.meta.ip,
          createdAt: now(),
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
        const name = cleanName(msg.name, "Player");
        if (keyOk) return admit(ws, room, name);
        if (room.knocks.size >= MAX_KNOCKS) return send(ws, { t: "error", code: "room_busy" });
        leave(ws);
        const timer = setTimeout(() => {
          const knock = endKnock(room, ws.meta.id);
          if (!knock) return;
          send(room.peers.get(room.host)?.ws, { t: "knock-gone", id: ws.meta.id });
          dismiss(knock.ws, "no_answer");
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
          return dismiss(knock.ws, "declined");
        }
        if (room.peers.size >= games.get(room.game).maxPlayers) return dismiss(knock.ws, "room_full");
        return admit(knock.ws, room, knock.name);
      }
      case "leave":
        leave(ws);
        return send(ws, { t: "left" });
      case "signal": {
        const room = ws.meta.room && rooms.get(ws.meta.room);
        if (!room) return send(ws, { t: "error", code: "not_in_room" });
        if (Buffer.byteLength(JSON.stringify(msg.data ?? null)) > signalBytes) return send(ws, { t: "error", code: "too_big" });
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
    const bucket = createTokenBucket({ rate: messagesPerSecond, burst: messageBurst, now });
    ws.meta = { id: String(nextPeerId++), room: null, knock: null, ip, failures: [], bucket, lastSeen: now() };
    const counted = ipConnections.take(ip);
    ws.on("message", (raw) => onMessage(ws, raw.toString()));
    ws.on("close", () => {
      leave(ws);
      if (counted) ipConnections.give(ip);
    });
    ws.on("error", () => leave(ws));
    if (!counted) return refuse(ws, "too_many_connections");
    send(ws, { t: "hello", id: ws.meta.id });
  }

  // Drop sockets that stopped pinging (clients ping every 25 s) and rooms that never started.
  function sweep(clients, t = now()) {
    for (const ws of clients) {
      if (ws.meta && t - ws.meta.lastSeen > IDLE_MS) ws.terminate();
    }
    for (const [ip, list] of ipFailures) if (!recent(list, t).length) ipFailures.delete(ip);
    for (const room of rooms.values()) {
      if (t - room.createdAt < roomMs) continue;
      const peers = [...room.peers.values()];
      closeRoom(room, "room_expired");
      for (const peer of peers) dismiss(peer.ws, "room_expired");
    }
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
