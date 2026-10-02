// Game page shell: lobby (play with a friend / play vs robot), invite link,
// WebRTC connection, and hand-off of a Session to the game.
//
//   startGameShell({ slug, title, tagline, createRobot, onSession })
//
// onSession(session, root) mounts the game in `root` and returns { destroy }.
// createRobot(session) drives the robot's side of a local in-memory channel.
import { initShell, el, $, toast, copyText, getNickname, setNickname } from "./shell.js";
import { RoomClient } from "./signaling.js";
import { PeerChannel } from "./peer.js";
import { localPair } from "./channel.js";
import { openSession } from "./session.js";

const ERRORS = {
  no_such_room: "That room doesn't exist any more. Ask your friend for a fresh invite link.",
  room_full: "That room already has two players.",
  bad_game: "This game isn't available right now.",
  server_full: "The lobby is full right now. Please try again in a minute.",
  connect_failed: "Couldn't reach the lobby server. Check your connection and try again.",
  closed: "Lost connection to the lobby server.",
};

const NO_TURN_HELP =
  "Couldn't connect to your friend. Games here run directly between your two browsers, and some networks " +
  "(mobile data, office or school Wi-Fi, VPNs, strict firewalls) block direct connections. We don't run a relay " +
  "(TURN) server, so there's no fallback. Try both joining from home Wi-Fi, turn off VPNs, or play vs the robot.";

