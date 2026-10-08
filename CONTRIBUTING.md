# Contributing: how to work in this repo and add a game

Daily Dose of Play is a free, no-login site of browser games for two or more players,
inspired by papergames.io's gameplay. It is one Node server on Wasmer Edge
(pages, `/ws` signaling, `/healthz`). Gameplay runs browser to browser over
WebRTC. Read `ARCHITECTURE.md` once before your first change.

## Ground rules

- **Language:** plain JavaScript only. Node ES modules on the server; browser JS, HTML and CSS in `public/`. No TypeScript, no frameworks, no build step, no bundler.
- **Dependencies:** `ws` is the only one. Do not add more.
- **Originality:** use original names, art, text and sounds. Copy papergames' rules and flow only, never their logo, art, sounds or wording.
- **No accounts:** no logins, tournaments, leaderboards, ads, analytics or random matchmaking. The nickname stays in `localStorage`.
- **No secrets:** no tokens or keys in the repo. Deploys happen through Wasmer's GitHub integration on every push to `main`.
- **Server:** a new game must not need changes under `server/`. If it seems to, stop and explain why in the PR.
- **Comments:** one short line, and only for the non-obvious. Rationale goes in `ARCHITECTURE.md`.
- **Commits:** follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): description`, e.g. `feat(tic-tac-toe): add rules and robot`, `fix(engine): …`, `docs: …`, `test: …`, `chore: …`. Mark breaking changes with `!` or a `BREAKING CHANGE:` footer.

## Commands

```bash
npm install
npm start               # http://localhost:8080 (PORT to change)
npm test                # unit + integration tests (node --test)
npm run test:browser    # Playwright: full friend match, robot game, failure screen
```

`npm run test:browser` skips itself when Playwright is missing. If it is
installed globally, the test finds it through `npm root -g`, or set
`PLAYWRIGHT_MODULE=/path/to/playwright/index.js`. Screenshots go to
`test-artifacts/`, which git ignores.

## Recipe: add a game

The goal is **one folder plus one registry entry**. Work through the steps in
order. `<slug>` is lowercase with dashes, e.g. `tic-tac-toe`. Use the slug that
already exists in `public/games.json`.

### 1. Pick the game

Take the first unchecked game in `GAMES.md`. Write down its papergames rules:
board, turn order, win and draw conditions, and any special rules. Decide two
things, because they choose your protocol:

- **Hidden information?** (cards, hidden ships) → follow `public/sea-battle/match.js` (commitments and reveal-and-audit).
- **No hidden information?** (all board games in the backlog) → use `public/engine/turn-match.js`. Randomness such as dice goes through `rules.needsRandom()`, so it is drawn jointly by all peers.

### 2. Create the folder

```
public/<slug>/
├── index.html       page shell: copy public/sea-battle/index.html, change title, meta and rules text
├── style.css        game-specific styles; only var(--…) tokens from /engine/theme.css, light and dark
├── main.js          startGameShell(...) and the view
├── rules.js         pure rules
├── robot.js         move choice (+ startRobot when not using startTurnRobot)
├── icon.svg         original 16:10 card art (viewBox 0 0 320 200), no external refs
├── rules.test.js    rules unit tests
├── robot.test.js    robot unit tests (+ a full robot-vs-robot game)
└── match.test.js    protocol test: two peers play a full game (optional file; may live in robot.test.js)
```

Keep `index.html`'s `<section id="lobby">` and `<section id="game" hidden>`;
the engine renders into them. Shared styles (`.card`, `.btn`, `.btn.small`,
`.rules` for the "How to play" panel, `.rematch-status`, `.overlay`,
`.spinner`) live in `/engine/theme.css`. `style.css` holds only what is
specific to your game.

### 3. Write `rules.js` (pure)

- No DOM, network, timers, `Date` or `Math.random`. Randomness comes in as an `rng` function.
- Import `RuleError` from `../engine/turn-match.js` and throw it for any illegal move.

For a `TurnMatch` game, export a rules object:

```js
import { RuleError } from "../engine/turn-match.js";

