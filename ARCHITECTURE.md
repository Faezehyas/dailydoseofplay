# Architecture

Daily Dose of Play is a free, no-login site of browser games for two or more
players (Chutes and Ladders, Ludo and Crazy Eights seat up to four). One small Node server
on Wasmer Edge serves the pages and introduces players to each other. The games
themselves run browser to browser over WebRTC DataChannels: with more than
two players, every guest connects to the room creator's browser, which
forwards messages between them (see **Groups** below).

The diagrams here are Mermaid, which GitHub draws from the text; edit them
like the prose. They are the maintained map of the code.

**What runs where.** Every push to `main` deploys the app. Browsers load the
pages from it and use `/ws` only until their DataChannels open. The public
STUN servers (in `peer.js`) tell each browser its public address; there is no
TURN server.

```mermaid
flowchart TB
  github["GitHub: Faezehyas/dailydoseofplay"]
  github -- "every push to main deploys" --> app
  subgraph app ["Wasmer Edge: one app, one URL"]
    home["GET /<br>home page (cards from games.json)"]
    game["GET /#lt;slug#gt;/<br>a game: public/#lt;slug#gt;/"]
    engine["GET /engine/…<br>shared browser engine"]
    ws["WS /ws<br>signaling: rooms scoped by game slug,<br>opaque SDP/ICE relay"]
    healthz["GET /healthz<br>{ok, rooms, players, games} (CORS *)"]
  end
  app -- "pages, and WebSocket only until connected" --> two
  app -- "pages, and WebSocket only until connected" --> star
  subgraph two ["Two players: one direct link"]
    a["browser A<br>rules + own secret state"] <== "DataChannel:<br>moves, answers, shared random" ==> b["browser B<br>rules + own secret state"]
  end
  subgraph star ["3 or 4 players: a star"]
    hub["host's browser (the hub)<br>forwards every message"]
    g1["guest 1"] <== "DataChannel" ==> hub
    g2["guest 2"] <== "DataChannel" ==> hub
    g3["guest 3"] <== "DataChannel" ==> hub
  end
  stun["public STUN servers<br>(Google, Cloudflare)"]
  stun -. "your public address" .- two
  stun -. "your public address" .- star
```

**Privacy page.** `/privacy/` (`public/privacy/index.html`, a static page on
`engine/boot.js`) tells visitors, in plain words, what the site stores on
their device, what the lobby server sees and logs, and who sees their address
over WebRTC and STUN. It lists every `localStorage` key: `test/server.test.js`
fails when a `"ddp-…"` key in `public/` is missing from it. Change the page
with the facts it states (a log line, an ICE server, a new kind of data); the
accounts work (F1) must rewrite it before it ships.

## Layers

| Layer | Files | Knows about games? |
|---|---|---|
| Server | `server/app.js` (HTTP routes, static files, security headers), `server/signaling.js` (rooms, invite keys, knocks, join rate limits, relay), `server/limits.js` (per-client limits), `server/server.js` (entry). It imports the nickname rules from `public/engine/names.js`. | Only slugs and `maxPlayers` from `public/games.json` |
| Engine (browser) | `public/engine/` | No |
| Game | `public/<slug>/` | Yes, only its own |

**Import graph.** An arrow is an `import`. The game box stands for every
`public/<slug>/` folder, so its arrows are those of all the games together;
`art.js` and `sounds.js` are optional and `match.js` is Sea Battle's alone.
Dotted arrows are reads of `games.json`, not imports. Every module in
`public/` and `server/` has a box: `test/architecture.test.js` fails when one
is missing and names the line to add.

```mermaid
flowchart TB
  subgraph pages ["Pages"]
    p_home["home.js"]
    p_main["main.js<br>one per game"]
  end
  subgraph game ["A game's folder: public/#lt;slug#gt;/"]
    g_rules["rules.js"]
    g_robot["robot.js"]
    g_settings["settings.js"]
    g_sounds["sounds.js"]
    g_art["art.js"]
    g_match["match.js<br>Sea Battle only"]
  end
  subgraph engine ["Engine: public/engine/"]
    e_boot["boot.js<br>static pages"]
    e_lobby["lobby.js"]
    e_room["room.js"]
    e_group["group.js"]
    e_signaling["signaling.js"]
    e_peer["peer.js"]
    e_session["session.js"]
    e_turn_match["turn-match.js"]
    e_card_match["card-match.js"]
    e_deck_service["deck-service.js"]
    e_deck_worker["deck-worker.js<br>Web Worker"]
    e_deck_crypto["deck-crypto.js"]
    e_vendor_mental_poker_cards_play["vendor/mental-poker/cards_play.js"]
    e_base64["base64.js"]
    e_fair["fair.js"]
    e_rng["rng.js"]
    e_channel["channel.js"]
    e_shell["shell.js"]
    e_players["players.js"]
    e_result["result.js"]
    e_celebrate["celebrate.js"]
    e_chimes["chimes.js"]
    e_confirm["confirm.js"]
    e_settings["settings.js"]
    e_names["names.js"]
    e_robot_pace["robot-pace.js"]
    e_sound["sound.js"]
    e_synth["synth.js"]
    e_loudness["loudness.js"]
    e_theme["theme.css<br>linked by every page"]
  end
  subgraph server ["Server: server/"]
    s_server["server.js"]
    s_app["app.js"]
    s_signaling["signaling.js"]
    s_limits["limits.js"]
    s_ws["ws"]
  end
  games_json[("public/games.json")]

  p_home --> e_shell
  p_main --> e_celebrate
  p_main --> e_lobby
  p_main --> e_players
  p_main --> e_result
  p_main --> e_session
  p_main --> e_shell
  p_main --> e_turn_match
  p_main --> g_art
  p_main --> g_match
  p_main --> g_robot
  p_main --> g_rules
  p_main --> g_settings
  p_main --> g_sounds
  g_art --> g_rules
  g_match --> e_channel
  g_match --> e_fair
  g_match --> g_rules
  g_robot --> e_rng
  g_robot --> e_robot_pace
  g_robot --> e_session
  g_robot --> e_turn_match
  g_robot --> g_match
  g_robot --> g_rules
  g_rules --> e_rng
  g_rules --> e_turn_match
  g_settings --> e_settings
  g_settings --> g_robot
  g_settings --> g_rules
  g_sounds --> e_sound
  g_sounds --> e_synth
  e_boot --> e_shell
  e_card_match --> e_base64
  e_card_match --> e_channel
  e_card_match --> e_deck_service
  e_card_match --> e_fair
  e_card_match --> e_robot_pace
  e_card_match --> e_session
  e_card_match --> e_turn_match
  e_celebrate --> e_chimes
  e_celebrate --> e_shell
  e_chimes --> e_sound
  e_chimes --> e_synth
  e_deck_crypto --> e_deck_service
  e_deck_crypto --> e_vendor_mental_poker_cards_play
  e_deck_service --> e_deck_crypto
  e_deck_worker --> e_deck_crypto
  e_deck_worker --> e_deck_service
  e_fair --> e_rng
  e_group --> e_channel
  e_confirm --> e_shell
  e_lobby --> e_confirm
  e_lobby --> e_names
  e_lobby --> e_room
  e_lobby --> e_shell
  e_peer --> e_channel
  e_players --> e_shell
  e_result --> e_celebrate
  e_result --> e_shell
  e_room --> e_channel
  e_room --> e_group
  e_room --> e_peer
  e_room --> e_session
  e_room --> e_signaling
  e_session --> e_channel
  e_session --> e_group
  e_session --> e_names
  e_settings --> e_shell
  e_shell --> e_names
  e_shell --> e_sound
  e_signaling --> e_channel
  e_sound --> e_loudness
  e_turn_match --> e_channel
  e_turn_match --> e_fair
  e_turn_match --> e_robot_pace
  e_turn_match --> e_session
  s_server --> s_app
  s_app --> s_signaling
  s_app --> s_ws
  s_signaling --> s_limits
  s_signaling --> e_names
  s_app -.-> games_json
  p_home -.-> games_json
  e_lobby -.-> games_json
```

### Server

The HTTP routes are listed in the diagram. Static files come from `public/`.
Dotfiles, path traversal, directory paths and `*.test.js` return 404. A bare
`/<slug>` gets a 301 to `/<slug>/` (the query string is kept) so the game's
relative imports resolve.

**Security headers.** Every response carries the same set (`SECURITY_HEADERS`
in `server/app.js`): pages, files, `304`, the `301` redirect, `400`, `404`,
`405`, `426`, `/healthz` (which also keeps `Access-Control-Allow-Origin: *`)
and the `403` that refuses a `/ws` handshake.

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'` | Scripts, fetches and sockets stay on the site itself. `connect-src 'self'` covers our own `ws:`/`wss:` in current browsers (CSP Level 3: Chrome 71, Firefox since 2018, Safari 16), so injected code can't open a socket to another host. WebRTC's STUN servers are not under `connect-src`. |
| `Strict-Transport-Security` | `max-age=31536000` | Once a browser has seen the site over HTTPS, it never uses plain HTTP for it for a year. No `includeSubDomains` and no `preload`, so it can be dropped later. Browsers ignore it over plain HTTP, so `localhost` and LAN play are unaffected. |
| `Cross-Origin-Opener-Policy` | `same-origin` | A page on another site that opens ours gets no handle to our window. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | No game needs them. The invite link's Share (`navigator.share`) and Copy (`navigator.clipboard`) stay allowed. |
| `X-Content-Type-Options` | `nosniff` | Files are only run as the type we send. |
| `Referrer-Policy` | `same-origin` | Invite links with their keys never leak to other sites. |

Only `engine/deck-worker.js` gets `'wasm-unsafe-eval'` in its `script-src`:
the card deck's WebAssembly compiles in that worker (see **Card games**), and
a worker runs under its own script's policy. Pages can't compile any code.
`.wasm` files are served as `application/wasm`.

`test/browser/security-headers.test.js` checks that, under these headers, the
lobby still reaches `/ws` and the invite link still copies and shares.

**Caching.** Static files carry `Cache-Control: no-cache` and a strong `ETag`,
a 64-bit FNV-1a hash of the file's bytes (`etagOf` in `server/app.js`, pure JS,
so no `node:crypto` or `fs.stat`). Browsers keep their copy but ask every time;
a matching `If-None-Match` (GET or HEAD) gets `304` with no body. The hash is
taken on each request, so a deploy or a local edit shows up on the next load.
`/healthz`, `/ws` and the 404 page carry no `ETag`.

**Who may open `/ws`.** Browsers always send an `Origin` header on a
WebSocket handshake, and a page can't change it, so the upgrade handler
(`wsOriginAllowed` in `server/app.js`) checks it. Without the check any
website could use its visitors' browsers to open rooms here, and once
accounts exist their cookies would ride along. The handshake is accepted when
any one of these holds:

1. There is no `Origin` header. That is a non-browser client (the Node tests
   connect this way), which could send any `Origin` it liked anyway.
2. The origin is one of our sites: `https://www.dailydoseofplay.com`,
   `https://dailydoseofplay.com` or `https://dailydoseofplay.wasmer.app`.
3. The origin's host and port equal the request's `Host` header, or the first
   value of `X-Forwarded-Host`. This covers `localhost`, `127.0.0.1`, a LAN
   address such as `http://192.168.1.20:8080` (the README promises two devices
   on one Wi-Fi can play), and the live site if a proxy rewrites `Host`.
4. The origin is listed in the `ALLOWED_ORIGINS` environment variable
   (comma-separated full origins, e.g. `https://preview.example,http://10.0.0.7:3000`),
   read once when the server starts.

Anything else, including `Origin: null`, gets `403 Forbidden` before the
handshake and the socket is closed. Origins are parsed with `new URL()` and
compared as whole hosts, so `dailydoseofplay.com.evil.example` is refused.
A fixed list alone would break LAN play, hence rule 3. Nothing about refused
connections is logged.

The server sticks to the APIs the reference proved on EdgeJS, which is not
upstream Node: `node:http`, the `upgrade` event, `fs.readFile` and `ws` (and so `node:crypto`, which `ws` loads itself).

**Signaling protocol** (JSON over `/ws`, game-agnostic):

| Client → server | Server → client |
|---|---|
| (on connect) | `hello {id}` |
| `create {game, name}` | `created {game, room, key, id}`. `key` is the room's invite key. |
| `join {game, room, name, key}` with the right key | `joined {game, room, id, host, peers}`, and `peer {id, name}` to the others |
| `join {game, room, name}` without a key | `knocking {game, room}`, and `knock {id, name}` to the host. Then `joined` once admitted, or `error` `declined`, `no_answer` (60 s) or `host_left`, and the socket closes. |
| `admit {id}` / `decline {id}` (host only) | Admit: as a keyed `join` for that knock. Decline: see above. |
| | `knock-gone {id}` to the host: the knock was withdrawn or timed out |
| `signal {to, data}` | `signal {from, data}` to `to`. `data` is opaque SDP or ICE. |
| `leave` | `left`. Then `leave {id}` to the others, or `host-left` and the room closes. |
| `ping` (every 25 s) | `pong` |
| | `error {code}`: `bad_json`, `bad_game`, `no_such_room`, `room_full`, `room_busy`, `rate_limited`, `declined`, `no_answer`, `host_left`, `not_host`, `not_in_room`, `already_in_room`, `no_such_peer`, `unknown_type`, `server_full`, `too_many_connections`, `too_many_rooms`, `too_fast`, `too_big`, `room_expired` |

