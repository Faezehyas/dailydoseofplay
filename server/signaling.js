// Game-agnostic signaling: rooms scoped by game slug, plus an opaque relay
// for WebRTC SDP/ICE blobs. Gameplay never passes through here.

const ROOM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;
const MAX_ROOMS = 10000;
const IDLE_MS = 75_000;

export function createSignaling({ games, log = () => {} }) {
  // games: Map slug -> { maxPlayers }
  const rooms = new Map(); // "slug/CODE" -> { game, code, host, peers: Map id -> { ws, name } }
  let nextPeerId = 1;

  const key = (game, code) => `${game}/${code}`;

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
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(room, msg, except) {
    for (const [id, peer] of room.peers) if (id !== except) send(peer.ws, msg);
  }

  function leave(ws) {
    const k = ws.meta.room;
    if (!k) return;
    ws.meta.room = null;
    const room = rooms.get(k);
    if (!room) return;
    room.peers.delete(ws.meta.id);
    if (room.host === ws.meta.id || room.peers.size === 0) {
      broadcast(room, { t: "host-left" });
      for (const peer of room.peers.values()) peer.ws.meta.room = null;
      rooms.delete(k);
      log(`room ${k} closed`);
    } else {
      broadcast(room, { t: "leave", id: ws.meta.id });
    }
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
        rooms.set(key(game, code), {
          game,
          code,
          host: ws.meta.id,
          peers: new Map([[ws.meta.id, { ws, name }]]),
        });
        ws.meta.room = key(game, code);
        log(`room ${game}/${code} created by ${ws.meta.id}`);
        return send(ws, { t: "created", game, room: code, id: ws.meta.id });
      }
      case "join": {
        const game = String(msg.game || "");
        if (!games.has(game)) return send(ws, { t: "error", code: "bad_game" });
        const code = String(msg.room || "").trim().toUpperCase();
        const room = rooms.get(key(game, code));
        if (!room) return send(ws, { t: "error", code: "no_such_room" });
        if (room.peers.has(ws.meta.id)) return send(ws, { t: "error", code: "already_in_room" });
        if (room.peers.size >= games.get(game).maxPlayers) return send(ws, { t: "error", code: "room_full" });
        leave(ws);
        const name = cleanName(msg.name);
        room.peers.set(ws.meta.id, { ws, name });
        ws.meta.room = key(game, code);
        const peers = [...room.peers].map(([id, p]) => ({ id, name: p.name }));
        send(ws, { t: "joined", game, room: code, id: ws.meta.id, host: room.host, peers });
        broadcast(room, { t: "peer", id: ws.meta.id, name }, ws.meta.id);
        return;
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

  function handleConnection(ws) {
    ws.meta = { id: String(nextPeerId++), room: null, lastSeen: Date.now() };
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
