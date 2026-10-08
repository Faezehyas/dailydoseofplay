// Game page shell: lobby (play with friends / play vs robot), invite link,
// waiting room, and hand-off of a Session to the game. How players get
// connected lives in room.js; this file is only the UI around it.
//
//   startGameShell({ slug, title, tagline, createRobot, onSession, minPlayers, maxPlayers, robots, layout })
//
// onSession(session, root) mounts the game in `root` and returns { destroy }.
// createRobot(session) drives one robot seat over an in-memory group; robots
// is how many seats (a number, or a function read when a robot game starts).
// maxPlayers must match the game's entry in games.json (the server enforces it).
// layout is the page column while the game is on show: "narrow", "medium" or
// "wide" (the default); the lobby is always narrow. Sizes live in theme.css.
import { initShell, el, $, toast, copyText, getNickname, setNickname, setTabAlert } from "./shell.js";
import { HostRoom, GuestRoom, RoomError, localRoom } from "./room.js";
import { checkName } from "./names.js";

const ERRORS = {
  no_such_room: "That room doesn't exist any more. Ask your friend for a fresh invite link.",
  room_full: "That room is already full.",
  room_busy: "Too many people are asking to join that room right now. Ask your friend for the invite link.",
  declined: "The room's host didn't let you in. If they're your friend, ask them for the invite link.",
  no_answer: "Nobody let you in within a minute. Ask your friend for the invite link, or try the code again.",
  rate_limited: "Too many wrong room codes. Wait a minute, or ask your friend for the invite link.",
  bad_game: "This game isn't available right now.",
  server_full: "The lobby is full right now. Please try again in a minute.",
  too_many_connections: "Too many game tabs on your network are connected to the lobby. Close a few and try again.",
  too_many_rooms: "Your network already has 5 rooms waiting for players. Start or close one of them first.",
  too_fast: "The lobby closed the connection because this page sent too many messages. Please reload.",
  room_expired: "The room closed because the game didn't start within 30 minutes. Make a new one to play.",
  connect_failed: "Couldn't reach the lobby server. Check your connection and try again.",
  closed: "Lost connection to the lobby server.",
  lobby_lost: "Lost connection to the lobby server.",
  host_gone: "Your friend left before the game started.",
  host_left: "Your friend closed the room. Ask them for a new invite link.",
  version_mismatch: "Your friend has a different version of this page. Both of you, please reload.",
  message_too_big: "A player's browser sent something unexpected.",
};

// Why a nickname isn't used (see names.js); the player then plays under the default name.
const NAME_PROBLEMS = {
  link: "Not used: no links or @handles, please.",
  word: "Not used: please pick a kinder nickname.",
  chars: "Not used: only letters, numbers, spaces and . _ - ' are allowed.",
};

const NO_TURN_HELP =
  "Couldn't connect to your friend. Games here run directly between your browsers, and some networks " +
  "(mobile data, office or school Wi-Fi, VPNs, strict firewalls) block direct connections. We don't run a relay " +
  "(TURN) server, so there's no fallback. Try both joining from home Wi-Fi, turn off VPNs, or play vs the robot.";

const LAYOUTS = ["narrow", "medium", "wide"];