- Rooms are keyed `slug/CODE`. A Sea Battle code can't join a Tic Tac Toe room.
- Codes are 4 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
  A code is only a room's name, not a password (see **Who may join a room**).
- Room size comes from the registry (`maxPlayers`, 2 to 8).
- Names follow the nickname rules (see **Nicknames**). Messages are capped at 64 KB,
  and `signal` data at 16 KB (see **Limits per client**).
- A socket that has not pinged for 75 s is dropped.
- When the server closes a socket on purpose, it first sends `error {code}`
  and uses the same code as the close reason, so a page that is already in a
  room (and has no request waiting) can still tell the player why.

**Who may join a room.** There are only 31^4 = 923,521 codes, and without a
limit one socket could ask about every code in seconds. A stranger who hit a
waiting room would get a seat, the players' nicknames and, through WebRTC, the
host's IP address, and children use the site. So:

1. **Invite key.** `create` returns a random 128-bit key (base64url, from
   `node:crypto`, which `ws` already loads on EdgeJS). The invite link is
   `/<slug>/?room=CODE&key=KEY`, and a `join` with that key is seated at once.
   A wrong key is answered `no_such_room`, the same as a missing room (which is
   also true when an old link meets a new room that reuses its code).
2. **Host approval without the key.** A typed code (or a link without `key`)
   knocks: the server tells the host (`knock`) and the joiner waits. The
   host's waiting room shows "<name> wants to join · Accept · Decline" (in the
   player list), and the tab title says so too. Only `admit` sends `peer`, so
   only then does the host start a WebRTC connection; a knocker can't `signal`
   anyone. A decline, or no answer within 60 s, closes the joiner's socket with
   `declined` or `no_answer`. At most 4 knocks wait per room (`room_busy`).
3. **Rate limit.** A `no_such_room` answer, a wrong key and a declined knock
   each count as a failed join, per connection and per client address. With
   5 in the last minute, the next `join` without the right key gets
   `rate_limited` and the socket closes, whether or not the code exists, so the
   answer gives nothing away. The right key is never a guess, so it is never
   refused. The client address is the first value of `X-Forwarded-For`, else
   the socket's address; `CLIENT_IP_HEADER` names another header. If neither
   gives an address, only the per-connection limit applies, because one shared
   bucket would lock everyone out. Addresses are kept in memory for the
   minute and never logged.

Together a guess now costs a minute per 5 tries per address, and a hit only
lets a stranger knock on a door the host can keep shut.

**Limits per client.** Without them one machine could open thousands of
sockets, fill the 10,000-room table so everyone else gets `server_full`, or
push 64 KB messages through the relay as fast as it can send them. The
mechanisms live in `server/limits.js` (`clientIp`, `createQuota`,
`createTokenBucket`) and are keyed by any string, so accounts can reuse them;
the numbers are `DEFAULT_LIMITS` in `server/signaling.js`.

| Limit | Value | Over it |
|---|---|---|
| Open `/ws` connections per client address | 20 | `too_many_connections`, then close (1008) before `hello` |
| Open rooms per client address (the host's) | 5 | `too_many_rooms` on `create`; the socket stays open |
| Messages per connection (token bucket) | 20 a second, bursts of 60 | `too_fast`, then close (1008) |
| `signal` data (its JSON) | 16 KB | `too_big`; nothing is relayed, the socket stays open |
| Room age | 30 minutes | everyone in it and everyone knocking gets `room_expired`, then close (1000) |
| Rooms on the server | 10,000 | `server_full` (last resort) |

- The client address is the same as for the join rate limit above
  (`X-Forwarded-For` or `CLIENT_IP_HEADER`, else the socket). With no address,
  the per-address limits don't apply.
- Every open room is a waiting room: the host closes its signaling socket when
  the game starts, which frees the room. So "5 rooms" means 5 rooms still
  waiting for players, and the 30 minutes run from `create`. The check runs
  with the idle sweep, every 30 s.
- A family on one Wi-Fi playing a 4-player game uses 4 connections and 1 room.
  Pings (one every 25 s) and a WebRTC handshake (an SDP and a few dozen ICE
  candidates per peer) stay far below the message rate.
- The lobby shows its own text for each code (`ERRORS` in
  `public/engine/lobby.js`). `RoomClient.connect()` rejects with the code the
  server sent before `hello`, and its `close` event carries the close reason.
- Counts live in memory and are dropped when they reach zero. Addresses are
  never logged.

**Nicknames.** A nickname is shown to everyone in the room, and children use
the site, so one set of rules in `public/engine/names.js` decides which names
are used. The lobby, the session handshake and the server all call it; the
server imports it straight from `public/engine/`, so the two can't drift apart.

- Up to 20 characters (code points), trimmed, control characters removed.
- Letters of any script (with their combining marks), digits, spaces and
  `. _ - '` only. Curly apostrophes become `'`; the zero-width joiners that
  Persian and some Indic names need are allowed.
- No links (`://`, `www.`, `name.com` and other common endings, `dot com`)
  and no `@handles`.
- No word from a short blocklist of offensive English words, compared without
  case or accents and through the swaps 0/o, 1/i/l, 3/e, 4/a, 5/s, $/s and
  Cyrillic or Greek letters that look Latin. Most words count anywhere in the
  name with separators removed (`f.u.c.k`); a few count only at the start of a
  word (`shit`, so Matsushita is fine) or as a whole word (`ass`, `nazi`,
  `cock`, so Assam, Nazir and Peacock are fine). Letters spelled out one by
  one (`a s s`) count as a word. CamelCase splits words (`BigAss`).

A name that breaks a rule is not used: the server shows `Player` instead, the
session handshake `Friend`, and the lobby plays under its default (`Host`,
`Guest` or `You`) and says why in one line under the nickname field. The
lobby never stores such a name. Because the host checks each guest's `$hello`
and guests check the host's `$roster` and `$start`, a modified page can't push
a blocked name over WebRTC either. Nicknames are never logged.

### Engine (`public/engine/`)

| Module | Job |
|---|---|
| `shell.js` | Header with the home link in a `nav` landmark, a "Skip to content" link to the page's `<main>` (shown on focus), and light/dark and sound toggles (each keeps one label, "Dark mode" or "Mute sounds", and gives its state through `aria-pressed`), the footer every page ends with (how games run, then links to this file, the repository and the privacy page; more links join `FOOTER_LINKS`), nickname in `localStorage`, toasts (just below the header; a repeated one is announced again), a tab-title alert ("Your turn"), `el()` DOM helper, and `askBeforeLeaving()`, the hook for an "Ask before leaving" setting (always yes today) |
| `names.js` | `checkName()` and `cleanName()`: the nickname rules (see **Nicknames**), shared with the server |
| `theme.css` | Design tokens for light and dark, fonts and motion (see **Type and motion**), chips and `.mono`, buttons, cards, lobby, the home hero with its steps and its game-table scene, the home grid (tiles whose name links to the lobby, with Play friends and Play the robot links), the moves the tiles' previews use (see **Tile previews**) and its loading tiles (see **Colours and contrast**), the game page column (see **Page column**), the player bar, the result panel, the result moment, the confirm dialog and `.text-page` (the privacy page's reading column) |
| `signaling.js` | `RoomClient`: create, join (with or without the invite key), admit, decline, signal, leave. It uses the global `WebSocket`, so it also runs in Node 22 for the integration test. |
| `peer.js` | `PeerChannel`: one ordered, reliable DataChannel to one other browser, pre-negotiated (`negotiated: true, id: 0`) on both sides; buffers early ICE candidates; detects ICE failure, a 20 s timeout and a 10 s disconnect grace. Refuses a message over `MAX_MESSAGE_LENGTH` before parsing it and closes with `message_too_big` (see **Message size**). |
| `channel.js` | `Emitter` and `localPair()`, an in-memory two-ended channel with the same interface as `PeerChannel` (used for robots and tests). `MAX_MESSAGE_LENGTH` (64 K characters of JSON) and `MESSAGE_TOO_BIG`: the local pair refuses an oversized message the same way, so robot games and tests behave like WebRTC. |
| `group.js` | The group transport every layer above talks to: `send(msg)` to all other seats, `message (msg, from)`, `leave (seat)`, `close`. `HubGroup` and `SpokeGroup` are today's star over links; `localGroup(n)` connects n seats in memory. The hub measures each frame it would forward and cuts off a guest whose frame is over the cap; `leave` and `close` carry `message_too_big` when that was the reason. |
| `room.js` | How players get seated in a group: `HostRoom` (create, `accept()` / `decline()` knocks, admit guests over WebRTC, `start()`), `GuestRoom` (join, wait for the start) and `localRoom()` (robots). The only engine file that knows about signaling and WebRTC. |
| `session.js` | `Session`: the seated players (`players`, `index`, `me`, `others`, `opponent`), buffering of game messages, rematch votes (`$rematch`, every seat must vote), goodbye (`$bye`). The handshake (`$hello` with a protocol version, `$welcome`, `$roster`, `$start`) that turns links into a group. No DOM. |
| `session.js` → `matchRouter()` | Routes game messages to the current match by match number `m`, with the sender's seat, and holds messages for a rematch that hasn't started yet |
| `robot-pace.js` | `robotPause(ms)`: every robot's pause before it moves goes through it, so browser tests can speed robots up by setting `globalThis.ddpRobotPace` (1 for players) |
| `turn-match.js` | `TurnMatch` and `startTurnRobot()`: a generic protocol for open-information turn games, for two or more players. Agreed coin toss for who starts, every peer validates every move with the same rules (only the seat on turn may move), and luck moves (dice) use `SharedRandom`. A rules object may set `draws`, the most shared draws one match needs (default 256). This is the default for future games. Card games use `card-match.js`; Sea Battle hides a fleet, not cards, so it has its own `match.js`. |
| `card-match.js` | `CardMatch` and `startCardRobot()`: turn games with hidden cards and no dealer (mental poker, see **Card games**). Like `TurnMatch`, plus a deck the rules deal from (`deck.deal`, `deck.open`, `deck.shuffle`, `deck.face`), every shuffle and share checked as it arrives, and an audit when the match ends. |
| `deck-service.js` | `deckService()`: the deck cryptography as async calls, in one Web Worker per tab (`deck-worker.js`) or in-process in Node. Replaces the worker if the WebAssembly crashes. Also `DeckError` and the byte sizes. |
| `deck-worker.js` | The worker: runs `deck-crypto.js` off the main thread |
| `deck-crypto.js` | A synchronous layer over the vendored mental-poker WebAssembly (`vendor/mental-poker/`): keys, shuffles and their proofs, shares, opening, the audit. Bytes in, bytes out. |
| `base64.js` | Bytes to base64 and back, strict about its input, for binary data in JSON messages |
| `vendor/mental-poker/` | The built library, committed (see **Card games**): `cards_play_bg.wasm`, its loader `cards_play.js`, `LICENSE`, and `SOURCE` (the commit it was built from) |
| `lobby.js` | `startGameShell()`: the game's `description` from `games.json` under its name (the lobby shows at once and the text fills in when the file arrives), the "Play with a friend" / "Play vs robot" / join-by-code UI with a quiet line under the Play buttons that games connect browsers directly, invite link with copy and share, the waiting room (a player list and a Start button when a game allows more than two; Accept / Decline for anyone knocking), `?room=CODE&key=KEY` auto-join, `?robot=1` (a robot game) and `?friend=1` (a new room at once, as if "Play with a friend" was pressed; dropped from the address bar so a reload doesn't make another), connection-failure and player-left screens. It hands the game a `shell` with `leave()` and `setInProgress(on)` (see **Leaving**). With a game's `settings` it shows them inside the home screen's card, between the nickname and the Play buttons, and their summary on the host's waiting screen, so friends see the rules before the game starts. Each new screen moves focus to its heading (not on page load); progress such as "Creating a room…" or "Bo joined" is read out from one `role="status"` line, and the connection-problem screen uses `role="alert"`. The code field takes only the server's code letters (uppercased, spaces and dashes dropped, anything else refused with a hint) and joins by itself at four; a join that fails returns to it with the code still in, the error under the field and read out from the status line. It also sets which view is on show for the page column. |
| `fair.js` | `commit` and `verifyCommit` (SHA-256 commitments), `HashChain` and `SharedRandom` (random draws all peers agree on). SHA-256 uses WebCrypto where the page has it, else a plain-JS copy (see below). |
| `players.js` | `playerBar(session, { onLeave, classes })`: the bar above every game (see **Player bar**). |
| `result.js` | `resultPanel(session, { onLeave, onShow, classes })`: the game-over panel of every game, with Rematch and Leave (see **Result panel**). |
| `celebrate.js` | `celebrate({ outcome, flavour, highlight, anchor, board })`: the result moment a game plays from the panel's `onShow`, and `calm()`, which the panel calls when it hides (see **Result moment**). |
| `chimes.js` | The result chimes: the site's jingle for each outcome in each game's timbre, through `sound.js` (see **Result moment**). No DOM. |
| `confirm.js` | `confirmDialog({ title, text, yes, no })`: a yes-or-no question in a modal `<dialog>` styled like the site. Focus moves to Cancel, Esc or Cancel says no, and focus returns to where it was (Leave). Resolves to `true` for yes. |
| `settings.js` | `gameSettings()`: a game's settings (groups of segmented options such as clocks or board size), remembered per device under the game's key. The lobby shows them folded to a summary ("Game settings" over chips such as "No clocks", "Coin toss", "Easy robot", and Change) that opens to the options; a group marked `robot` is tagged "vs robot only", its chip has a teal dot, and it is left out of the waiting screen's summary. `get()` is the current config, which the game sends to its guests (`setup`). |
| `sound.js` | Every game's sounds play through it (see **Sound levels**): `defineSounds()` takes a game's list of sounds, each with a role, and returns `play(name, opts, at)`. One audio context and one output for the site, the per-device mute toggle in the header, and preloading of short CC0 recordings (Sea Battle, Chess, Backgammon, Ludo and Crazy Eights, see each game's `sounds/LICENSE.txt`) |
| `synth.js` | Building blocks for synthesized sounds: `tone()`, `noise()` (white or brown), `decay()` and a `pentatonic()` scale |
| `loudness.js` | `loudness(samples, sampleRate)`: how loud a sound is to the ear, in LUFS (K-weighted, loudest 100 ms). No DOM; runs in node too. |
| `rng.js` | Seeded PRNG (sfc32) and sampling helpers, so shared random draws give the same results on every peer |

**Session flow.** A friend joining by invite link; the steps below give the
details.

```mermaid
sequenceDiagram
  participant H as Host's browser
  participant S as Server (/ws)
  participant F as Friend's browser
  H->>S: create {game, name}
  S-->>H: created {room, key}
  H-->>F: invite link /#lt;slug#gt;/?room=CODE&key=KEY (sent by the host)
  F->>S: join {game, room, name, key}
  S-->>F: joined
  S-->>H: peer {id, name}
  H->>S: signal (offer)
  S->>F: signal (offer)
  F->>S: signal (answer)
  S->>H: signal (answer)
  Note over H,F: ICE candidates are relayed the same way
  H-)F: DataChannel opens, browser to browser
  F->>H: $hello
  H->>F: $welcome
  H->>F: $roster
  H->>F: $start {seat, players}
  H-xS: close the WebSocket
  F-xS: close the WebSocket
  Note over S: the room is deleted
  Note over H,F: game messages only, over the DataChannel
```

1. Host: `create` → waiting room (code and invite link with the key).
2. Each friend opens `/<slug>/?room=CODE&key=KEY` → `join`, and is seated at once. A friend who types the code knocks instead and waits until the host presses Accept (see **Who may join a room**). The lobby drops `room` and `key` from the address bar.
3. The host starts a WebRTC offer to each guest, the guest answers, and ICE goes through `signal`.
4. Each DataChannel opens. The guest sends `$hello`; the host checks the game and protocol version and answers `$welcome` (or `$reject`), then sends every connected guest the `$roster`.
5. The game starts when the room is full (`maxPlayers`), or when the host presses Start with at least `minPlayers`. The host sends each guest `$start {seat, players}`: seats follow join order, and guests still connecting are dropped. A two-player room is full as soon as its guest is in, so it starts at once, as before.
6. The lobby closes the signaling sockets. This frees the room (a late joiner gets "doesn't exist any more") and keeps instance load near zero.
   The host can get there first, so a guest whose channel is already open ignores `host-left`.
7. The engine calls `onSession(session, root)` and the game takes over.

Guests keep their signaling socket while they wait, so the server's room size
check (`room_full`) still counts them.

In robot mode the engine builds a `localRoom()`: one in-memory group with a
seat for the player and one per robot (`robots`, default 1, or a function the
lobby calls when a robot game starts), and hands each
robot's `Session` to the game's `createRobot()`. **A robot is just another
peer**, so robot games use exactly the same protocol and rules code as friend
games. The lobby acts on `?room=`, `?robot` and `?friend` only after the
game's module has finished loading, because a robot game's `onSession` runs at once and may
use bindings the module declares after its `startGameShell()` call.

Side by side, only the group transport differs (dashed boxes):

```mermaid
flowchart TB
  subgraph friend ["Friend game: one browser per player"]
    direction TB
    f_main["main.js + rules.js"] --> f_match["TurnMatch, or Sea Battle's match.js"]
    f_match --> f_session["Session"]
    f_session --> f_group["HubGroup on the host,<br>SpokeGroup on each guest"]
    f_group --> f_link["PeerChannel:<br>WebRTC DataChannel"]
    f_link <==> f_others["the other browsers"]
  end
  subgraph robot ["Robot game: every seat in one tab"]
    direction TB
    r_main["main.js + rules.js<br>your seat"] --> r_match["TurnMatch, or Sea Battle's match.js"]
    r_match --> r_session["Session"]
    r_bot["robot.js + rules.js<br>a robot's seat"] --> r_bot_match["TurnMatch, or Sea Battle's match.js"]
    r_bot_match --> r_bot_session["Session"]
    r_session --> r_group["localGroup(n):<br>localPair() links in memory"]
    r_bot_session --> r_group
  end
  classDef transport stroke-dasharray: 5 5
  class f_group,f_link,r_group transport
```

**Groups.** Everything above `room.js` sees a group: send to everyone, receive
`(msg, from)`, hear that a seat left. Today it is a star. The room creator's
browser (seat 0, the hub) holds one link to each guest (a spoke) and forwards
each message to every other seat, tagged with the sender, so every player sees
other players' messages in the hub's order. A player's own message is applied
when sent and is not echoed back. With two players the hub forwards nothing,
so this is the same single DataChannel as before, plus a small frame
(`{msg}` up, `{from, msg}` or `{left}` down).

Why a star: there is no TURN server, so every extra connection is another
chance that two networks can't reach each other. A star needs only each
guest's link to the host (n−1 links; a full mesh needs n(n−1)/2), and it gives
one order for free. Turn-based messages are a few hundred bytes, so the hub's
bandwidth doesn't matter, and its extra hop isn't felt in a turn game. What it
costs: the game ends if the host leaves, and a modified host could forge or
hold back another player's moves (dice can't be forged, since every reveal is
checked against its chain). For games between friends that is acceptable. To
change the transport later (a server relay as a fallback for blocked
networks, or a mesh), write another group and seat players with it in
`room.js`; sessions, matches and games don't change.