export const rules = {
  newState(first) {
    // turn: 0 | 1; winner: -1 playing, 0/1 winner, 2 draw
    return { turn: first, winner: -1, board: Array(9).fill(-1) };
  },
  // Validate, mutate, set turn/winner, return events for the view
  applyMove(state, player, move, rng) {
    if (state.winner !== -1) throw new RuleError("game over");
    if (state.turn !== player) throw new RuleError("not your turn");
    // ...
    return [{ type: "placed", cell: move.cell }];
  },
  // Optional: true when this move's outcome uses rng, e.g. { type: "roll" }
  needsRandom: (state, move) => false,
  // Optional: the most shared random draws one match may need (default 256:
  // the coin toss plus one per random move). Backgammon sets 1024.
  draws: 256,
};
```

Moves are small JSON objects (`{ cell: 4 }`, `{ from: 12, to: 28 }`). Both
peers call `applyMove` with the same arguments, so it must be deterministic.

### 4. Write `robot.js`

- Export `chooseMove(state, me, rng)`. It returns a legal move, and only for `TurnMatch` games.
- Make it decent rather than perfect: win if it can, block an immediate loss, then use a heuristic or a shallow search. It must answer in well under 100 ms.
- Wire it up: `createRobot: (session) => startTurnRobot(session, { rules, choose: chooseMove, delay: 600 })`.

### 5. Write `main.js`

```js
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { rules } from "./rules.js";
import { chooseMove } from "./robot.js";

startGameShell({
  slug: "<slug>",
  title: "<Name>",
  tagline: "<one original sentence>",
  layout: "narrow", // the page column while playing: "narrow", "medium" or "wide"
  createRobot: (session) => startTurnRobot(session, { rules, choose: chooseMove, delay: 600 }),
  onSession(session, root, shell) {
    const router = matchRouter(session);
    let match;
    let m = 0;
    let rematch = { me: false, them: false };
    function newMatch() {
      match = new TurnMatch({ send: (msg) => session.send(msg), me: session.index, rules, m: ++m });
      window.ddp.match = match; // browser tests read this
      match.on("update", render);
      match.on("invalid", (reason) => toast(reason));
      router.start(match);
      render();
    }
    function render() {
      // match.state is null until the coin toss ends (match.phase === "playing").
      // Draw match.state; on input call match.play(move) when match.canMove().
      // On "over"/"aborted" show the result, Rematch and Leave.
    }
    const offs = [
      session.on("rematch", (v) => { rematch = v; render(); }),
      session.on("rematch-start", () => { rematch = { me: false, them: false }; newMatch(); }),
    ];
    newMatch();
    return { destroy: () => offs.forEach((off) => off()) };
  },
});
```

**More than two players.** Pass `minPlayers` and `maxPlayers` to
`startGameShell()` (and `robots`, the robot seats in a robot game: a number,
or a function such as `() => settings.get().robots`). The host
gets a player list and a Start button. In `onSession`, use `session.players`
(`{seat, name}`), `session.index` (your seat) and `session.others`, pass
`players: session.players.length` to `TurnMatch`, and write rules whose turn
moves to the next seat. `newState(first, players)` receives the player count.
Don't use `winner: 2` for a draw there, since 2 is a seat.

The view must provide:

- Both names (`session.me.name`, `session.opponent.name`) and whose turn it is.
- A clear status line.
- A **Leave** button calling `shell.leave()`.
- On game over: a result banner, a **Rematch** button (`id="rematch"`, calling `session.requestRematch()`), "Waiting for …" / "… wants a rematch!" text (`id="rematch-status"`), and Leave.
- A draw state if the game has one.

**Width.** Pick the narrowest `layout` the game fits: `"narrow"` (520 px,
a square board with its status above), `"medium"` (640 px) or `"wide"`
(980 px, for two boards or a board with a side panel; the default). The
lobby, the game and "How to play" then share that column (see **Page
column** in `ARCHITECTURE.md`). Don't give the view's top-level box a
`max-width`; let it fill `#game`.

