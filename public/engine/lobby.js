// Game page shell: lobby (play with friends / play vs robot), invite link,
// waiting room, and hand-off of a Session to the game. How players get
// connected lives in room.js; this file is only the UI around it.
//
//   startGameShell({ slug, title, tagline, createRobot, onSession, minPlayers, maxPlayers, robots, layout, settings })
//
// onSession(session, root, shell) mounts the game in `root` and returns { destroy }.
// shell.leave() goes back to the lobby; while the game says a friend match is
// on (shell.setInProgress(true)), it asks first. The browser's Back does the same,
// and closing or reloading the tab gets the browser's own prompt.
// createRobot(session) drives one robot seat over an in-memory group; robots
// is how many seats (a number, or a function read when a robot game starts).
// maxPlayers must match the game's entry in games.json (the server enforces it).
// The lobby tagline is the game's description in games.json; `tagline`
// overrides it (older games passed their own).
// layout is the page column while the game is on show: "narrow", "medium" or
// "wide" (the default); the lobby is always narrow. Sizes live in theme.css.
// settings is the game's gameSettings() (settings.js): the home screen shows
// them inside the lobby card, and the host's waiting screen their summary.
import { initShell, el, $, toast, copyText, getNickname, setNickname, setTabAlert, askBeforeLeaving } from "./shell.js";
import { confirmDialog } from "./confirm.js";
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

// Room codes, as server/signaling.js makes them (no I, L, O, 0 or 1).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