**Leaving.** Any player leaving, or losing their connection, ends the session
for everyone (`end` with the reason and the seat), because the match can't go
on without their moves and shared draws. The reason is `left` (`$bye`),
`closed` (connection lost), `message_too_big` (see below) or `self`.
Continuing without a player is a future, per-game choice.

So Leave asks first, the same way in every game. Each game calls
`shell.setInProgress(on)` from its render, on until the match is over or
stopped; while it is on in a friend game, `shell.leave()` opens
`confirmDialog()`: "Leave the game? Bo will be told you left." with two
players, "Leave the game? It ends for everyone." with more. Cancel keeps
playing. Robot games, finished matches and a game that never calls
`setInProgress` leave at once, and so does everyone once `askBeforeLeaving()`
in `shell.js` says no. The browser's Back (or a phone's back gesture) is
Leave too: a game gets a history entry of its own when it starts, so Back
returns to the lobby, asking first in the same cases; Back while the question
is open closes it, like Esc. Closing or reloading the tab in those cases gets the
browser's own "Leave site?" prompt (`beforeunload`), since a page can't show
its own dialog there.

**Message size.** `JSON.parse` blocks the tab, so a modified client could
freeze other players' tabs with huge messages. Every link therefore checks a
message's length before parsing it: over `MAX_MESSAGE_LENGTH` (64 K
characters, in `channel.js`) the message is dropped unread and the link
closes with `message_too_big`.

- `PeerChannel` checks `ev.data.length`; `localPair()` checks the same JSON
  text, so robot games and tests behave alike.
- The hub's `{from, msg}` is a few characters longer than the `{msg}` it
  received, so it measures the frame again before forwarding. An oversized one
  cuts off its sender, never the guests it was meant for.
- Before the start, the host drops that guest from the waiting room. During a
  game, the session ends for everyone with `message_too_big` and the seat: the
  hub tells the other guests why in its `{left, reason}` frame. The lobby
  shows "A player's browser sent something unexpected." The cut-off browser
  itself only sees the host go.

Real messages are tiny. `test/message-size.test.js` plays a full match of
every game with robots in every seat, at its biggest board and player count,
measures every frame, and fails if one is over 4 K characters (1/16 of the
cap). The largest today, in characters: Sea Battle 283 (`reveal`), Ludo 167
(`setup`), Connect 4 121 (`setup`), Dots and Boxes 117 (`setup`), Chutes and
Ladders 116 (`setup`), Backgammon 113, and Tic Tac Toe, Gomoku, Checkers and
Chess 112 (a shared-random `draw`); the engine's handshake peaks at 127
(`$start` with four 20-character names). A card game's shuffles and shares
grow with the deck, so `CardMatch` sends them in parts (see **Card games**);
its largest message, with four players and a 108-card deck, is 3063 (a part
of a `shuffle`); Crazy Eights' (four players, 52 cards) is about the same,
3063 to 3065 as reshuffles add digits to the round number.

**Why a pre-negotiated channel.** With the default in-band handshake, the
guest's channel opens when the host's open request arrives, and Chrome
sometimes drops a message the guest sends at that moment. The guest's `$hello`
was lost about once in 15 local connections, and the host then timed out.
Both peers now create the same channel (`id: 0`) before the offer, so neither
side's first message can arrive before the other side has the channel.

Engine messages start with `$`. Everything else belongs to the game. The
game receives messages through `session.onMessage((msg, fromSeat) => …)`,
which buffers until a handler is attached. The handshake's protocol version is
2; a page from before groups gets "a different version of this page".

**Colours and contrast.** The shared colours are tokens in `theme.css`, defined for
light and dark, and both themes meet WCAG 2.2 AA: 4.5:1 for text and 3:1 for
the edge of a control. Coral (`--accent`) and teal (`--accent-2`) are fills:
buttons, badges, pieces, selected options. Text in those colours uses
`--accent-text` and `--accent-2-text`, which are darker in light mode, and
text on a coral or teal fill uses `--accent-ink`. Text inputs and segmented
options are outlined in `--control-border`; `--border` is only for card edges
and dividers. `test/contrast.test.js` reads both token sets from `theme.css`
and checks each of these pairs, and that the OS dark block matches the
toggle's. Faded states use solid muted colours, not `opacity`, so their text
keeps its contrast (a "Coming soon" card on the home page, for example).
Disabled buttons are the exception: WCAG doesn't count inactive controls.

**Type and motion.** Headings and the logo use `--font-display` (Fredoka) and
small facts use `--font-mono` (Red Hat Mono, through `.mono`): the room code,
the invite link, timers and player counts. Body text stays on the system font
stack. Both fonts are self-hosted in `engine/fonts/` (latin subsets, woff2, 52 KB
together, SIL OFL in `fonts/LICENSE.txt`), because the CSP allows only our own
files; every page preloads the display font. `.chip` is a pill with a coloured
dot for a seat or a fact ("2–4 players" on the home tiles): the dot is
`--dot`, muted by default, `--mine` or `--theirs` with `.mine` or `.theirs`.
Transitions use `--dur-fast`, `--dur-med` or `--dur-slow` and `--ease-out` or
`--ease-spring`. The rules, at the top of the motion section in `theme.css`:
animate only transform and opacity; nothing loops forever except the home
hero's scene and a tile's preview while it is hovered, focused or, on a touch
screen, in view; everything stops under `prefers-reduced-motion`; no motion starts
without a user action, except the room code, whose letters settle in one by
one (350 ms) when the waiting room opens, the result moment when a match
ends (see **Result moment**), the hero's scene, and a tile's preview on a
touch screen. Loading indicators run only while something loads.

**Hero scene.** The home hero ends with a small game table, an inline SVG in
`index.html` (decorative, `aria-hidden`), drawn in theme tokens so it follows
light and dark. Each piece (cards, a checker, a die, a Ludo pawn, a Connect 4
disc) and the lamp's glow loops on its own period, so the scene never repeats
exactly; hovering or tapping a piece swaps its loop for one run of its move.
The loops animate only transform and opacity, which Chrome runs on the
compositor, so they cause no layout or paint. `home.js` adds `.paused` while
the scene is off screen (IntersectionObserver) or the tab is hidden, and with
`prefers-reduced-motion` the scene is still.

**Tile previews.** While a ready game's home tile is hovered or has keyboard
focus, or on a touch screen (`hover: none`) while it is at least 60% in view,
it loops a 3–5 second preview of the game: its pieces move and small player
tags light up in turn. Each loop holds its last frame for a moment; when the
tile loses hover, focus or view, its icon comes back. `home.js` fetches
`<slug>/preview.svg` the first time, inlines it in place of the icon (an
`<img>` couldn't reach the page's tokens or be started) and calls `play()` on
its animations, which start paused, again after each loop. Without the file,
or with `prefers-reduced-motion`, the icon stays. Because the SVG is inlined, its
`<style>` applies to the whole page: selectors start with the game's class
(`.pv-ttt`) and keyframes and ids with its name. `theme.css` gives every
preview the same timing (each piece waits `--d`), the seat colours (`.a` to
`.d`), the player tags and a few moves (`.pop`, `.fade`, `.gone`, `.draw`,
`.slide`, `.fall`, `.lit`). The CSP needs no change: the fetch is same-origin
and inline styles are already allowed; `test/server.test.js` checks each
preview has no script and no external references.