It must work at 360 px width with no horizontal scroll (boards sized by
`width: 100%` and `aspect-ratio`), by touch and by keyboard. A nickname can be
one 20-letter word, wider than a phone. `theme.css` breaks long words in text
lines, but only where the box can't grow: put a line with a name in a
`minmax(0, 1fr)` grid column or give it `min-width: 0`, and cut one-line labels
short with `text-overflow: ellipsis`. Colors come only
from theme tokens, so light and dark both work. Keep WCAG AA contrast (see
**Colours and contrast** in `ARCHITECTURE.md`): coral or teal text uses
`var(--accent-text)` or `var(--accent-2-text)`, never `var(--accent)` or
`var(--accent-2)`; text on a coral or teal fill uses `var(--accent-ink)`;
inputs and segmented options are outlined in `var(--control-border)`; and
fade text with a muted colour, not `opacity`. A new game-specific colour
used as text needs 4.5:1 on its background in both themes.

### 6. Register it

In `public/games.json`, set the game's entry to `"status": "ready"` (add an
entry if the game isn't listed). Fields: `slug`, `name`, `status`, `players`,
`maxPlayers` (2, or the same `maxPlayers` you pass to `startGameShell()` for a game with more players), and a one-sentence original `description`. The home page
picks it up automatically. The server reads `games.json` once at startup, so
restart `npm start` after editing it, or creating a room will fail with `bad_game`.
The browser test reads the "Coming soon" count from the registry, so it needs
no change.

### 7. Test

- **`rules.test.js`:**
  - legal moves and win, loss and draw detection;
  - illegal moves throw `RuleError` (occupied square, out of turn, after game over, malformed move);
  - one scripted full game that checks the final state;
  - any randomness checked with `rngFromSeed` from `../engine/rng.js`.
- **`robot.test.js`:**
  - it takes an immediate win;
  - it blocks an immediate loss;
  - robot vs robot over 20 seeded games always finishes with legal moves.
- **Protocol** (in `match.test.js` or `robot.test.js`): pair two `TurnMatch`es over `localPair()` + `openSession()` + `matchRouter()` (see `public/engine/turn-match.test.js`), play a full game, and assert both states are equal. For more than two players, seat them with `localRoom()` from `engine/room.js` and pass `players` to each `TurnMatch` (see the three-player test in `turn-match.test.js`).
- **Message size:** add the game to `GAMES` in `test/message-size.test.js` (its biggest board and most players). It plays a full match and fails if a message is over 4 K characters; a browser cuts off a player whose message is over 64 K (see **Message size** in `ARCHITECTURE.md`). Send moves, not whole states.
- **Browser (recommended):** add `test/browser/<slug>.test.js` modelled on `test/browser/friend-match.test.js`. Host clicks `#play-friend`, the guest opens `#invite-link`, both play through `window.ddp.match`, then a rematch.
  - Don't wait in real time. In a robot game, set `globalThis.ddpRobotPace = 0.1` with `addInitScript` so the robot answers in a tenth of its usual pause (leave it at 1 only where the test checks the robot's pace). To let a clock run out, call `page.clock.install()` before the page loads and `page.clock.fastForward()` past the limit.
  - Files run in parallel, but the tests in one file run one after another. Give a long test its own file, and share the game's helpers through `test/browser/<slug>.shared.js` (see Ludo's).

Run `npm test` and `npm run test:browser`. All tests must pass. Never skip or
weaken an existing test to get green.

### 8. Check by hand

Run `npm start` and open `http://localhost:8080/<slug>/` in two browser
windows (one private).

