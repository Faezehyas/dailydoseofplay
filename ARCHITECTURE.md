# Architecture

Daily Dose of Play is a free, no-login site of two-player browser games. One
small Node server on Wasmer Edge serves the pages and introduces players to
each other. The games themselves run browser to browser over WebRTC
DataChannels.

```
            ┌──────────────── Wasmer Edge: one app, one URL ────────────────┐
            │  GET /             home page (cards from games.json)           │
            │  GET /<slug>/      a game: public/<slug>/                      │
            │  GET /engine/…     shared browser engine                       │
            │  WS  /ws           signaling: rooms scoped by game slug,       │
            │                    opaque SDP/ICE relay                        │
            │  GET /healthz      {ok, rooms, players, games} (CORS *)        │
            └───────────▲──────────────────────────────────▲─────────────────┘
                        │ WebSocket (only until connected)  │
                 ┌──────┴──────┐                     ┌──────┴──────┐
                 │  browser A  │◄═══ DataChannel ═══►│  browser B  │
                 │ rules + own │   moves, answers,   │ rules + own │
                 │ secret state│   shared random     │ secret state│
                 └─────────────┘                     └─────────────┘
```

## Layers

| Layer | Files | Knows about games? |
|---|---|---|
| Server | `server/app.js` (HTTP routes, static files, security headers), `server/signaling.js` (rooms + relay), `server/server.js` (entry) | Only slugs and `maxPlayers` from `public/games.json` |
| Engine (browser) | `public/engine/` | No |
| Game | `public/<slug>/` | Yes, only its own |

### Server

The HTTP routes are listed in the diagram. Static files come from `public/`.
Dotfiles, path traversal, directory paths and `*.test.js` return 404. A bare
`/<slug>` gets a 301 to `/<slug>/` (the query string is kept) so the game's
relative imports resolve.

Every page response carries `Content-Security-Policy`, `X-Content-Type-Options`
and `Referrer-Policy` headers. Scripts can only load from the site itself.

The server sticks to the APIs the reference proved on EdgeJS, which is not
upstream Node: `node:http`, the `upgrade` event, `fs.readFile` and `ws`.

**Signaling protocol** (JSON over `/ws`, game-agnostic):

| Client → server | Server → client |
|---|---|
| (on connect) | `hello {id}` |
| `create {game, name}` | `created {game, room, id}` |
| `join {game, room, name}` | `joined {game, room, id, host, peers}`, and `peer {id, name}` to the others |
| `signal {to, data}` | `signal {from, data}` to `to`. `data` is opaque SDP or ICE. |
| `leave` | `left`. Then `leave {id}` to the others, or `host-left` and the room closes. |
| `ping` (every 25 s) | `pong` |
| | `error {code}`: `bad_json`, `bad_game`, `no_such_room`, `room_full`, `not_in_room`, `no_such_peer`, `unknown_type`, `server_full` |

- Rooms are keyed `slug/CODE`. A Sea Battle code can't join a Tic Tac Toe room.
- Codes are 4 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
- Room size comes from the registry (`maxPlayers`, 2 to 8).
- Names are cleaned and capped at 20 characters. Messages are capped at 64 KB.
- A socket that has not pinged for 75 s is dropped.

### Engine (`public/engine/`)

| Module | Job |
|---|---|
| `shell.js` | Header with light/dark and sound toggles, nickname in `localStorage`, toasts, a tab-title alert ("Your turn"), `el()` DOM helper |
| `theme.css` | Design tokens for light and dark, buttons, cards, lobby, home grid |
| `signaling.js` | `RoomClient`: create, join, signal, leave. It uses the global `WebSocket`, so it also runs in Node 22 for the integration test. |
| `peer.js` | `PeerChannel`: one ordered, reliable DataChannel; buffers early ICE candidates; detects ICE failure, a 20 s timeout and a 10 s disconnect grace |
| `channel.js` | `Emitter` and `localPair()`, an in-memory channel with the same interface as `PeerChannel` (used for the robot and the tests) |
| `session.js` | `Session`: names exchange (`$hello` with a protocol version), buffering of game messages, rematch votes (`$rematch`), goodbye (`$bye`). No DOM. |
| `session.js` → `matchRouter()` | Routes game messages to the current match by match number `m`, and holds messages for a rematch that hasn't started yet |
| `turn-match.js` | `TurnMatch` and `startTurnRobot()`: a generic protocol for open-information turn games. Agreed coin toss for who starts, both peers validate every move with the same rules, and luck moves (dice) use `SharedRandom`. This is the default for future games; Sea Battle needs hidden information, so it has its own `match.js`. |
| `lobby.js` | `startGameShell()`: the "Play with a friend" / "Play vs robot" / join-by-code UI, invite link with copy and share, `?room=CODE` auto-join, connection-failure and peer-left screens |
| `fair.js` | `commit` and `verifyCommit` (SHA-256 commitments), `HashChain` and `SharedRandom` (random draws both peers agree on) |
| `sound.js` | Synthesized sound effects (WebAudio, no audio files) behind a per-device mute toggle in the header |
| `rng.js` | Seeded PRNG (sfc32) and sampling helpers, so shared random draws give the same results on both peers |

**Session flow.**

1. Host: `create` → `showWaiting` (code and invite link).
2. Friend opens `/<slug>/?room=CODE` → `join`.
3. The host starts the WebRTC offer, the guest answers, and ICE goes through `signal`.
4. The DataChannel opens and both sides send `$hello` → `Session`.
5. The lobby closes the signaling socket. This frees the room and keeps instance load near zero.
6. The engine calls `onSession(session, root)` and the game takes over.