**Page column.** A game page stacks the lobby, the game
and "How to play" (`.rules`), and they all share one centred column, as wide
as the view on show, so their edges line up. `startGameShell()` sets
`data-view` (`lobby` or `game`) and `data-layout` on `<main class="page">`,
and `theme.css` turns them into `--column`, which caps `#game`, `.rules` and
the lobby cards:

| View | Column at 1280 px | Games |
|---|---|---|
| Lobby, invite, waiting room | 520 px | all |
| Game, `layout: "narrow"` | 520 px | Tic Tac Toe, Connect 4, Chess, Checkers |
| Game, `layout: "medium"` | 640 px | Gomoku, Backgammon |
| Game, `layout: "wide"` (the default) | 980 px | Sea Battle, Chutes and Ladders, Dots and Boxes, Ludo, Crazy Eights |

Below that width the column is the page's width less its 16 px gutters. A
game's own top-level box has no `max-width`, so it fills `#game`. The default
is the widest, so a game that passes no `layout` is never squeezed: its own
box keeps whatever width it sets, and its rules panel matches the column.
`test/browser/layout.test.js` checks every ready game at 1280 and 360 px.

**Player bar.** Every game shows the same bar above its board, built by
`playerBar()` in `players.js` and styled in `theme.css`: a pill per player
(you first, "(you)" after your name, then the others in seat order), a ring
on whoever's turn it is, and Leave (`id="leave"`, outlined, with an exit arrow) at the top right. Under it
the score (`#score`) shows wins per player and, for games whose score has a
`draws` field, a Draws box (Dots and Boxes adds it with the first draw,
since only some boards can be drawn). The game creates it once and calls
`update({ turn, score, badges, notes })` with whatever changed, each indexed
by seat: `turn` is a seat or -1, `score` is `{ wins, draws }`, a badge is a
node of the game's own (a mark, disc, stone or swatch, which the game may
keep changing), and a note is a short line under the name (pips, boxes, a
square), as text or a node. With three or four players the pills wrap, at
most two to a row; under 600 px they sit in a 2×2 grid beside Leave over a
slimmer score, so four fit a 360 px phone. A pill and its score read
`--seat` and `--seat-text`, which are `--mine` and `--theirs` unless the game
gives each seat a class of its own that sets them (Chutes and Ladders `p0`
to `p3`, Ludo its board colours).

**Result panel.** Every game shows its result the same way, in a panel
built by `resultPanel()` in `result.js` and pinned to the bottom of the
screen, in the page column. It is out of the page's flow, so the board never
moves when a match ends (Sea Battle's result used to push its boards down
about 160 px); while it is open, the page keeps room below the game so
everything can still be scrolled clear of it. It holds the title
(`#result`): "You won", "You lost" or "Draw", "<name> won" when more than
two play, or "Match stopped"; the places in order (`#result-places`, Ludo's
standings); a reason line (`#result-reason`); an optional node of the
game's (Sea Battle's fair-play verdict, `#verdict`); **Rematch**
(`#rematch`); the rematch status (`#rematch-status`); and Leave. The panel
listens to the session's rematch votes itself: Rematch becomes "Accept
rematch" once someone else has voted, the status says who wants one or
"Waiting for Bo…" ("Waiting for 2 players…" with more missing), and a toast
announces another player's vote. The game creates it once and calls
`show({ winner, stopped, reason, places, extra })` whenever something
changes (`winner` is a seat or -1 for a draw) and `hide()` while the match
is on. It opens once per match: focus moves to its title, and `onShow({
winner, stopped, outcome })` runs, the hook for the result moment (below).
Place colours read `--seat`, like the player bar, from `.mine`, `.theirs`
or the game's `classes`.

**Result moment.** When the panel opens, every game plays the same short,
gentle moment, about 1.5 s, from `celebrate()` in `celebrate.js`. The
panel's `onShow` passes `outcome`: `"win"`, `"loss"`, `"draw"`, `"over"`
(someone else won and more than two play: never a loss sting), or `null`
for a stopped match, which gets nothing. Each browser plays its own
player's moment.

| Outcome | What moves | Chime |
|---|---|---|
| win | the winning pieces (`highlight`) light up one after another, then three sets of the logo's four dots, coral and teal, rise from the title | three notes rising |
| loss | the `board` dims a little and the title fades in | two notes falling, 2 dB softer |
| draw | the player pills pulse once | one note twice, 2 dB softer |
| over | the winner's pieces light up and the title fades in | the win's first two notes, 4 dB softer |

The game passes the pieces in the order they light up: the line in Tic Tac
Toe, Connect 4 and Gomoku, the mated king in Chess, the last capture in
Checkers, the last checker borne off in Backgammon, the last ship sunk in
Sea Battle (once its shell lands), the pawn on 100 in Chutes and Ladders,
the last box in Dots and Boxes, and the winner's tokens home in Ludo. The
chimes (`chimes.js`) are one melody, a C-major pentatonic jingle, in a
timbre that fits the game's pieces (`flavour`): `wood` for Chess, Checkers,
Backgammon and Ludo; `paper` for Tic Tac Toe, Gomoku and Dots and Boxes;
`plastic` for Connect 4; `bell` for Chutes and Ladders; `water` (a bubble
under the bell) for Sea Battle. They are synthesized, at the `fanfare`
level, and follow the mute toggle. With `prefers-reduced-motion` only the
colours change: the pieces glow, the board dims, the pills take their seat
colour, and nothing moves. The colours stay while the panel is up; it calls
`calm()` when it hides, for a rematch.

**Player colours.** A player has the same colour on every screen, so "I'm the
coral one" is true for everyone at the table. In a two-player game whoever
moves first this match is coral and the other teal (in Chess, White is coral),
which matches the pieces in Connect 4, Checkers, Gomoku and Tic Tac Toe. Games
with up to four players colour by seat: Ludo by its board, Chutes and Ladders
coral, teal, violet and amber for seats 0 to 3. Your side is still marked
`.mine` and the other `.theirs`, but those styles use `--mine` and `--theirs`
rather than `--accent` and `--accent-2`; the game sets `data-you` on its root
(`"a"` coral, `"b"` teal, `""` until the coin toss) and `theme.css` maps the
two. Telling you apart is the job of words ("You", "(you)") and layout, not
colour.

**Sound levels.** Each game used to set its own levels on its own output
(three different compressors and master gains), matching sounds by their
peaks. Peaks say little about how loud something sounds: a dice recording
peaks near full scale but is mostly quiet, while a synthesized note is dense.
So a move in Ludo came out 13 to 18 dB louder than its die (issue #28), Sea
Battle's shell whoosh 24 dB under the hit that followed, and a Checkers move
19 dB under a Ludo hop. Now every sound has a role, and every role one
loudness for the whole site, measured as the ear hears it (`loudness.js`:
K-weighted as in ITU-R BS.1770, the loudest 100 ms, about how long the ear
sums sound):

| Role | LUFS | For |
|---|---|---|
| `cue` | -34 | a background signal: a timer tick, a shell in the air |
| `ui` | -29 | your turn, another roll, a move that can't be made |
| `action` | -24 | the routine move: a die, a piece set down, a hop, a line |
| `highlight` | -21 | something happened: a capture, a box, a hit, a ladder |
| `fanfare` | -19 | the big moments: a win, a loss, a sunk ship, a nuke |

A recording is measured once it loads and played at its role, so recordings
of uneven loudness need no tuning. A synthesized sound carries a `trim` in dB
that brings it there. A sound may set itself apart from its role by up to
6 dB with `offset`, for a softer layer under another sound or a quieter take
(a backgammon checker going back to the bar), and a single `play()` may pass
`{ offset }` for a bigger or smaller version of the same sound. The roles sit
low enough that the spikiest recording (the dice) still fits under full
scale.

The site's output is a soft clipper: below -1 dBFS it leaves sound untouched,
and above it rounds off peaks when sounds stack. A `DynamicsCompressorNode`
can't do this job, because Chromium's turns a sound down by 1 to 2 dB even when
it never reaches the threshold, which would undo the levels.

`test/browser/sound-levels.test.js` renders every sound of every game, and
the result chimes, offline through that output (each recording, and each
synthesized stand-in), with random parts seeded, and fails if one lands more
than 1.5 dB from its role, printing the trim to set. `test/sound.test.js`
checks that no game opens its own audio context or output.

### Game (`public/<slug>/`)

| File | Job |
|---|---|
| `index.html` | Page with `#lobby` and `#game` sections and the rules |
| `main.js` | `startGameShell({ slug, title, layout, settings, createRobot, onSession, minPlayers, maxPlayers, robots })` and the view. The player counts default to 2 and `maxPlayers` must match `games.json`; the lobby's tagline is the game's `description` there (a `tagline` option still overrides it); `layout` picks the page column (see **Page column**). |
| `settings.js` | Optional: the game's settings, `export const settings = gameSettings({ key, prefix, groups, normalize, hint })`, passed to `startGameShell()` and read with `settings.get()` |
| `rules.js` | Pure rules: no DOM, timers, network or `Math.random`. Randomness is passed in. |
| `match.js` | Only for games with hidden information that isn't a deck of cards (Sea Battle's fleet): one player's protocol state machine. Card games use `engine/card-match.js`, the others `engine/turn-match.js`. |
| `sounds.js` | Optional: the game's sounds, `export const sounds = defineSounds({...})` with a role for each (see **Sound levels**), and the `play` helpers `main.js` calls. The only file that imports `engine/sound.js`. |
| `robot.js` | Move choice (`chooseMove`). TurnMatch games hand it to the engine's `startTurnRobot()`, card games to `startCardRobot()`; custom-protocol games (Sea Battle) also export `startRobot(session)`. |
| `*.test.js` | `node --test` unit tests, next to the code |
| `icon.svg` | Card art for the home page (16:10) |
| `preview.svg` | Optional: the tile's short animated preview (see **Tile previews**) |

## Card games (`CardMatch`)

A card game hides each hand from every other player, including the browser
that started the room, and has no dealer. `engine/card-match.js` does it with
mental poker: every player holds a share of the deck's key, and a card can
only be read with every share. With three or more players, a modified host
can still read a hand (see **A modified host** below). The rules contract is
at the top of that file; Crazy Eights is the first game to use it (see
**Crazy Eights in depth**).

**How a match runs.** Every message carries `m`, as in `TurnMatch`.

1. **Keys.** Each browser makes a key and sends `hello {tip, key}`: its
   `SharedRandom` chain tip, and its public key with a proof that it holds
   the secret. The proof covers the match number, the seat and the tip, so a
   key can't be reused by another seat or in another match. Everyone checks
   every proof and adds the keys into one joint key. One shared draw picks
   who starts.
2. **The shuffle.** The deck starts as the cards 0 to `deckSize` − 1 in
   order. Seat 0 re-encrypts every card under the joint key, permutes them,
   and sends the result with a proof that it is still the same cards
   (`shuffle`). Every other seat checks the proof before taking it as the
   deck; then seat 1 shuffles, and so on. Nobody knows the final order.
3. **Dealing and opening.** The rules call `deck.deal(slot, seat)` or
   `deck.open(slot)`. For a deal, every other seat sends its share of that
   card with a proof (`shares`); the receiver adds its own, which it never
   sends, and reads the card. For an open, everyone sends theirs. Shares go to
   everyone, so the holder of a dealt card can later show it to all by sending
   just its own share: a move that plays a card (`rules.reveals()`) carries
   it (`move {move, sh}`). Every seat sends its part of every round, empty if
   it has no shares to give, so no seat runs more than a round ahead.
4. **Reshuffles.** `deck.shuffle(slots)` sends those cards, say a discard
   pile, through another round of shuffles by every seat, into new slots.
   Faces that were open are hidden again.
5. **The audit.** When `state.winner` is set, everyone sends their secret key
   (`audit {key}`). Each browser checks every key against the one that player
   used, reads every card it couldn't see, and replays the game from the deal
   with every face known. The result is `match.verdict`: `{ ok: true }`, or
   what went wrong and, when it was a move, whose. Once the audit has
   passed, `match.face()` returns every card, so a game can show the hands
   left at the end (Crazy Eights counts their penalty points). During play
   it returns only the open cards and your own, as before, and after a
   failed audit nothing more.

| Cheat | Caught |
|---|---|
| Looking at another hand | Prevented: a card can only be read with every player's share. |
| A shuffle that swaps, copies or drops a card, or one passed off as another seat's | At once: the proof fails, and the match stops naming the shuffler. |
| A wrong share, or a share for another card | At once: its proof fails. |
| Showing a card that isn't in your hand, or moving out of turn | At once, like any illegal move. |
| Breaking a rule that depends on a hidden card ("draw only if nothing plays") | In the audit, where `deck.face()` returns every face, so the rule throws. The result stands; the audit only reports. |
| Revealing a different key at the end | In the audit. |

The audit needs every player's key. A player who leaves after the last move,
or never sends their key, leaves the match unverified (`verdict` stays null):
the view should say so. Nothing stops stalling either: a player who never
sends their shares holds the game up until someone leaves. A seat that sends
more than `MAX_AHEAD` shuffle or share parts ahead of the match is flooding,
and is blamed for it. A hidden card can't pass from one player to another (Go
Fish, Hearts' pass): that needs a private message, and every message here
goes to everyone. A card that is already open can.