export function startGameShell({ slug, title, tagline = "", createRobot, onSession }) {
  initShell({ title });
  const lobbyRoot = $("#lobby");
  const gameRoot = $("#game");
  const state = { rooms: null, peer: null, session: null, game: null, robot: null, attempt: 0 };
  window.ddp = state; // handy for debugging and browser tests

  const params = new URLSearchParams(location.search);

  // ---------- views ----------
  function view(...children) {
    lobbyRoot.replaceChildren(el("div", { class: "card lobby-card" }, ...children));
    lobbyRoot.hidden = false;
    gameRoot.hidden = true;
  }

  function nicknameField() {
    const input = el("input", {
      id: "nickname",
      type: "text",
      maxlength: "20",
      autocomplete: "nickname",
      placeholder: "Your nickname (optional)",
      value: getNickname(),
    });
    input.addEventListener("change", () => setNickname(input.value));
    return el("label", { class: "field" }, el("span", {}, "Nickname"), input, el("small", {}, "Saved on this device only."));
  }

  function currentName(fallback) {
    const input = $("#nickname");
    if (input) setNickname(input.value);
    return getNickname() || fallback;
  }

  function showHome(message) {
    cleanupConnection();
    const codeInput = el("input", {
      id: "join-code",
      type: "text",
      maxlength: "4",
      autocapitalize: "characters",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "CODE",
      "aria-label": "Room code",
    });
    const joinForm = el(
      "form",
      { class: "join-row", onsubmit: (e) => (e.preventDefault(), codeInput.value.trim() && join(codeInput.value)) },
      codeInput,
      el("button", { class: "btn", type: "submit" }, "Join"),
    );
    view(
      el("h1", {}, title),
      tagline && el("p", { class: "tagline" }, tagline),
      message && el("p", { class: "notice", role: "alert" }, message),
      nicknameField(),
      el(
        "div",
        { class: "lobby-actions" },
        el("button", { class: "btn primary big", id: "play-friend", type: "button", onclick: host }, "Play with a friend"),
        el("button", { class: "btn big", id: "play-robot", type: "button", onclick: playRobot }, "Play vs robot"),
      ),
      el("div", { class: "divider" }, el("span", {}, "or join with a code")),
      joinForm,
    );
  }

  function showWaiting(code) {
    const link = `${location.origin}/${slug}/?room=${code}`;
    const linkInput = el("input", { id: "invite-link", type: "text", readonly: true, value: link, "aria-label": "Invite link" });
    linkInput.addEventListener("focus", () => linkInput.select());
    const copyBtn = el("button", {
      class: "btn primary",
      id: "copy-link",
      type: "button",
      onclick: async () => toast((await copyText(link)) ? "Invite link copied" : "Copy failed: select the link and copy it"),
    }, "Copy link");
    const shareBtn =
      navigator.share &&
      el("button", {
        class: "btn",
        type: "button",
        onclick: () => navigator.share({ title: `${title} on Daily Dose of Play`, text: "Play with me!", url: link }).catch(() => {}),
      }, "Share");
    view(
      el("h1", {}, "Invite a friend"),
      el("p", {}, "Send this link to a friend. The game starts as soon as they open it."),
      el("div", { class: "room-code", id: "room-code", "aria-label": `Room code ${code}` }, code),
      el("div", { class: "invite-row" }, linkInput, copyBtn, shareBtn),
      el("p", { class: "waiting", id: "lobby-status" }, el("span", { class: "spinner" }), "Waiting for your friend to join…"),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Cancel"),
    );
  }

  function showBusy(text) {
    view(
      el("h1", {}, title),
      el("p", { class: "waiting", id: "lobby-status" }, el("span", { class: "spinner" }), text),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Cancel"),
    );
  }

  function setStatus(text) {
    const node = $("#lobby-status");
    if (node) node.replaceChildren(el("span", { class: "spinner" }), text);
  }

  function showFailure(text, retry = host) {
    cleanupConnection();
    view(
      el("h1", {}, "Connection problem"),
      el("p", { class: "notice error", role: "alert", id: "connect-error" }, text),
      el(
        "div",
        { class: "lobby-actions" },
        el("button", { class: "btn primary", type: "button", id: "retry", onclick: () => retry() }, "Try again"),
        el("button", { class: "btn", type: "button", id: "play-robot", onclick: playRobot }, "Play vs robot"),
      ),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Back"),
    );
  }

  // ---------- connection plumbing ----------
  // Every user action bumps `attempt`; async steps from an older attempt
  // (e.g. a create that resolves after Cancel) must not touch the UI.
  function cleanupConnection() {
    state.attempt += 1;
    dropPeer();
    closeLobbySocket();
  }

  // Detach first: close() emits "failed" synchronously, and its handler only
  // acts on the current peer.
  function dropPeer() {
    const peer = state.peer;
    state.peer = null;
    peer?.close();
  }

  function closeLobbySocket() {
    if (state.rooms) {
      state.rooms.close();
      state.rooms = null;
    }
    if (params.has("room")) {
      params.delete("room");
      history.replaceState(null, "", location.pathname);
    }
  }

  async function connectRooms() {
    const rooms = new RoomClient({ game: slug });
    state.rooms = rooms;
    await rooms.connect();
    rooms.on("close", () => {
      // Once the game runs over WebRTC, the lobby socket is no longer needed.
      if (state.rooms === rooms && !state.session) showFailure(ERRORS.closed);
    });
    return rooms;
  }

  function linkPeer(rooms, peerId, initiator, index, name) {
    const peer = new PeerChannel({ rooms, peerId, initiator });
    const room = rooms.room;
    const retry = initiator ? host : () => join(room);
    state.peer = peer;
    peer.on("failed", (reason) => {
      if (state.peer === peer) showFailure(reason === "closed_before_open" ? "Your friend left before the game started." : NO_TURN_HELP, retry);
    });
    peer.on("open", async () => {
      setStatus("Connected! Starting the game…");
      try {
        const session = await openSession({ channel: peer, mode: "friend", index, name, game: slug });
        if (state.peer !== peer) return;
        startSession(session);
      } catch (err) {
        if (state.peer === peer) showFailure(err.message === "version_mismatch" ? "Your friend has a different version of this page. Both of you, please reload." : NO_TURN_HELP, retry);
      }
    });
  }

  async function host() {
    const name = currentName("Host");
    cleanupConnection();
    const attempt = state.attempt;
    showBusy("Creating a room…");
    try {
      const rooms = await connectRooms();
      if (attempt !== state.attempt) return rooms.close();
      const { room } = await rooms.create(name);
      if (attempt !== state.attempt) return;
      showWaiting(room);
      rooms.on("peer", ({ id, name: friend }) => {
        if (state.peer) return; // two-player games: first friend wins the seat
        setStatus(`${friend} joined. Connecting directly…`);
        linkPeer(rooms, id, true, 0, name);
      });
      rooms.on("leave", ({ id }) => {
        if (state.peer && state.peer.peerId === id && !state.peer.open) {
          dropPeer();
          showWaiting(room);
          toast("Your friend left. The invite link still works.");
        }
      });
    } catch (err) {
      if (attempt === state.attempt) showFailure(ERRORS[err.code] || ERRORS.connect_failed);
    }
  }

  async function join(rawCode) {
    const code = String(rawCode).trim().toUpperCase();
    const name = currentName("Guest");
    // Keep ?room= until the join settles so a reload retries it.
    state.attempt += 1;
    dropPeer();
    state.rooms?.close();
    state.rooms = null;
    const attempt = state.attempt;
    showBusy(`Joining room ${code}…`);
    try {
      const rooms = await connectRooms();
      if (attempt !== state.attempt) return rooms.close();
      const joined = await rooms.join(code, name);
      if (attempt !== state.attempt) return;
      const hostPeer = joined.peers.find((p) => p.id === joined.host);
      setStatus(`Connecting to ${hostPeer ? hostPeer.name : "your friend"}…`);
      rooms.on("host-left", () => {
        if (!state.session) showFailure("Your friend closed the room. Ask them for a new invite link.");
      });
      linkPeer(rooms, joined.host, false, 1, name);
    } catch (err) {
      if (attempt === state.attempt) showHome(ERRORS[err.code] || ERRORS.connect_failed);
    }
  }

  async function playRobot() {
    cleanupConnection();
    const name = currentName("You");
    const [mine, theirs] = localPair();
    const [session, robotSession] = await Promise.all([
      openSession({ channel: mine, mode: "robot", index: 0, name, game: slug }),
      openSession({ channel: theirs, mode: "robot", index: 1, name: "Robot", game: slug }),
    ]);
    robotSession.on("rematch", (votes) => votes.them && !votes.me && robotSession.requestRematch());
    state.robot = createRobot(robotSession);
    startSession(session);
  }

  // ---------- game hand-off ----------
  function startSession(session) {
    state.session = session;
    // Two-player rooms are done once the DataChannel is up: free the room.
    closeLobbySocket();
    lobbyRoot.hidden = true;
    gameRoot.hidden = false;
    gameRoot.replaceChildren();
    state.game = onSession(session, gameRoot, { leave: () => leaveGame() });
    session.on("end", (reason) => {
      if (reason === "self") return;
      const who = session.opponent.name;
      showEnded(reason === "left" ? `${who} left the game.` : `The connection to ${who} was lost.`);
    });
  }

  function showEnded(text) {
    const overlay = el(
      "div",
      { class: "overlay", id: "ended" },
      el(
        "div",
        { class: "card" },
        el("p", { class: "notice", role: "alert" }, text),
        el("button", { class: "btn primary", type: "button", onclick: () => leaveGame() }, "Back to lobby"),
      ),
    );
    gameRoot.append(overlay);
  }

  function leaveGame(message) {
    const session = state.session;
    state.session = null;
    session?.leave();
    state.game?.destroy?.();
    state.game = null;
    state.robot?.destroy?.();
    state.robot = null;
    state.peer = null;
    showHome(message);
  }

  addEventListener("pagehide", () => state.session?.leave());

  // ---------- entry ----------
  const code = params.get("room");
  if (code) join(code);
  else if (params.has("robot")) playRobot();
  else showHome();
}