export function startGameShell({ slug, title, tagline = "", createRobot, onSession, minPlayers = 2, maxPlayers = 2, robots = 1, layout = "wide", settings }) {
  initShell({ title });
  const lobbyRoot = $("#lobby");
  const gameRoot = $("#game");
  // The lobby, game and "How to play" share one column (theme.css).
  const page = lobbyRoot.closest(".page");
  const showView = (name) => {
    if (page) page.dataset.view = name;
  };
  if (page) page.dataset.layout = LAYOUTS.includes(layout) ? layout : "wide";
  showView("lobby");
  const duel = maxPlayers === 2;
  const state = { room: null, session: null, game: null, mustAsk: () => false, leave: null, robot: null, robots: [], attempt: 0 };
  window.ddp = state; // handy for debugging and browser tests

  const params = new URLSearchParams(location.search);

  // ---------- views ----------
  // Progress text for screen readers ("Creating a room…", "Bo joined"), and
  // join errors. It outlives the views, so each change is read out;
  // connection problems use role="alert".
  const progress = el("p", { class: "sr-only", id: "lobby-progress", role: "status" });
  lobbyRoot.append(progress);
  let firstView = true;

  // The lobby shows at once; the description fills in when games.json arrives.
  const taglineEl = el("p", { class: "tagline", hidden: !tagline }, tagline);
  if (!tagline) {
    fetch("/games.json", { cache: "no-cache" })
      .then((res) => res.json())
      .then(({ games }) => {
        taglineEl.textContent = games.find((g) => g.slug === slug)?.description ?? "";
        taglineEl.hidden = !taglineEl.textContent;
      })
      .catch(() => {});
  }

  // A new view takes focus to its heading, except on page load.
  function view(...children) {
    const card = el("div", { class: "card lobby-card" }, ...children);
    const old = $(".lobby-card", lobbyRoot);
    if (old) old.replaceWith(card);
    else lobbyRoot.prepend(card);
    progress.textContent = "";
    showView("lobby");
    lobbyRoot.hidden = false;
    gameRoot.hidden = true;
    $("h1", card).tabIndex = -1;
    if (!firstView) focusHeading();
    firstView = false;
  }

  function focusHeading() {
    $("h1", lobbyRoot).focus();
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

  // The typed nickname, or the saved default when the field is empty or refused.
  function currentName() {
    const input = $("#nickname");
    return (input && setNickname(input.value)) || getNickname();
  }

  // error: why the last join failed, shown under the code field, which keeps `code`.
  function showHome(error, code = "") {
    cleanupConnection();
    const codeInput = el("input", {
      id: "join-code",
      type: "text",
      value: code,
      autocapitalize: "characters",
      autocomplete: "off",
      enterkeyhint: "go",
      spellcheck: "false",
      placeholder: "CODE",
      "aria-label": "Room code",
      "aria-describedby": "join-error",
    });
    const joinError = el("p", { class: "notice error", id: "join-error", hidden: true });
    const showError = (text) => {
      joinError.textContent = text;
      joinError.hidden = !text;
      progress.textContent = text;
    };
    // Uppercase, drop spaces and dashes, refuse anything else; a full code joins at once.
    codeInput.addEventListener("input", () => {
      const typed = [...codeInput.value.toUpperCase().replace(/[\s-]/g, "")];
      const kept = typed.filter((c) => CODE_ALPHABET.includes(c));
      const clean = kept.join("").slice(0, CODE_LENGTH);
      if (codeInput.value !== clean) codeInput.value = clean;
      showError(kept.length < typed.length ? "Codes use letters and the numbers 2–9" : "");
      if (clean.length === CODE_LENGTH) join(clean);
    });
    const joinForm = el(
      "form",
      { class: "join-row", onsubmit: (e) => (e.preventDefault(), codeInput.value && join(codeInput.value)) },
      codeInput,
      el("button", { class: "btn", type: "submit" }, "Join"),
    );
    view(
      el("h1", {}, title),
      taglineEl,
      nicknameField(),
      settings?.panel(),
      el(
        "div",
        { class: "lobby-actions" },
        el("button", { class: "btn primary big", id: "play-friend", type: "button", onclick: host }, duel ? "Play with a friend" : "Play with friends"),
        el("button", { class: "btn big", id: "play-robot", type: "button", onclick: playRobot }, "Play vs robot"),
      ),
      el("p", { class: "lobby-note", id: "direct-note" }, "Games connect your browser directly to your friends'. Play with people you know."),
      el("div", { class: "divider" }, el("span", {}, "or join with a code")),
      joinForm,
      joinError,
    );
    if (!error) return;
    // The code stays in the field, focused and ready to fix; the error is read out too.
    showError(error);
    codeInput.focus();
    codeInput.select();
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
    const linkInput = el("input", { id: "invite-link", class: "mono", type: "text", readonly: true, value: link, "aria-label": "Invite link" });
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
      // Screen readers get the code from the label, spaced so each letter is
      // read on its own; the big code below is for the eyes.
      el("p", { class: "room-code-label" }, "Room code", el("span", { class: "sr-only" }, ` ${[...room.code].join(" ")}`)),
      // One span per letter, so the letters can settle in one by one (theme.css).
      el(
        "div",
        { class: "room-code mono", id: "room-code", "aria-hidden": "true" },
        [...room.code].map((c, i) => el("span", { style: `--i: ${i}` }, c)),
      ),
      el("div", { class: "invite-row" }, linkInput, copyBtn, shareBtn),
      settings &&
        el(
          "div",
          { class: "room-settings", id: "room-settings" },
          el("p", { class: "room-settings-label" }, "Game settings"),
          el("p", { class: "settings-line" }, settings.summary(false)),
        ),
      el("ul", { class: "roster", id: "roster", "aria-label": "Players", hidden: duel }),
      el("p", { class: "waiting", id: "lobby-status" }),
      !duel && el("button", { class: "btn primary", type: "button", id: "start-game", disabled: true, onclick: () => begin(room) }, "Start game"),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Cancel"),
    );
    setStatus(duel ? "Waiting for your friend to join…" : "Waiting for friends to join…");
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
    // Accept and Decline go with their row, so focus moves back to the heading.
    const hadFocus = list.contains(document.activeElement);
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
    if (hadFocus) focusHeading();
    if (duel) return;
    const ready = players.filter((p) => p.ready).length;
    const start = $("#start-game");
    start.disabled = ready < minPlayers;
    start.textContent = ready < minPlayers ? `Start game (needs ${minPlayers} players)` : `Start game (${ready} players)`;
  }

  function showBusy(text) {
    view(
      el("h1", {}, title),
      el("p", { class: "waiting", id: "lobby-status" }),
      el("button", { class: "btn ghost", type: "button", onclick: () => showHome() }, "Cancel"),
    );
    setStatus(text);
  }

  function setStatus(...text) {
    const node = $("#lobby-status");
    if (!node) return;
    node.replaceChildren(el("span", { class: "spinner" }), ...text);
    progress.textContent = node.textContent;
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
    const name = currentName();
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
    let knockCount = 0;
    room.on("knocks", (knocks) => {
      if (!current()) return;
      if (knocks.length > knockCount) progress.textContent = `${knocks.at(-1).name} wants to join`;
      knockCount = knocks.length;
      showRoster(room);
    });
    let seated = [name]; // who is in, in join order, to say who just joined
    room.on("players", (players) => {
      if (!current()) return;
      const ready = players.filter((p) => p.ready).length;
      if (ready >= maxPlayers) return begin(room);
      if (!duel) {
        const inRoom = players.filter((p) => p.ready).map((p) => p.name);
        if (inRoom.length > seated.length) progress.textContent = `${inRoom.find((n, i) => n !== seated[i])} joined`;
        seated = inRoom;
        return showRoster(room);
      }
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
    const name = currentName();
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
        setStatus("Waiting for the host to let you in…");
      } else if (step === "connecting") {
        host = hostName || host;
        setStatus(`Connecting to ${host}…`);
      } else if (duel) {
        setStatus("Connected! Starting the game…");
      } else {
        const count = players ? [" (", el("span", { class: "mono" }, `${players.length} players in`), ")"] : [];
        setStatus(`Connected! Waiting for ${host} to start`, ...count, "…");
      }
    });
    let session;
    try {
      session = await room.join();
    } catch (err) {
      if (!current()) return;
      if (!(err instanceof RoomError)) return showHome(ERRORS[err.code] || ERRORS.connect_failed, code);
      return showFailure(ERRORS[err.code] || NO_TURN_HELP, () => join(code, key));
    }
    if (!current()) return session.leave();
    state.room = null;
    startSession(session);
  }

  function playRobot() {
    cleanupConnection();
    const name = currentName();
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
    // The game has a history entry of its own, so Back leaves it as Leave does.
    history.pushState({ game: slug }, "");
    let inProgress = false;
    state.mustAsk = () => inProgress && session.mode === "friend" && askBeforeLeaving();
    state.leave = async () => {
      if (state.mustAsk() && !(await confirmLeave(session))) return;
      leaveGame();
    };
    state.game = onSession(session, gameRoot, { leave: state.leave, setInProgress: (on) => (inProgress = on) });
    session.on("end", (reason, seat) => {
      inProgress = false;
      if (reason === "self") return;
      const who = session.players[seat]?.name ?? session.opponent.name;
      if (reason === "message_too_big") return showEnded(ERRORS.message_too_big);
      showEnded(reason === "left" ? `${who} left the game.` : `The connection to ${who} was lost.`);
    });
  }

  function confirmLeave(session) {
    const text = session.players.length === 2 ? `${session.opponent.name} will be told you left.` : "It ends for everyone.";
    return confirmDialog({ title: "Leave the game?", text, yes: "Leave" });
  }

  function showEnded(text) {
    const overlay = el(
      "div",
      { class: "overlay", id: "ended" },
      el(
        "div",
        { class: "card" },
        el("h2", { tabindex: "-1", "aria-describedby": "ended-why" }, "Game ended"),
        el("p", { class: "notice", id: "ended-why" }, text),
        el("button", { class: "btn primary", type: "button", onclick: () => leaveGame() }, "Back to lobby"),
      ),
    );
    gameRoot.append(overlay);
    $("h2", overlay).focus();
  }

  function leaveGame(message) {
    const session = state.session;
    state.session = null;
    if (history.state?.game === slug) history.back();
    session?.leave();
    state.game?.destroy?.();
    state.game = null;
    for (const robot of state.robots) robot?.destroy?.();
    state.robots = [];
    state.robot = null;
    showHome(message);
  }

  addEventListener("pagehide", () => state.session?.leave());

  // Closing or reloading the tab mid-match: only the browser's own prompt can ask.
  addEventListener("beforeunload", (e) => {
    if (!state.session || !state.mustAsk()) return;
    e.preventDefault();
    e.returnValue = true; // older Safari and Chrome
  });

  // Back during a game: stay on the game's entry and leave as Leave does. Back
  // while the question is open closes it, like Esc.
  addEventListener("popstate", () => {
    if (!state.session) return;
    history.pushState({ game: slug }, "");
    const open = $("#confirm");
    if (open) open.close();
    else state.leave();
  });

  // ---------- entry ----------
  // Deferred until the game's module has finished loading: onSession may use
  // bindings declared after its startGameShell() call.
  queueMicrotask(() => {
    const code = params.get("room");
    if (code) showInvite(code.trim().toUpperCase(), params.get("key") || undefined);
    else if (params.has("robot")) playRobot();
    else if (params.has("friend")) {
      // Dropped first, so a reload doesn't create a second room.
      history.replaceState(null, "", location.pathname);
      host();
    } else showHome();
  });
}