**A modified host, with three or more players.** Every message goes through
the host's browser (see **Groups**), and messages aren't signed. A modified
host can therefore hold back one player's messages and forge a game-ending
move in their name. Your browser then sends your key for the audit while the
real game goes on, and the host can read your hand and play your seat.
Signing moves wouldn't close this, because the host also relays the keys a
signature would be checked against, and could swap in its own. It would
take direct links between every pair of players (a mesh, see **Groups**).
With two players the host is your only opponent, so this gives them nothing
the game doesn't already.

**Writing rules.** The rules see slots, never ciphertexts, and `deck.face()`
only returns faces every player can see, so the state is the same in every
browser. The one thing to get right: the state must never depend on a face
that may be hidden. The audit replays with every face known, and any
difference fails it ("the game plays out differently with every card known").
A check that needs a hidden card throws only when the face is known, which is
in the audit. A card opened in a call has no face until the others' shares
arrive, so reading it in the same call is an error; read it from the next call
on, such as `settle()`. `test/fixtures/toy-cards.js` is a small example of all
of this.

**The library.** The cryptography is `paritytech/mental-poker`: ElGamal on
secp256k1 (Barnett–Smart's protocol), Bayer–Groth shuffle proofs and
Chaum–Pedersen reveal proofs, in Rust compiled to WebAssembly. Before we
adopted it, we checked that every proof hashes all of its inputs into its
challenges (Fiat–Shamir), regenerated its commitment generators from their
public seed to confirm the committed ones, and tried swapping, copying and
replaying shuffles and shares; all were rejected. It has no professional
audit. `deck-crypto.js` adds what the library leaves to its caller: a share
is tied to the seat that sent it (the library accepts a valid share from any
key), the same key can't join twice, and a WebAssembly crash (a malformed
proof can trap the module) becomes an error that blames whoever sent the input.

**Vendoring.** The site has no build step, so the WebAssembly is committed:

- `vendor/mental-poker/`: a git submodule, pinned to the commit we reviewed. It is outside `public/`, so it is never served.
- `vendor/patches/mental-poker/*.patch`: our changes to it. Today that is one line that makes upstream's WebAssembly build work.
- `vendor/mental-poker.Cargo.lock`: upstream has no lock file; this one pins every Rust dependency.
- `scripts/build-mental-poker.sh`: builds the pinned commit with the patches and the lock file, using pinned Rust, `wasm-pack` and `wasm-opt`, into `public/engine/vendor/mental-poker/` (a 370 KB `.wasm`, 160 KB gzipped, plus its loader, `LICENSE` and `SOURCE`). `--check` builds into a temporary folder and fails if anything differs from the committed files. CI's `mental-poker` job runs it, with tools from `scripts/install-wasm-tools.sh`, which checks their hashes. `wasm-pack` fetches the `wasm-bindgen` matching the lock file without a hash check, which the byte comparison covers. Builds on Arch Linux (system `wasm-opt`) and in a Debian container (binaryen's release) gave the same bytes.
- Upstream declares `MIT OR Apache-2.0` but ships no license files. We use it under MIT; the text is in `vendor/mental-poker.LICENSE` and is copied next to the build.

To update: move the submodule, refresh the patches and the lock file, run the
script and review what changed. Wasmer's builder runs `npm run build` when
`package.json` has one, and it has no Rust, so the script must never be wired
up as `build`. A checkout without submodules still deploys, because the site
only uses the committed files.

**The worker.** Proving a 52-card shuffle takes about 0.25 s and checking
one about 0.08 s (desktop Chrome). In a robot game every seat lives in your
tab, so four seats spend about 2 s on the first shuffle. `deck-service.js`
runs this in one Web Worker per tab (`deck-worker.js`), so the page never
freezes: `test/browser/card-engine.test.js` fails if any task blocks the
page for 200 ms. In Node it runs in-process. If the WebAssembly crashes, the
job that crashed it fails (and its input is blamed), and the jobs queued
behind it run again on a fresh worker. A stopped match drops whatever its
running deck job returns.

**Sizes.** A card is 66 bytes, a share 131. A shuffle message is 66 bytes a
card plus its proof (7.7 KB for 52 cards, 13 KB for 108), so `CardMatch` sends
it in parts of 3000 base64 characters (`shuffle {k, i, n, d}`), and shares 16
to a message (`shares {k, i, n, d}`), and a move may show at most 16 hidden
cards. Every message stays under 4 K characters (see **Message size**). In the
browser test, four robots with 52 cards and seven-card hands have the deck
shuffled in about 2.6 s, and finish 30 turns and the audit in about 4 s.

## Sea Battle in depth

### Rules

- **Board and fleet:** 10×10, fleet of 5, 4, 3, 3 and 2.
- **Placement:** ships are placed at random; you can shuffle, drag them, press R while dragging to rotate, or tap a ship to rotate it. Ships may not touch side by side; diagonal contact is allowed.
- **Turns:** a hit lets you fire again; a miss, or a hit that sinks a ship, passes the turn.
- **Sinking:** a sunk ship is revealed, and the squares beside it are marked as clear water.
- **Gifts:** after every 6 moves (one fire action is one move), a mystery gift ("?") appears on an unexplored square of each board, at most 2 waiting per board. Only a shot aimed at a gift's own square picks it up (the aimed square of a big missile, nuclear missile or carpet bomb counts); the weapon inside is shown only then. A gift hit by a splash or missile rain aimed elsewhere is destroyed with its square, since nobody can aim at it any more. Each player sees only the gifts on the board they fire at, never the opponent's gifts or pickups. A gift whose square becomes cleared water after a sinking disappears too.
- **Time limits (room settings):** like papergames, games are timed. Under **Game settings** the player picks a time per shot (10, 20, 30 or 40 s, or none) and a time for each player (3, 5 or 10 min, or none); the default is 30 s a shot and 10 min each. When the time for a shot runs out, that player's browser fires a random shot; when a player's own clock runs out, they lose. In a friend game the room creator's settings apply (the host sends `setup {config}` before the first match, as in Tic Tac Toe). Against the robot only the human's clock runs: the robot reports no time spent. Fleet placement isn't timed.

**Weapons:**

| Weapon | Effect |
|---|---|
| Shot | 1 square, unlimited |
| Big missile | 5-square plus shape |
| Missile rain | 7 random unexplored squares; not aimed, so it fires from a Launch rain button rather than a tap on the board |
| Nuclear missile | 14 squares: a 4×4 block with two opposite corners spared |
| Carpet bomb | The whole row or column through the aimed square (`dir` is `row` or `col`) |

Gift odds are 3 : 2 : 1 : 1 for big missile, missile rain, nuclear missile and
carpet bomb.

Splash squares that were already explored are skipped.

### Why not a host-authoritative design

The reference keeps all state on the host, which simulates and streams
snapshots. That fits a real-time action game. It is wrong for Battleship: the
host would have to know both fleets, so the host could see the guest's ships.

Sea Battle is instead **symmetric**. Each browser keeps its own fleet and runs
the same `match.js` state machine. The public state (shots, hits, sunk ships,
gifts, inventories, whose turn it is) is updated by identical code on both
sides, from the same messages in the same order.

### Fair play without a referee

| Threat | Defence |
|---|---|
| Seeing the other fleet | Fleets never go on the wire until game over. Each side answers only the shots fired at it (`result {hits, sunk}`). A test checks that no fleet data crosses the wire before the reveal. |
| Lying about hits, or moving ships mid-game | When pressing Ready, each side sends `commit = sha256(salt:canonical(fleet))`. At game over both send `reveal {fleet, salt}`. Each side checks the commitment and then audits every answer against the revealed fleet: every hit, miss, cleared square, and every sunk ship announced or not announced. The result screen shows "Fair play verified" or what didn't add up. |
| Impossible answers (wrong length, a sunk ship on unhit squares, double fire) | `applyFire()` rejects them right away and the match is aborted with a reason. |
| Biased randomness (who starts, gift squares and types, missile rain) | `SharedRandom` (below). Neither side can pick or predict an outcome. |

**How `SharedRandom` works.**

1. Each peer picks a secret `x0` and builds a hash chain `x1 = H(x0)` up to `x256`.
2. When pressing Ready, it publishes only the tip `x256`.
3. Draw *k* reveals `x(256−k)` from both peers. Each peer checks that hashing the revealed value gives the previous one.
4. The draw's seed is `H("ddp-draw", k, hostValue, guestValue)`, which seeds sfc32.

Every value was fixed when the tip was published, so the second peer to
reveal can't change its value after seeing the first. Nobody can compute a
future value from the published ones. Each draw costs one message per peer,
with no extra commit round.

**Hashing on plain http.** Browsers only give `crypto.subtle` to secure
origins: https, `localhost` and `127.0.0.1`. A page opened at
`http://0.0.0.0:8080` (the address `npm start` prints) or at a LAN IP has
none. Without it, the coin toss threw before the first move, so every game
sat on "Tossing a coin…" or a robot that never moved. `sha256` now falls back
to a plain-JS SHA-256 that gives the same bytes (`fair.test.js` compares the
two on every length from 0 to 300), so a peer with WebCrypto and one without
still agree on every draw.

**What this does not stop.** A peer can stall or leave, which looks like a
disconnect. A modified client can also lie in real time; that lie is caught at
the reveal, not prevented. This is the right trade-off for games between
friends with no server-side referee.

### Match protocol (DataChannel, every message carries `m` = match number)

| Message | From | Meaning |
|---|---|---|
| `ready {commit, chain}` | each | Fleet commitment and `SharedRandom` chain tip |
| `draw {k, v}` | each | Reveal for shared draw *k*. Handled outside the step queue, because a queued step may be waiting for it. |
| `fire {w, at, ms, dir}` | shooter | Weapon, aimed square (rain has no `at`), the time spent on the shot, and the carpet bomb's `row` or `col`. Both peers deduct `ms` from the shooter's clock. |
| `result {hits, sunk}` | defender | 0 or 1 per fired square, plus newly sunk ships |
| `timeout {}` | player on turn | Their own clock ran out: they lose, and the reveal follows |
| `reveal {fleet, salt}` | each | After the game ends |
| `abort {reason}` | either | A protocol violation was detected |

Each side processes its own actions and incoming messages through one
promise queue. Both peers therefore take the same steps in the same order:
apply the shot, check gift timing, draw. The draw counter stays in step.

The `m` field and `matchRouter()` keep a rematch from mixing with the
previous match. `setup {config}` (the room's time limits) has no match
number: the view handles it before handing other messages to
`matchRouter()`.

Clocks follow Tic Tac Toe's rules (below): each browser times only its own
player, measured from when the previous volley landed on its screen. The
rules refuse a shot whose `ms` is over the time left, and a browser that sees
the opponent 5 s past their limit with no shot stops the match.

### Robot (`robot.js`)

The robot builds a probability-density map: every placement of every ship
still afloat that fits what is known (misses, cleared water, sunk ships, and
the no-side-contact rule).

- **Target mode** (an unsunk hit exists): only placements covering the hits count, weighted by hits³, so it follows a line once it has two hits.
- **Hunt mode:** it shoots on a parity lattice of the smallest ship left, prefers gift squares, and aims splash weapons where they cover the most density.

It averages about 40 shots to sink a fleet, against about 89 for random fire
(300 fleets, plain shots only; `robot.test.js` checks it stays under 55). It plays through `startRobot(session)`, the same
`SeaBattleMatch` that a human uses, and waits 1.4–2.1 s before each shot so
its moves are easy to follow.

## Tic Tac Toe in depth

Tic Tac Toe has no hidden information, so it runs on `TurnMatch`. What it adds
is room settings and clocks, both of which later games (Connect 4, Gomoku)
can copy; the settings themselves are the engine's `settings.js`.

**Room settings.** Before a game, the player picks the board (3×3 with three
in a row, or 5×5 with four), a limit per move, a total per player, and who
moves first. In a friend game the room creator's settings apply: the host
sends `setup {config}` once, the guest's view waits for it, and both build the
same rules with `makeRules(config)`. The guest normalizes the config, so an
unknown value falls back to the default. A fixed first player replaces the
coin toss inside `newState`; the toss still runs, so the protocol is
unchanged. `setup` has no match number, so the view handles it before handing
other messages to `matchRouter()`.

**Clocks without a referee.** Each browser times only its own player:

- A move carries `ms`, the time its player spent, measured from when that
  browser applied the previous move. Both sides deduct the same `ms` from the
  same clock, so the states stay identical.
- The rules refuse a move whose `ms` is over the move limit or the clock left.
- When a player's own time runs out, their browser sends `{ timeout: true }`,
  and that player loses the round.
- If the other browser sees the opponent 5 s past their limit with no forfeit
  (closed laptop, frozen tab), it stops the match.

A modified client could under-report its `ms`. The 5 s check bounds how long it
can stall, but not small savings on each move. That is the same trade-off as
everywhere else here: fine between friends, not a referee.

## Connect 4 in depth

Connect 4 copies Tic Tac Toe's room settings, `setup {config}` handshake and
clocks, with no engine change. The config adds the board (7×6, 8×7, 8×8, 9×7
or 9×9, always four in a row) and the robot level; the rules ignore the level.
A move is `{ col }`, and the disc lands on the lowest free square, so a full
column is the only illegal drop. The state keeps `heights` per column next to
the board, so both peers find the landing square the same way.

**Robot** (`robot.js`). It takes a win, blocks a loss, and otherwise runs a
negamax search with alpha-beta:

- Before expanding a node it plays forced moves: win now, block the only threat, and never drop under the opponent's winning square. Two threats at once count as a loss.
- Leaves are scored by open lines (weighted by how full they are), a bonus for threes whose gap sits on the row that suits the owner (odd rows for the first player, even for the second), and centre discs. Line counts and the score are updated on each drop, so scoring a leaf is a lookup.
- Moves are tried centre first, then by their static score, so alpha-beta cuts more.

| Level | Depth | Random column | Random column can lose at once? |
|---|---|---|---|
| Easy | 4 | 30% | yes |
| Medium | 5 | 10% | no |
| Hard | 6 | 3% | no |

Over 200 games on 7×6, Hard beats Easy 93% of the time and Medium beats Easy
83%. Hard answers in 3 ms at the median and under 50 ms at worst on 9×9.
`robot.test.js` checks the order of the levels and the 100 ms limit.

## Gomoku in depth

Gomoku is Tic Tac Toe's settings and clocks on a 15×15 board, with no engine
changes. `public/gomoku/` copies the Tic Tac Toe view patterns (`setup {config}`,
clocks, the 5 s claim) rather than sharing them, so each game
can change on its own.

- **Rules.** Five or more in a row wins (an overline counts, as on papergames),
  any empty point may be played from the first move, and a full board is a draw.
  Only the lines through the new stone are checked.
- **Robot.** For each empty point near the stones, it looks up the shape one
  more stone makes along each of the four lines: five, open or closed four,
  three or two. A line is the 4 points on each side, each empty, own or blocked,
  so there are 3^8 patterns. They are classified once at load, and every lookup
  after that is 8 reads. A point's score adds its own shapes to the opponent's
  shapes it would block, with bonuses for double threats. The robot takes a win,
  blocks a five, then usually plays the best score. About one move in eight is
  a random point next to the stones, so it can be beaten. A move takes well under
  1 ms.
- **Board.** One button per point over an SVG grid. The board is a single tab
  stop: arrow keys move between points (roving `tabindex`), and Enter or Space
  plays. At 360 px a point is about 21 px wide, so the board fills the width with
  no horizontal scroll.

## Chess in depth

Chess is a `TurnMatch` game with Tic Tac Toe's room settings and clocks: a
limit per move (30 to 120 s), a total per player (3 to 60 min), who plays
White, and a robot level. All default to papergames' values (no clocks, coin
toss, Easy). The engine is unchanged.