1. Play with a friend: create a room and check that the code and invite link show, and that copy works.
2. Open the link in the other window: it auto-joins and play starts. Typing the code instead shows the host an Accept / Decline prompt first.
3. Play a full game, then a rematch.
4. Close one tab: the other shows "left the game".
5. Play vs robot: a full game.
6. Light and dark mode, plus a phone-sized window.

### 9. Update the docs and open the PR

- In `GAMES.md`, tick the game.
- In `README.md`, add the game to the list.
- If you changed anything in `public/engine/`, update `ARCHITECTURE.md` too. Avoid engine changes unless the game cannot work without them; if you must, keep them backward compatible and run Sea Battle's tests.
- Work on a branch, e.g. `feat/<slug>`, commit with Conventional Commits, and open one PR titled `feat: add <Name>`.
- The PR body needs:
  - a summary;
  - a rules summary with any deviation from papergames;
  - the protocol choice (TurnMatch or custom) and why;
  - known limitations;
  - a manual test checklist (step 8).

## Checklist before opening the PR

- [ ] `public/<slug>/` contains `index.html`, `style.css`, `main.js`, `rules.js`, `robot.js`, `icon.svg` and tests
- [ ] `rules.js` is pure and fully unit-tested; illegal moves throw `RuleError`
- [ ] Robot plays legal, decent moves, and robot-vs-robot games always finish
- [ ] Friend match works in two windows: invite link, auto-join, full game, rematch, leave
- [ ] No hidden information leaks over the wire. If the game has any, it uses commitments like Sea Battle.
- [ ] All randomness comes from `SharedRandom`, through `TurnMatch` or a custom match
- [ ] `layout` passed to `startGameShell()`, and the view's top-level box has no `max-width`
- [ ] 360 px wide with no horizontal scroll, also with two 20-letter names; light and dark; touch and keyboard
- [ ] Coral or teal text uses `--accent-text` or `--accent-2-text`; controls are outlined in `--control-border`
- [ ] Each player has the same colour on every screen (see **Player colours** in `ARCHITECTURE.md`): style `.mine` and `.theirs` with `--mine` and `--theirs`, and set `data-you` on the game's root
- [ ] Original name, text and art; nothing copied from papergames
- [ ] `games.json` entry set to `ready`; `GAMES.md` ticked; README updated
- [ ] `npm test` passes; `npm run test:browser` passes or is reported as skipped
- [ ] No new dependencies, no build step, nothing changed under `server/`, no secrets
- [ ] Every commit message follows Conventional Commits

## Where things are

| Path | What |
|---|---|
| `server/app.js` | HTTP routes, static files, security headers, `/healthz`, `/ws` upgrade |
| `server/signaling.js` | Rooms scoped by game slug, plus the SDP/ICE relay |
| `public/engine/lobby.js` | `startGameShell()`: lobby UI, invite link, waiting room, robot mode |
| `public/engine/room.js` | Seating players: `HostRoom`, `GuestRoom` (signaling + WebRTC) and `localRoom()` (robots) |
| `public/engine/group.js` | The group transport: send to everyone, receive `(msg, fromSeat)`; today a star through the host |
| `public/engine/session.js` | `Session` (players, rematch, leave), the start handshake, and `matchRouter()` |
| `public/engine/turn-match.js` | `TurnMatch` and `startTurnRobot()` for open-information turn games |
| `public/engine/robot-pace.js` | `robotPause()`: robots' pauses, which browser tests shorten |
| `public/engine/fair.js` | Commitments and `SharedRandom` |
| `public/engine/shell.js` | Header, theme toggle, nickname, `el()`, `toast()` |
| `public/engine/theme.css` | Design tokens (light and dark) and shared components |
| `public/sea-battle/` | The reference game, with hidden information and a custom protocol |
| `public/games.json` | Game registry, read by the home page and the server |
| `test/` | Server and signaling integration tests, plus the browser tests |