export function startGameShell({ slug, title, tagline = "", createRobot, onSession, minPlayers = 2, maxPlayers = 2, robots = 1, layout = "wide" }) {
  initShell({ title });
  const lobbyRoot = $("#lobby");
  const gameRoot = $("#game");
  // The lobby, settings, game and "How to play" share one column (theme.css).
  const page = lobbyRoot.closest(".page");
  const showView = (name) => {
    if (page) page.dataset.view = name;
  };
  if (page) page.dataset.layout = LAYOUTS.includes(layout) ? layout : "wide";
  showView("lobby");
  const duel = maxPlayers === 2;
  const state = { room: null, session: null, game: null, robot: null, robots: [], attempt: 0 };
  window.ddp = state; // handy for debugging and browser tests

  const params = new URLSearchParams(location.search);

  // ---------- views ----------
  function view(...children) {
    lobbyRoot.replaceChildren(el("div", { class: "card lobby-card" }, ...children));
    showView("lobby");
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
      "aria-describedby": "nickname-problem",
    });
    const problem = el("small", { id: "nickname-problem", class: "field-problem", "aria-live": "polite" });
    const check = () => {
      problem.textContent = NAME_PROBLEMS[checkName(input.value).problem] ?? "";
      problem.hidden = !problem.textContent;
    };
    input.addEventListener("input", check);
    input.addEventListener("change", () => (setNickname(input.value), check()));
    check();
    return el("label", { class: "field" }, el("span", {}, "Nickname"), input, problem, el("small", {}, "Saved on this device only."));
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
        el("button", { class: "btn primary big", id: "play-friend", type: "button", onclick: host }, duel ? "Play with a friend" : "Play with friends"),
        el("button", { class: "btn big", id: "play-robot", type: "button", onclick: playRobot }, "Play vs robot"),
      ),
      el("div", { class: "divider" }, el("span", {}, "or join with a code")),
      joinForm,
    );
  }

  // An invite link stops here first so the friend can pick a nickname before joining.
  function showInvite(code, key) {
    view(
      el("h1", {}, title),
      el("p", {}, `You're invited to room ${code}.`),
      el(
        "form",
        { class: "invite-join", onsubmit: (e) => (e.preventDefault(), join(code, key)) },
        nicknameField(),
        el("div", { class: "lobby-actions" }, el("button", { class: "btn primary big", id: "join-room", type: "submit" }, "Join room")),
      ),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Back"),
    );
  }

  function showWaiting(room) {
    const link = `${location.origin}/${slug}/?room=${room.code}&key=${encodeURIComponent(room.key)}`;
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
      el("h1", {}, duel ? "Invite a friend" : "Invite friends"),
      el(
        "p",
        {},
        duel
          ? "Send this link to a friend. The game starts as soon as they open it."
          : `Send this link to up to ${maxPlayers - 1} friends. Start when everyone is in; a full room starts by itself.`,
        " Someone who types the code instead has to be let in by you.",
      ),
      el("div", { class: "room-code", id: "room-code", "aria-label": `Room code ${room.code}` }, room.code),
      el("div", { class: "invite-row" }, linkInput, copyBtn, shareBtn),
      el("ul", { class: "roster", id: "roster", "aria-label": "Players", hidden: duel }),
      el("p", { class: "waiting", id: "lobby-status" }, el("span", { class: "spinner" }), duel ? "Waiting for your friend to join…" : "Waiting for friends to join…"),
      !duel && el("button", { class: "btn primary", type: "button", id: "start-game", disabled: true, onclick: () => begin(room) }, "Start game"),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Cancel"),
    );
    showRoster(room);
  }

  // Players so far (4-seat games), then anyone with only the code asking to join.
  function showRoster(room) {
    const list = $("#roster");
    if (!list) return;
    const players = room.players;
    const knocks = room.knocking;
    list.hidden = duel && knocks.length === 0;
    setTabAlert(knocks.length ? `${knocks[0].name} wants to join` : null);
    list.replaceChildren(
      ...(duel ? [] : players).map((p, i) =>
        el("li", { class: p.ready ? "ready" : "" }, el("span", {}, p.name), el("small", {}, i === 0 ? "host" : p.ready ? "in" : "connecting…")),
      ),
      ...knocks.map(({ id, name }) =>
        el(
          "li",
          { class: "knock" },
          el("span", {}, `${name} wants to join`),
          el(
            "span",
            { class: "knock-actions" },
            el("button", { class: "btn small primary", type: "button", onclick: () => room.accept(id) }, "Accept"),
            el("button", { class: "btn small", type: "button", onclick: () => room.decline(id) }, "Decline"),
          ),
        ),
      ),
    );
    if (duel) return;
    const ready = players.filter((p) => p.ready).length;
    const start = $("#start-game");
    start.disabled = ready < minPlayers;
    start.textContent = ready < minPlayers ? `Start game (needs ${minPlayers} players)` : `Start game (${ready} players)`;
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
    const room = state.room;
    state.room = null;
    room?.close();
    setTabAlert(null);
    clearRoomParam();
  }

  function clearRoomParam() {
    if (params.has("room") || params.has("key")) {
      params.delete("room");
      params.delete("key");
      history.replaceState(null, "", location.pathname);
    }
  }

  async function host() {
    const name = currentName("Host");
    cleanupConnection();
    const attempt = state.attempt;
    const current = () => attempt === state.attempt;
    showBusy("Creating a room…");
    const room = new HostRoom({ game: slug, name });
    state.room = room;
    try {
      await room.open();
    } catch (err) {
      if (current()) showFailure(ERRORS[err.code] || ERRORS.connect_failed);
      return;
    }
    if (!current()) return;
    showWaiting(room);
    room.on("lost", (reason) => current() && showFailure(ERRORS[reason] || ERRORS.closed));
    room.on("knocks", () => current() && showRoster(room));
    room.on("players", (players) => {
      if (!current()) return;
      const ready = players.filter((p) => p.ready).length;
      if (ready >= maxPlayers) return begin(room);
      if (!duel) return showRoster(room);
      const joining = players.find((p, i) => i > 0 && !p.ready);
      setStatus(joining ? `${joining.name} joined. Connecting directly…` : "Waiting for your friend to join…");
    });
    room.on("guest-gone", ({ name: who, reason }) => {
      if (!current()) return;
      const why =
        reason === "message_too_big"
          ? ERRORS.message_too_big
          : reason === "left" || reason === "closed_before_open"
            ? `${duel ? "Your friend" : who} left.`
            : `Couldn't connect to ${who}.`;
      toast(`${why} The invite link still works.`);
    });
  }

  function begin(room) {
    if (room !== state.room) return;
    state.room = null;
    setTabAlert(null);
    startSession(room.start());
  }

  // key comes only from an invite link; a typed code asks the host to let us in.
  async function join(rawCode, key) {
    const code = String(rawCode).trim().toUpperCase();
    const name = currentName("Guest");
    // Keep ?room= until the join settles so a reload retries it.
    state.attempt += 1;
    state.room?.close();
    const attempt = state.attempt;
    const current = () => attempt === state.attempt;
    showBusy(`Joining room ${code}…`);
    const room = new GuestRoom({ game: slug, code, key, name });
    state.room = room;
    let host = "your friend";
    room.on("status", ({ step, host: hostName, players }) => {
      if (!current()) return;
      if (step === "knocking") {
        setStatus("Asking the room's host to let you in…");
      } else if (step === "connecting") {
        host = hostName || host;
        setStatus(`Connecting to ${host}…`);
      } else if (duel) {
        setStatus("Connected! Starting the game…");
      } else {
        setStatus(`Connected! Waiting for ${host} to start${players ? ` (${players.length} players in)` : ""}…`);
      }
    });
    let session;
    try {
      session = await room.join();
    } catch (err) {
      if (!current()) return;
      if (!(err instanceof RoomError)) return showHome(ERRORS[err.code] || ERRORS.connect_failed);
      return showFailure(ERRORS[err.code] || NO_TURN_HELP, () => join(code, key));
    }
    if (!current()) return session.leave();
    state.room = null;
    startSession(session);
  }

  function playRobot() {
    cleanupConnection();
    const name = currentName("You");
    const count = typeof robots === "function" ? robots() : robots;
    const names = [name, ...Array.from({ length: count }, (_, i) => (count === 1 ? "Robot" : `Robot ${i + 1}`))];
    const [session, ...robotSessions] = localRoom({ game: slug, names, mode: "robot" });
    state.robots = robotSessions.map((robotSession) => {
      robotSession.on("rematch", (votes) => votes.them && !votes.me && robotSession.requestRematch());
      return createRobot(robotSession);
    });
    state.robot = state.robots[0];
    startSession(session);
  }

  // ---------- game hand-off ----------
  function startSession(session) {
    state.session = session;
    clearRoomParam();
    showView("game");
    lobbyRoot.hidden = true;
    gameRoot.hidden = false;
    gameRoot.replaceChildren();
    state.game = onSession(session, gameRoot, { leave: () => leaveGame() });
    session.on("end", (reason, seat) => {
      if (reason === "self") return;
      const who = session.players[seat]?.name ?? session.opponent.name;
      if (reason === "message_too_big") return showEnded(ERRORS.message_too_big);
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
    for (const robot of state.robots) robot?.destroy?.();
    state.robots = [];
    state.robot = null;
    showHome(message);
  }

  addEventListener("pagehide", () => state.session?.leave());

  // ---------- entry ----------
  // Deferred until the game's module has finished loading: onSession may use
  // bindings declared after its startGameShell() call.
  queueMicrotask(() => {
    const code = params.get("room");
    if (code) showInvite(code.trim().toUpperCase(), params.get("key") || undefined);
    else if (params.has("robot")) playRobot();
    else showHome();
  });
}