**Moves.** A move is `{ from, to, promo?, ms }` in square indexes (a1 = 0,
h8 = 63), `{ timeout: true }`, or `{ resign: true }`. `rules.js` generates
pseudo-legal moves and drops those that leave the king in check, so it can
explain a refusal ("That would leave your king in check"). Perft counts on
the standard test positions pin this down in `rules.test.js`. Resigning is a
move, so it is only possible on your own turn: TurnMatch accepts nothing from
a player out of turn, and an out-of-band message could race the other
player's move.

**Draws are automatic.** papergames' client uses chess.js, whose game-over
check ends the game on stalemate, threefold repetition, 100 half-moves without
a capture or pawn move, and insufficient material (bare kings, a single minor
piece, or bishops all on one colour). Here the rules do the same after each
move, so neither peer has to claim anything. The repetition key is the board,
side to move, castling rights, and the en passant square only when a capture
there is legal. The list of keys restarts after a pawn move or capture.

**Robot.** `robot.js` takes a mate in one, never allows a mate in one when it
can avoid it, then runs alpha-beta with captures searched to a quiet position,
MVV-LVA and killer-move ordering, and material plus piece-square tables (with
a "drive the king to the edge" term for won endgames). Levels set the depth
(2, 3 or 4 plies), how far below its best score a move may be and still be
picked (150, 40 or 0 centipawns), and how often it plays a random safe move
(20 %, 5 % or never). A node budget keeps answers bounded and deterministic in
tests; in the browser a 250 ms time cap also applies, so a slow phone gets a
shallower search instead of a frozen page.

The search takes milliseconds, so the robot pauses like a person before
moving: 0.7–1.3 s in the opening, 1.2–2.5 s later, 0.5 s for a forced move,
and never more than a thirtieth of its clock. The engine's `startTurnRobot()`
only takes a fixed delay, so `robot.js` has its own `startRobot()`, the same
loop with a pause per move. Its clock pays for the pause and the search.

**Motion and sound.** A move glides from its old square to the new one in
190 ms (castling slides the rook too); a taken piece tips over and fades with
a small ring as the attacker lands on it. A dragged piece is already in place,
so it doesn't slide. With "reduce motion" set in the OS, nothing animates.
When the piece lands it plays one of four CC0 recordings of a piece set down
on a wooden board; a capture plays a sharper wooden clack instead, and
castling knocks twice, king then rook (`chess/sounds/LICENSE.txt`). Sounds go
through `sounds.js` and the engine, so the header's mute toggle covers them.

**Colours.** The board and pieces have their own light and dark tokens at the
top of `chess/style.css`, because a white piece must stay white in both
themes. Everything else uses the theme tokens.

## Checkers in depth

Checkers follows papergames' variant, English draughts: 8×8, 12 men each,
forced captures, multi-jumps that must be finished, and kings that move one
square in all four diagonals. A man that reaches the far row is crowned and
its turn ends. A player with no piece, or no legal move, loses. After 40 turns
in a row (20 each) with no capture and no new king, the game is drawn.

It reuses Tic Tac Toe's room settings and clocks unchanged: `setup {config}`
from the host, `makeRules(config)`, and `ms` on every move. The settings add
a robot level, which stays in the browser and never goes in `setup`.

**A move is the whole path.** `{ path: [from, landing, ..., to] }` covers a
step or a full multi-jump in one message, so a turn is one TurnMatch move and
the protocol needs nothing new. `rules.js` lists every legal path (only
captures when one exists, each jumped as far as it goes) and accepts a move
only if its path is one of them. The view builds the path one tap at a time
and sends it when it is complete. Player 0's men start at the bottom and
player 1's at the top; the view turns the board for player 1.

**Robot.** Alpha-beta search to depth 4, 5 or 6 for Easy, Medium and Hard,
with 30 %, 10 % and 0 % random moves. Captures extend the search, so it never
stops in the middle of an exchange. The score counts material (a king is 1.5
men), how far men have advanced, a guarded back row, central kings and
mobility; the side that is ahead also likes trades and kings near the enemy,
so won endgames finish before the 40-turn draw. A node budget caps each move
at about 35 ms on a laptop. Before searching it takes a move that leaves the
opponent stuck, and avoids one that lets the opponent do that.

**Sounds.** `sounds.js` synthesizes a wooden clack per landing, a knock per
captured piece and a chime for a new king, and plays them through the engine,
which follows the header's mute button. Audio starts on the first click or key
press; until then sounds are skipped rather than queued, so a friend who
opened the invite link but hasn't clicked yet doesn't get a burst of them
later. This holds for every game.

## Backgammon in depth

Backgammon is the first `TurnMatch` game with dice. It copies Tic Tac Toe's
room settings (`setup {config}`, plus a robot level) and clocks. There is no
doubling cube and no gammon: the first to bear off all fifteen checkers wins
one game.

**Position.** Each side counts points from its own home board: `pos[p][n]`
is how many of player p's checkers stand on p's point n, with the bar at 25
and borne-off checkers at 0. Your point n is the opponent's 25 − n, so the
move generator, the view and the robot run the same code for either player.

**A turn is two moves.**

- `{ type: "roll", ms }`: `needsRandom` is true, so both peers draw the dice through `SharedRandom`, and neither side can choose or predict them. The view sends it by itself when the turn starts. A roll with no legal play passes the turn inside the rules, so both peers pass it without another message.
- `{ type: "play", steps: [[from, die], …], ms }`: the whole turn, sent on Confirm. Picking checkers and Undo stay in the view. The rules replay each step and refuse a play that doesn't use as many dice as it could, or that plays the smaller die when only one fits. Bearing off the last checker wins at once.
- The roll's and the play's `ms` share the turn's limit (`state.spent`), and both come off the player's clock.

**Why the engine got `draws`.** Every roll is one shared draw. A chain of
256 links covers the coin toss and 255 rolls. Sensible games need 50 to 150
rolls, but in random-vs-random games about 2 in 1000 go past 255, and the
match would stop with "hash chain exhausted". There was no way around it
inside the game folder: the chain is built in `TurnMatch`'s constructor.
Backgammon's rules ask for `draws: 1024`, which takes about 10 ms to build in
Chromium against 2 ms for 256. Other games keep the default, and the
protocol is unchanged.

**Robot.** It lists every distinct legal play for the roll (with a double,
steps go from non-increasing points, so each final position comes up once)
and scores the position each one leaves, in pips: the pip lead, made points
weighted by where they stand, primes, checkers on the bar and borne off, and
the pips its blots could lose to the opponent's next roll. It always takes a
win, and when the opponent could bear off next turn it hits if it can. In a
race, where nothing can be hit, every level plays its best move: random
moves only happen while there is still contact.

| Level | Blot risk | Random play | Wins vs Hard | Wins vs a random player |
|---|---|---|---|---|
| Easy | direct shots, one blot at a time | 30% of turns | 12% | 97% |
| Medium | direct shots, one blot at a time | 8% | 34% | 99% |
| Hard | every one of the 36 rolls, blocked paths included | never | — | 100% |

Medium beats Easy 74% of the time (1000 seeded games per pair). Each choice
takes under 2 ms in Node; `robot.test.js` holds the levels apart and checks a
crowded board with doubles stays under 100 ms.

**Motion and sound.** The match state never waits for the screen. When a
checker moves, the real one is drawn hidden where it lands, and a copy flies
there over the board: lifted a little, along a low arc, for 240 to 620 ms
depending on the distance (your own moves fly a third faster). A checker that
is hit flies to the bar once the mover lands, and a borne-off checker shrinks
into a slab in the tray. The opponent's play waits 250 ms after their dice
land, then moves one checker at a time with a short pause between steps; your
dice roll 400 ms after their last checker settles. New dice tumble in. Every
landing plays a recorded wooden clack, and a roll plays dice on wood, through
`sounds.js` and the header's mute toggle. With `prefers-reduced-motion`,
checkers move at once and the dice don't tumble.

**Picking, dragging and marks.** You tap a checker and then a point, or drag
the checker there with a mouse or finger (pointer events; a press that
doesn't move is a tap, and a drop anywhere else sends it back). The landing
spot shows as a dashed circle in the next free place on the point, or around
the top checker of a full stack or the blot it would hit. After the
opponent's play, each checker that arrived gets a ring and each place one
left keeps a faint outline, until your play goes out.

**Forced moves.** When you have no choice, the view moves for you: a step
is forced when it is the only legal one, or when every legal way to play the
rest of the roll ends in the same position (`legalPlays()` finds one). Forced
steps play themselves after 550 ms; a turn that was forced all the way is
confirmed too, with a toast, so the turn passes. Undo takes back the last step
you chose, with any forced steps after it, and is off while every step was
forced.

**Racing home.** Once no checker can be hit (`inContact()` is false for good),
the game offers once per match to move for you. Yes plays each of your turns
one step at a time with Hard's choice, then confirms; Stop, or "Play for me"
after a no, switches it at any time. It is only the view pressing the
buttons for you: the same `play` message goes out, so the protocol and the
other side don't change. Against the robot, the robot keeps the same quick
pace meanwhile: its pause before a move drops from 800 to 250 ms, and its
checkers replay at your own speed. The robot runs on `startRobot()` in
`robot.js`, a copy of the engine's `startTurnRobot()` that asks for the pause
before each move instead of taking a fixed one.

## Chutes and Ladders in depth

Chutes and Ladders runs on `TurnMatch`, for two to four players. It copies
Backgammon's room settings (`setup {config}`) and shared luck, but has no
clocks and no robot levels: the game has no choices, so a move is just
`{ type: "spin" }` and the robot only spins.

**Board.** The classic 1943 layout: squares 1 to 100 snake up a 10×10 grid
(1 bottom left, 100 top left), with nine ladders (1→38, 4→14, 9→31, 21→42,
28→84, 36→44, 51→67, 71→91, 80→100) and ten chutes (16→6, 47→26, 49→11,
56→53, 62→19, 64→60, 87→24, 93→73, 95→75, 98→78). Pawns start on a lawn
below square 1 (`pos` 0), and both may share a square.

**A spin.** `needsRandom` is true for every spin, so the 1–6 comes from
`SharedRandom` like Backgammon's dice. `spinResult()` returns everything the
view animates: the squares hopped (`path`), the square landed on, a ladder or
chute taken (`jump`), and the flags `bounce`, `stay`, `again` and `win`. Only
the square a pawn stops on counts.

**Room settings.** The finish (`exact`: an overshooting spin leaves the pawn
where it is, the classic rule; `bounce`: the extra steps walk back from 100,
and the square reached can be a chute; `any`: reaching 100 wins), whether a 6
spins again (a winning 6 still ends the game), and who starts. The spinner
mode (tap, or spin by itself) is per player and never sent: it only decides
when that player's own browser sends its spin. Each spin is one shared draw;
`DRAWS` is 1024, and `rules.test.js` checks that 600 seeded games stay under it.

**Motion.** The match state never waits for the screen. Each spin event is
queued and played out in order: the spinner's pointer eases to the drawn
number (your own spin starts turning the moment you press Spin, while the draw
completes), the pawn hops square by square on a short arc with a squash on
landing, then climbs a ladder rung by rung or rides the chute's Bézier curve,
speeding up and tilting with it. A burst of stars marks a ladder's top, dust a
chute's foot, and confetti the win. When spins pile up (a hidden tab, a 6
spinning again) the queue plays faster; with the tab hidden or
`prefers-reduced-motion` set, it applies them at once. The result panel
waits for the winning pawn to arrive. The pawn whose turn it is bobs on the spot.