In robot mode the engine builds a `localPair()`. It runs the same `$hello`
on both ends and hands the second `Session` to the game's `createRobot()`.
**The robot is just another peer**, so robot games use exactly the same
protocol and rules code as friend games.

Engine messages start with `$`. Everything else belongs to the game. The
game receives messages through `session.onMessage()`, which buffers until a
handler is attached.

### Game (`public/<slug>/`)

| File | Job |
|---|---|
| `index.html` | Page with `#lobby` and `#game` sections and the rules |
| `main.js` | `startGameShell({ slug, title, tagline, createRobot, onSession })` and the view |
| `rules.js` | Pure rules: no DOM, timers, network or `Math.random`. Randomness is passed in. |
| `match.js` | Only for games with hidden information: one player's protocol state machine. Other games use `engine/turn-match.js`. |
| `robot.js` | Move choice (`chooseMove`). TurnMatch games hand it to the engine's `startTurnRobot()`; custom-protocol games (Sea Battle) also export `startRobot(session)`. |
| `*.test.js` | `node --test` unit tests, next to the code |
| `icon.svg` | Card art for the home page (16:10) |

## Sea Battle in depth

### Rules

- **Board and fleet:** 10×10, fleet of 5, 4, 3, 3 and 2.
- **Placement:** ships are placed at random; you can shuffle, drag and tap to rotate. Ships may not touch side by side; diagonal contact is allowed.
- **Turns:** a hit lets you fire again; a miss passes the turn.
- **Sinking:** a sunk ship is revealed, and the squares beside it are marked as clear water.
- **Gifts:** after every 6 moves (one fire action is one move), a mystery gift ("?") appears on an unexplored square of each board, at most 2 waiting per board. Shooting a gift's square gives it to the shooter; the weapon inside is shown only then. Each player sees only the gifts on the board they fire at, never the opponent's gifts or pickups. A gift whose square becomes cleared water after a sinking disappears.
- **Turn clock (friend games):** 40 s per shot, like papergames' per-turn clock. When it runs out, that player's own browser fires a random shot. Each browser runs the clock locally, so it is a courtesy against stalling, not an enforced rule.

**Weapons:**

| Weapon | Effect |
|---|---|
| Shot | 1 square, unlimited |
| Simple missile | 1 square; a bonus shot, so the turn continues even on a miss |
| Big missile | 5-square plus shape |
| Missile rain | 7 random unexplored squares |
| Nuclear missile | 14 squares: a 4×4 block with two opposite corners spared |

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

**What this does not stop.** A peer can stall or leave, which looks like a
disconnect. A modified client can also lie in real time; that lie is caught at
the reveal, not prevented. This is the right trade-off for games between
friends with no server-side referee.

### Match protocol (DataChannel, every message carries `m` = match number)

| Message | From | Meaning |
|---|---|---|
| `ready {commit, chain}` | each | Fleet commitment and `SharedRandom` chain tip |
| `draw {k, v}` | each | Reveal for shared draw *k*. Handled outside the step queue, because a queued step may be waiting for it. |
| `fire {w, at}` | shooter | Weapon and aimed square (rain has no `at`) |
| `result {hits, sunk}` | defender | 0 or 1 per fired square, plus newly sunk ships |
| `reveal {fleet, salt}` | each | After the game ends |
| `abort {reason}` | either | A protocol violation was detected |

Each side processes its own actions and incoming messages through one
promise queue. Both peers therefore take the same steps in the same order:
apply the shot, check gift timing, draw. The draw counter stays in step.

The `m` field and `matchRouter()` keep a rematch from mixing with the
previous match.

### Robot (`robot.js`)

The robot builds a probability-density map: every placement of every ship
still afloat that fits what is known (misses, cleared water, sunk ships, and
the no-side-contact rule).

- **Target mode** (an unsunk hit exists): only placements covering the hits count, weighted by hits³, so it follows a line once it has two hits.
- **Hunt mode:** it shoots on a parity lattice of the smallest ship left, prefers gift squares, and aims splash weapons where they cover the most density.

It averages about 40 shots to sink a fleet, against about 89 for random fire
(300 fleets, plain shots only; `robot.test.js` checks it stays under 55). It plays through `startRobot(session)`, the same
`SeaBattleMatch` that a human uses.

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
| Lobby socket kept open for late joiners | Socket closed once the DataChannel is up | Two-player rooms are complete at that point; it frees the room and the instance |
| Ad-hoc test scripts | `node --test` unit and integration tests, plus a Playwright test that skips when Playwright is missing | One command, runs in CI or locally |

Kept from the reference: Node with `ws` on EdgeJS, detected from
`package.json`; a game-agnostic signaling server; public STUN and no TURN;
ordered, reliable DataChannels; `/healthz` with `Access-Control-Allow-Origin: *`;
the `?room=CODE` invite contract; and pinning one region.

## Platform constraints

- **No TURN server.** Edge has no UDP, so relays can't run there. Some network pairs (symmetric NAT, strict firewalls, some mobile carriers or VPNs) can't connect. The lobby detects ICE failure or a timeout and explains this, offering a retry and the robot. A TURN service hosted elsewhere could be added to `ICE_SERVERS` in `engine/peer.js`.
- **Rooms live in one instance's memory.** Edge may run several instances, so `app.yaml` pins a single region. If joins ever miss rooms, move rooms to Wasmer's managed Postgres.
- **Instances are ephemeral.** Once players are connected nothing depends on the server, so an instance going away never ends a game.
- **No build step.** Plain ES modules are served as-is, and `node --test` imports the same files the browser runs.