**Art.** Everything is inline SVG drawn in code: pastel squares, wooden
ladders, chutes drawn as playground slides (a rim, raised walls, a bed and a
shine, a deck with handrails at the top and a run-out lip at the bottom), and
kids on stands for pawns. As on the classic board, small pictures tell a
story at both ends: a good deed at a ladder's foot and its reward at the top
(seedling → flower, sweeping → star, reading → medal…), mischief at a chute's
top and what came of it at the bottom (too many cookies → tummy ache, a ball
→ broken window…). The board's palette lives in `style.css` as `--cl-*`
tokens with a dark set.

**Sound** (`sounds.js`, synthesized, behind the header's mute toggle). The
spinner clicks once per wedge, so the clicks slow down with the
pointer; a hop is a pawn tap plus a marimba note that climbs a C-major
pentatonic scale with each square (and walks back down after a bounce); a
ladder is a xylophone run, then a shimmer; a chute is a slide whistle over
rushing air, then a bump; overshooting with the exact rule is a two-note
"nope", bouncing off 100 a spring; plus a turn chime. The end of a match
plays the engine's result chime (see **Result moment**).
The spin (flick and settle) is an `action`, like a hop, so spinning sounds
as loud as moving (see **Sound levels**).

**Up to four players.** It is the first game that seats more than two (see
**Groups**). The rules keep one pawn per seat (`pos`, `spins`, `climbs` and
`slides` have `players` entries) and pass the turn to the next seat; the game
has no draws, so `winner` is always a seat. "Next player" as the first-spin
setting means seat 1, the first friend in. The room creator's `setup` is
accepted only from seat 0. Pawns are coral, teal, violet and amber by seat,
the same on every screen, everywhere a player's colour shows
(name, score, pawn, last-square ring, spin log). Two pawns on a square stand
side by side; three or four stand staggered across it. A robot game has 1 to
3 robots, from a per-device setting the lobby reads when the game starts
(`robots` may be a function). The room starts when the host presses Start,
or by itself once four are in.

## Dots and Boxes in depth

Dots and Boxes runs on `TurnMatch` with no engine change. It copies Tic Tac
Toe's room settings and clocks (`setup {config}`, `makeRules(config)`, `ms`
on every move) and adds a board size (3×3 to 6×6 boxes) and a robot level,
which stays in the browser. There is no luck, so nothing needs `needsRandom`;
only the coin toss for who starts is shared.

**Rules.** A move is `{ line, ms }`. Lines are numbered horizontal first, row
by row, then vertical (`rules.js` explains the formula), and `geometry(n)`
lists each box's four lines and each line's one or two boxes, so every check
is a lookup. A line that draws a box's fourth side claims it for whoever drew
it, even if the other player drew the first three. If a line closes one box
or two, the same player moves again; otherwise the turn passes. When every
box is claimed the higher score wins, and an even split (possible on 4×4 and
6×6) is a draw (`winner` 2). The event `{ type: "line", player, line, boxes,
again }` carries everything the view animates.

**Clocks and extra turns.** Every line is its own move, so a box's extra line
gets a fresh line limit, and each line's `ms` comes off the game clock. The
rules check it the same way on both sides. What needed care is when a clock
starts, because the opponent's lines are replayed at a readable pace:

- Your own clock starts when their last line has finished playing out on your
  screen, not when it arrived: you can't draw while it replays, and a long
  chain can take several seconds to replay.
- The opponent's clock on your screen starts later by about the time their
  browser needs to replay your lines (both run the same pacing code). Without
  that, their bar would run out early on your screen.
- The 5 s claim against a stalled opponent also allows 1.3 s for each line of
  your last turn, so a long chain you took can never look like their timeout.

A modified client could still under-report `ms`, as in the other games.

**Robot** (`robot.js`, its own `startRobot()` so it can pause like a person:
0.65–1.3 s to start a turn, 0.4–0.6 s to take another box).

| Level | Boxes on offer | Otherwise |
|---|---|---|
| Easy | takes one 85% of the time | a safe line 60% of the time, else any line |
| Medium | always takes them all | a random safe line; with none left, opens whatever gives away the fewest boxes |
| Hard | takes them all, or all but the last two (four in a loop) to keep control | searches the last safe lines and the endgame exactly |

Hard's strategy is the classic one, worked out by search rather than by rules
of thumb:

- **Endgame arithmetic.** Once no safe line is left (every line would give
  away a box's third side), the board breaks into chains (ending at the edge)
  and loops. Whoever must move opens one, and the other player either takes it
  all and opens the next, or takes all but two of a chain (all but four of a
  loop) and leaves them with one line, the double-cross, so the opener has to
  take those and open the next. `chainValue()` works out the best order with
  memoized recursion over the multiset of lengths. A two-box chain is opened in
  the middle, so it can't be declined.
- **Junctions.** When some box still has fewer than two sides drawn, the
  components join at it and the arithmetic no longer applies. The robot then
  tries every opening line and simulates the capture: the taker grabs the
  shortest run first, so the run left to decline is the long one.
- **Safe lines.** With 16 or fewer safe lines left, it searches them, together
  with deliberate sacrifices, down to the endgame values above. That is
  exactly the fight over the parity of long chains. Earlier it plays a random
  safe line. A shared memo keyed on the drawn lines (two exact numbers)
  carries over between moves, and a budget of 20,000 positions bounds every
  move.

Checked against an exhaustive search, Hard picks a best line in every one of
800 3×3 positions with 10 to 14 lines left and 400 4×4 positions with 12 left
(`robot.test.js` repeats this on 200 3×3 positions). Over 200 games, Hard beats
Medium 81% of the time on 4×4 (14% draws) and 90% on 6×6, and both beat Easy
98% of the time. Hard takes under 0.1 ms at the median and 35 ms at worst on
6×6 in Node.

**Board.** One inline SVG: a sheet of graph paper (`--db-*` tokens with a dark
set), ink dots, and lines drawn as quadratic curves with a fixed hand wobble
per line, so both screens show the same sketch. Lines are coral for whoever
draws first this match and teal for the other, on both screens (see **Player
colours**). A claimed box gets a tint, quick
pencil hatching and its owner's initial. Every line has an invisible diamond
tap target reaching to the two box centres beside it, so the targets tile the
board: a tap anywhere picks the nearest line, about 47 px across on a phone
even on 6×6. A hover, or the keyboard cursor, sketches the line in dashes
first. The board is one tab stop: the arrow keys step half a box at a time
(alternating across and down, so every line can be reached), a live region
reads out the line ("Across from B2 to C2: free"), and Enter or Space draws.

**Motion.** The match state never waits for the screen. Every line is queued:
the opponent's get a beat before each line, a 330 ms pen stroke with a
graphite tip leading it, then each box it closes pops (the tint springs out
with an overshoot, the hatching scribbles in, the initial lands, a ring and a
few flecks fly off). Two boxes closed by one line pop 110 ms apart, a run of
three or more swells box by box when the turn ends, and the winner's boxes do
the same at the end. Your own strokes take 170 ms. A backlog plays at double
speed; a hidden tab, or `prefers-reduced-motion` (read when each animation
starts, so tests can switch it mid-game), applies lines at once. Animations
belong to a match generation, so a rematch drops the old queue and its counts.
The result panel waits for the last box.

**Sound** (`sounds.js`, synthesized like Chutes and Ladders', behind the
header's mute toggle): a pencil scratch per line (grains of filtered noise
shaped to the stroke's length, over a darker rub, with a tap at the end), a
pop and a mallet note per box that climbs a pentatonic scale through a turn's
run, a sparkle when a run of three or more ends, a soft thud for a line that
can't be drawn and the turn chime; the end of a match plays the engine's
result chime (see **Result moment**). A line is an `action` and a box a
`highlight` (see **Sound levels**).

## Ludo in depth

Ludo runs on `TurnMatch` for two to four players, with no engine or server
change. It combines Chutes and Ladders' seating (four seats, a robot count,
`setup` accepted only from seat 0) with Backgammon's turn shape: a shared
roll, then a choice.

**Board and paths.** The classic cross on a 15×15 grid: four 6×6 yards, a
shared loop of 52 squares, a five-square home column per colour and the
centre. `rules.js` doesn't know the grid. A token's place is its progress
along its own path: −1 in the yard, 0 on its start square, 1–50 round the
loop, 51–55 up its home column and 56 home. `square(color, r)` maps progress
to a loop square (start squares 1, 14, 27 and 40; stars eight squares after
each), and only the view (`art.js`) turns squares into grid cells. Colours go
clockwise in turn order (red, green, yellow, blue); two players sit opposite,
as red and yellow, so the empty yards are the other diagonal.

**A turn is two moves.**

- `{ type: "roll" }`: `needsRandom` is true, so every peer draws the die through `SharedRandom`. The rules list the legal moves right away: with none, or with a third 6 in a row under that house rule, the turn passes inside the rules, so nobody sends another message (as in Backgammon).
- `{ type: "move", token }`: the token moves the rolled number. A 6 earns another roll; so does a capture when the room turns that on (only one extra roll either way).
- The event carries everything the view animates: the path, captures (with where each victim stood), entering, home, safe square, a finish and its place, and why another roll follows.

**Rules worth noting.** A token needs a 6 to come out onto its start square,
and never captures there. Start and star squares are safe, so tokens of
different colours share them; anywhere else, landing on a square sends every
rival token on it back to the yard. The centre needs an exact roll. With the
**block** house rule, two tokens of one colour on a loop square can't be
passed or landed on by anyone else; a block on someone's start square doesn't
keep them in their yard (start squares are safe for everyone), so a robot or
a player can't jail a colour for good, and seeded games with blocks always
finish. **Playing for places** (the default) keeps the game going after the
first finish until one player is left; with **Game ends**, the rest are
ranked by how far their tokens got. `state.order` is the standings either
way, and `winner` is `order[0]`, so `TurnMatch` sees the match end once.

**Draws.** Each roll is one shared draw. Over 3000 seeded four-player games,
playing for places with every house-rule mix, the longest used about 1100
rolls (random players use fewer than Easy robots), so `DRAWS` is 2048: the
chain takes about 20 ms to build. `rules.test.js` checks seeded games of two,
three and four players stay well inside it.

**Room settings.** Three 6s in a row lose the turn (on), blocks (off), a
capture rolls again (off), play for places (on), who rolls first (the coin
toss, the room's creator, or seat 1), and a time to move (off, 10, 20 or
30 s). The robot level and the number of robots stay on the device and only
matter in a robot game.

**Move timer.** There is no clock in the rules: running out never loses,
because a stalled player would hold up three others. Each browser times only
its own player, from when the replay of the previous move finished on its
screen; when time is up it rolls, or plays Medium's choice, as a normal move.
Other screens show the same bar for whoever is on turn and, 6 s past it, say
they are waiting for that browser. A frozen tab still stalls the game; any
player can leave, which ends it for everyone.

**Robot** (`robot.js`). It scores the position each legal move leaves. A
token is worth its progress, much more once it is in its home column or home
(nothing can touch it there); each exposed token loses what it stands to lose
times the chance a rival behind it lands on it next turn; and the rivals'
progress counts against it, so a capture is worth what the victim loses.

| Level | Sees | Random move |
|---|---|---|
| Easy | nothing: takes a capture, brings a token out, else runs its leader | 45% |
| Medium | rivals one roll (1–6) behind each token | 10% |
| Hard | also 6-then-the-rest shots, tokens about to come out of a yard, its own chances to capture next turn, and blocks in front of rivals when that rule is on | never |

Over 400 seeded two-player games Hard beats Easy 78% of the time, Hard beats
Medium 61% and Medium beats Easy 66%; a choice takes under 1 ms.
`startRobot()` is the engine's robot loop with a pause asked for each move:
robots wait while your screen is still replaying (so a robot game never
builds a backlog), pause 0.5–0.6 s like a person (0.35 s for a forced move),
hurry once you are home, and skip ahead if you press **Skip to the
standings**. With `prefers-reduced-motion` nothing replays, so robots pause
for a fraction of that.

**Board and tokens.** `art.js` draws the board as inline SVG in the classic
layout, red top left, and the view turns it so your yard is bottom left on
every screen; stars, names and tokens are drawn in an upright layer so they
don't turn. Your colour is the same everywhere it shows: pill, score, tokens,
log, die, timer and standings. Every colour also has a mark (circle,
triangle, square, diamond) on its tokens, yard, pill and standings, so
nobody has to tell colours apart. Tokens are turned pawns (base, bell body,
collar, ball head) shaded by gradients that read the theme's colour tokens.
Two tokens on a square stand side by side, three or four in a cluster; a
block gets a dashed plate. After your roll, every token that can move bobs
with a white-and-dark ring (visible on any colour), and a dashed marker shows
where each would land: a cross for a capture, gold for home. Hover or focus
a token to see its path. You tap the token or its landing spot; on a
keyboard, Tab or the arrow keys pick a token, Enter or Space moves it, keys
1–4 pick your tokens and R rolls. When only one move is possible (tokens on
one spot count once) it plays itself after 650 ms.

**Motion.** The match state never waits for the screen. Every roll and move
is queued: the die tumbles (its pips flicker) and lands with a bounce in the
roller's colour; a token pops out of its yard onto its start square, hops
square by square with a squash on each landing, and a captured token flies
back to its socket on a high tumbling arc; a safe square sparkles, the home
column hums, and home and the finish throw confetti. When moves pile up the
queue plays faster; a hidden tab or `prefers-reduced-motion` (read live, so
tests can switch it) applies them at once. Animations belong to a match
generation, so a rematch drops the old queue. The result panel waits for the
last token and lists the standings with each player's rolls and captures (or
tokens home). If a player leaves, the engine's notice gets a line
saying the game is over for everyone, with where each player stood.

**Sound** (`sounds.js`, behind the header's mute toggle). The die plays
Backgammon's CC0 dice recordings (`ludo/sounds/LICENSE.txt`); the rest is
synthesized like Chutes and Ladders': a wooden tap and a marimba note per hop
that climbs as the token goes, a cork pop for coming out, a shimmer into the
home column, a small bell on a safe square, a bonk for a capture (a slide
whistle down if it was yours), a fanfare home, a chirp for another roll, a
soft "no" for a passed turn, ticks for the timer's last seconds and the
turn chime; the end of a match plays the engine's result chime (see
**Result moment**). The die and a hop are both `action` sounds, so rolling
and moving sound about as loud (see **Sound levels**).

## Crazy Eights in depth

Crazy Eights is the first game on `CardMatch` (see **Card games**), for two
to four players with a 52-card deck. It copies Ludo's seating (four seats, a
robot count, `setup {config}` accepted only from seat 0, a move timer that
never loses) and Backgammon's habit of making forced moves for you.

**Cards.** A face is 0–51: `suit = Math.floor(face / 13)` (spades, hearts,
diamonds, clubs) and `rank = face % 13` (ace, 2 … 10, jack, queen, king).
`newState` deals one card at a time round the table, starting with the first
player: 7 each for two players, 5 for three or four. The rest is the stock,
top first. `settle()` turns the starter: it opens the stock's top card into
the discard pile, and the next `settle()`, when the face has arrived, reads
it. An 8 goes to the bottom of the stock (face up, since everyone saw it) and
the next card is turned, as often as it takes.

**A turn.** A move is `{ play: slot }`, `{ play: slot, suit }` for an 8,
`{ draw: true }` or `{ pass: true }`. `reveals()` names the played card, so
the move carries its holder's share and everyone reads it before
`applyMove()` checks it against the suit to follow (`state.suit`, the top
card's or the one an 8 named) and the top card's rank. Drawing keeps the
turn: with **Draw until you can play** (the classic rule) you draw again and
again; with **Draw one, then pass**, one card, after which you play or pass.
When the stock runs out, the discard pile under its top card goes through
`deck.shuffle()` into a new stock, so every player shuffles it again with a
proof. With nothing left to draw you pass; a full round of passes with
nothing drawn ends a blocked game, won by the fewest cards (a tie goes to
whoever is first in turn order from the player on turn). A game can also
go round in circles: with action cards, two players with nothing else that
plays can be forced to trade the last two queens for ever while the others
are skipped. So after 1200 turns (draws within a turn don't count) the game
ends the same way, with "the game went on too long" rather than "nobody could
move". The longest honest games between four Hard robots take about 800
turns; about one in 4000 with action cards loops until the limit.

**Draw only when you can't play.** On by default. Nobody can see your hand,
so the rule throws only when every face is known: in the audit. During play
`deck.face()` is null for the cards in your hand, so the state never depends
on them, and a player who draws (or passes instead of drawing from empty
piles) while holding a card that plays gets a failed verdict naming them.
Your own browser enforces it for you, so it can only be broken on purpose.
With the setting off, you may draw any time. The pass after the one draw of
**Draw one** is always allowed: you may keep a card that plays.

**Action cards** (off by default). A 2 deals the next player two cards from
the stock (reshuffling if need be) and they miss their turn; 2s don't stack.
A queen skips the next player. An ace reverses the direction; with two
players it gives you another turn, as a reverse can't otherwise change
anything. A starter that is an action card does nothing.

**Ranking.** The first player out wins and scores a point on the board,
which carries across rematches. The others are ranked by penalty points left
in their hands (8s 50, court cards 10, aces 1, others their number), and
by cards left as long as the hands are hidden. Penalty points need every
face, so they are counted from `match.face()` once the audit has passed (the
one engine change this game needed, see **Card games**); the state doesn't
depend on them. A blocked game's winner is decided by card counts, which
everyone can see.

**Robot** (`robot.js`). A robot only uses the public state and its seat's
`face()`, which is null for other hands; `robot.test.js` swaps the faces in
another hand and checks the robot's moves don't change.

| Level | Plays | Names |
|---|---|---|
| Easy | a random card that plays, 8s included | a random suit it holds |
| Medium | the current suit before a rank match, 8s only when nothing else plays | the suit it holds most of |
| Hard | scores each card: how many of the new suit it keeps, how few of that suit are left unseen (it counts the pile and every open card), the suit the next player last drew or passed on (with the strict rule they probably don't hold it), high penalty cards first, and, with action cards, a 2, queen or ace at whoever is closest to going out | the suit that scores best the same way |

Any level breaks a cycle of 8s: once a whole round has been nothing but 8s
(everyone short of the suits being named, and the stock maybe only 8s), an 8
names the suit the next player most likely holds rather than one they lack.
Without that, about one four-player game in a hundred between Hard robots
went on to the move limit.

Crazy Eights is mostly the deal: over 1000 two-player games Hard beats Easy
about 60% of the time (`robot.test.js` checks over 55%), and among three
Easy robots it wins about 30% (25% would be even). A choice takes under 1 ms.
`startRobot()` is `startCardRobot()` with a pause asked for each move, as in
Ludo: robots wait while your screen replays, then think like a person,
0.4 s for a forced draw, 0.6 to 1.8 s for a real choice, and half a second
more to name a suit after an 8. In a hidden tab they hardly wait; with
reduced motion they wait less. `globalThis.ddpRobotPace` scales every pause,
so a test can run a whole robot game in about the time the deck's
cryptography takes.

**Your turn.** The cards that play glow and rise; the rest dim. When nothing
plays, the draw (or pass) is made for you after 0.7 s. An 8 opens a small
suit picker over the table, suggesting the suit you hold most of; the arrow
keys and Enter pick, Escape cancels. On a keyboard the hand is one tab stop
(arrow keys, Home and End move, Enter plays); D draws and P passes. The move
timer (15, 30 or 60 s, off by default) times only your own browser, which is
the only one that knows your hand, so it plays the first card that plays (an
8 naming your longest suit), or draws or passes.

**Table.** The felt sits in a wooden rim. Opponents sit round it in turn
order, the next player on your left, with a fan of card backs and a count;
on a phone (or a narrow table, by container query) they share the top row.
The stock and the discard pile are in the middle, with a badge for the suit
to follow that glows when an 8 named it, and the direction of play when an
ace can turn it. Your hand is fanned at the bottom and sorted by suit; a
hand too big for the row overlaps more, then scrolls inside its own row.
Each player keeps one colour by seat everywhere it shows (coral, teal,
violet, amber: pills, seats, score, log, standings).

**Card art** (`art.js`). Inline SVG drawn in code: suit pips, large corner
indices, the classic pip layouts, aces in a dotted ring, and original court
figures (a jack in a feathered cap with a leaf staff, a queen with a tiara
and a flower, a bearded king with a crown and sceptre) drawn once as the
upper half and turned round for the lower, like a real double-headed card.
The back is a coral lattice with an eight-pointed star. Each shape is one
`<symbol>`, so a card is a few `<use>`s; the shapes inside carry inline
styles, because a `<use>` clone doesn't match the page's class selectors.
Faces stay paper-white in dark mode. **Four colours** (per device) draws
diamonds blue and clubs green; the suits differ by shape either way.

**Motion.** The match state never waits for the screen. While the deck is
shuffled, half-decks riffle over the stock and the table says what the
browsers are doing (only after half a second, so quick deals don't flicker).
The deal flies card by card to each seat, and your cards turn face up once
their shares have arrived; the starter flips onto the pile; a played card
flies from its seat to the pile, turning over when it comes from an
opponent; a drawn card flies from the stock to the drawer, face down for
everyone else; an 8 sends its named suit bursting from the pile; a reshuffle
gathers the pile into the stock; the last card gets a "Last card!" call, and
the win confetti. Every event is queued and played in order, faster when
turns pile up, and at once with `prefers-reduced-motion` (read at each use)
or a hidden tab. Motion uses the Web Animations API on transform and
opacity, timed from the `--dur-*` and `--ease-*` tokens. Animations belong
to a match generation, so a rematch drops the old queue and its count.

**Sound** (`sounds.js`). The card handling is recorded, from Kenney's CC0
"Casino Audio" (`crazy-eights/sounds/LICENSE.txt`): a riffle while the deck
is shuffled, a soft flick per card dealt, a snap for a card played, a slide
for a card drawn, and a fan of cards for a reshuffle. The rest is
synthesized: a rising arpeggio and sparkle for an 8 (ending on a note that
depends on the suit named), knocks for a 2, a whoosh for a skip, a swoop for
a reverse, a bell call for the last card, the turn chime, a soft pass, the
timer's ticks, and tunes for a win and a loss.

**Leaving.** Any player leaving ends the game for everyone, since every card
needs every player's key. The engine's notice gets a line saying whether
the game was checked: verified before they left, left during the audit so it
couldn't be verified, or stopped before the end. With three or more players
it also says the game is over for everyone and lists each player's cards
left.

## Differences from the reference (wasmerio/edge-multiplayer-games)

| Reference | Here | Why |
|---|---|---|
| One Wasmer app per game plus a static index app | **One app** serving `/`, `/<slug>/`, one `/ws` and `/healthz` | One deploy and one URL; no per-game Wasmer setup; adding a game needs no infrastructure work |
| Room per app | Rooms keyed by game slug on a shared `/ws` | The signaling server stays game-agnostic while games share one endpoint |
| Each game copies `server.js` and the top half of `client.js` | Shared `public/engine/`; a game is one folder plus one registry entry | Less copy-paste drift, and a smaller job for automated game PRs |
| Host runs the simulation, guests render snapshots | Symmetric peers, commitments, shared randomness | Turn-based games with hidden information must not trust the host |
| Index polls each game's `/healthz` cross-origin | Index reads `games.json` from the same origin; "Coming soon" is a registry status | One app, so no cross-origin status needed |
| `automation/` folder, cron, `deploy.sh`, Pi and OpenAI | None | Daily games will come from scheduled routines that open PRs |
| `deploy.sh` with a token on a dev machine | Wasmer GitHub integration deploys every push to `main` | No tokens or secrets in the repo |
| Agent guide in `AGENTS.md`, plus a symlink to it | One plain-file guide, `CONTRIBUTING.md` | Wasmer's packager refuses symlinks; one guide serves people and tools |
| Lobby socket kept open for late joiners | Socket closed once the game starts | The room is complete at that point; it frees the room and the instance |
| Ad-hoc test scripts | `node --test` unit and integration tests, plus a Playwright test that skips when Playwright is missing | One command, runs in CI or locally |

Kept from the reference: Node with `ws` on EdgeJS, detected from
`package.json`; a game-agnostic signaling server; public STUN and no TURN;
ordered, reliable DataChannels; `/healthz` with `Access-Control-Allow-Origin: *`;
the `?room=CODE` invite contract; and pinning one region.

## Platform constraints

- **No TURN server.** Edge has no UDP, so relays can't run there. Some network pairs (symmetric NAT, strict firewalls, some mobile carriers or VPNs) can't connect. The lobby detects ICE failure or a timeout and explains this, offering a retry and the robot. A TURN service hosted elsewhere could be added to `ICE_SERVERS` in `engine/peer.js`.
- **Players see each other's IP address.** With two players each browser sees the other's; with 3 or 4 the host's browser sees every guest's and each guest sees the host's (see **Groups**). The STUN servers in `engine/peer.js` see it too. Without a TURN relay it can't be hidden, so the lobby says under the Play buttons that games connect browsers directly and to play with people you know (`.lobby-note`), and the privacy page spells it out.
- **Rooms live in one instance's memory.** Edge may run several instances, so `app.yaml` pins a single region. If joins ever miss rooms, move rooms to Wasmer's managed Postgres.
- **Instances are ephemeral.** Once players are connected nothing depends on the server, so an instance going away never ends a game.
- **No build step.** Plain ES modules are served as-is, and `node --test` imports the same files the browser runs. The one compiled file, the card deck's WebAssembly, is built ahead and committed, and CI checks it matches its source (see **Card games**).
