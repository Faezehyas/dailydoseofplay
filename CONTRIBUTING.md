# Contributing: how to work in this repo and add a game

Daily Dose of Play is a free, no-login site of browser games for two or more players,
inspired by papergames.io's gameplay. It is one Node server on Wasmer Edge
(pages, `/ws` signaling, `/healthz`). Gameplay runs browser to browser over
WebRTC. Read `ARCHITECTURE.md` once before your first change.

## Ground rules

- **Language:** plain JavaScript only. Node ES modules on the server; browser JS, HTML and CSS in `public/`. No TypeScript, no frameworks, no build step, no bundler.
- **Dependencies:** `ws` is the only npm dependency. Do not add more. The card deck's cryptography, the mental-poker library, is a pinned git submodule built to WebAssembly and committed (see **Card games** in `ARCHITECTURE.md`); games don't need anything else.
- **Originality:** use original names, art, text and sounds. Copy papergames' rules and flow only, never their logo, art, sounds or wording.
- **License:** contributions are accepted under the repo's [MIT License](LICENSE). A third-party asset needs a license compatible with it, credited in the game's folder the way each `sounds/LICENSE.txt` credits its recordings.
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
anybuild plan .                       # Anybuild: show the detected build (see README)
anybuild . --start                    # build and serve on PORT (default 8080)
anybuild . --start --runner=wasmer    # the same inside Wasmer's runtime; needs the Wasmer CLI
```

Only to change the card deck's WebAssembly (Rust, `wasm-pack` and
`wasm-opt` at the versions the script names):

```bash
git submodule update --init
scripts/build-mental-poker.sh          # rebuild public/engine/vendor/mental-poker/
scripts/build-mental-poker.sh --check  # what CI runs: fail if it differs from the committed files
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

- **Hidden cards?** (hands, a draw pile) → use `public/engine/card-match.js`. Nobody deals and nobody can see another hand; see **Card games** in `ARCHITECTURE.md`.
- **Other hidden information?** (a fleet set up at the start) → follow `public/sea-battle/match.js` (commitments and reveal-and-audit).
- **No hidden information?** (all board games in the backlog) → use `public/engine/turn-match.js`. Randomness such as dice goes through `rules.needsRandom()`, so it is drawn jointly by all peers.

### 2. Create the folder

```
public/<slug>/
├── index.html       page shell: copy public/sea-battle/index.html, change title, meta and rules text
├── style.css        game-specific styles; only var(--…) tokens from /engine/theme.css, light and dark
├── main.js          startGameShell(...) and the view
├── rules.js         pure rules
├── robot.js         move choice (+ startRobot when not using startTurnRobot)
├── settings.js      optional: the game's settings, shown in the lobby card (step 5)
├── sounds.js        optional: the game's sounds, played through the engine (step 5b)
├── icon.svg         original 16:10 card art (viewBox 0 0 320 200), no external refs
├── preview.svg      optional: the home tile's animated preview (step 5c)
├── rules.test.js    rules unit tests
├── robot.test.js    robot unit tests (+ a full robot-vs-robot game)
└── match.test.js    protocol test: two peers play a full game (optional file; may live in robot.test.js)
```

Keep `index.html`'s `<section id="lobby">` and `<section id="game" hidden>`;
the engine renders into them. Keep them in its `<main>` too: the header's
"Skip to content" link jumps there. Don't make `#lobby` a live region: the
lobby moves focus to each new screen and reads out its own progress. Shared
styles (`.card`, `.btn`, `.btn.small`, `.rules` for the "How to play" panel,
`.rematch-status`, `.overlay`, `.spinner`, `.sr-only`) live in
`/engine/theme.css`. `style.css` holds only what is specific to your game.

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

For a card game (`CardMatch`), the rules object also has `deckSize`, and
`newState(first, players, deck)` and `applyMove(state, player, move, deck)`
get the deck: `deck.deal()`, `deck.open()`, `deck.shuffle()`, `deck.face()`
and `deck.owner()`, plus, in `newState`, `deck.cards` (the shuffled deck's
slots). A move that plays a card from a hand names it in `reveals(state,
player, move)`; `settle(state, deck)` runs after cards are dealt. The contract
is at the top of `engine/card-match.js`, and `test/fixtures/toy-cards.js` is a
small game that uses all of it. The one rule to keep: the state must never
depend on a face that may be hidden (`deck.face()` is null for it). A rule
that needs a hidden card throws only when the face is known, which happens in
the audit at the end.

### 4. Write `robot.js`

- Export `chooseMove(state, me, rng)`. It returns a legal move (a card game's also gets `face`, below).
- Make it decent rather than perfect: win if it can, block an immediate loss, then use a heuristic or a shallow search. It must answer in well under 100 ms.
- Wire it up: `createRobot: (session) => startTurnRobot(session, { rules, choose: chooseMove, delay: 600 })`.
- For a card game, `chooseMove(state, me, rng, face)` gets `face(slot)`, the faces the robot may know, and you wire it up with `startCardRobot()` from `engine/card-match.js`. A robot only sees its own seat's cards.

### 5. Write `main.js`

```js
import { startGameShell } from "../engine/lobby.js";
import { matchRouter } from "../engine/session.js";
import { TurnMatch, startTurnRobot } from "../engine/turn-match.js";
import { el, toast } from "../engine/shell.js";
import { playerBar } from "../engine/players.js";
import { resultPanel } from "../engine/result.js";
import { celebrate } from "../engine/celebrate.js";
import { rules } from "./rules.js";
import { chooseMove } from "./robot.js";

startGameShell({
  slug: "<slug>",
  title: "<Name>",
  layout: "narrow", // the page column while playing: "narrow", "medium" or "wide"
  createRobot: (session) => startTurnRobot(session, { rules, choose: chooseMove, delay: 600 }),
  onSession(session, root, shell) {
    const router = matchRouter(session);
    const score = { wins: [0, 0], draws: 0 }; // leave out draws if the game has none
    const bar = playerBar(session, { onLeave: () => shell.leave() });
    const board = el("div", { class: "<slug>-board" });
    const result = resultPanel(session, {
      onLeave: () => shell.leave(),
      // The result moment: the winning pieces in the order they light up, and what a loss dims.
      onShow: ({ outcome }) => outcome && celebrate({ outcome, flavour: "wood", highlight: [], board }),
    });
    root.append(bar.node, board, result.node);
    let match;
    let m = 0;
    function newMatch() {
      match = new TurnMatch({ send: (msg) => session.send(msg), me: session.index, rules, m: ++m });
      window.ddp.match = match; // browser tests read this
      match.on("update", render);
      match.on("invalid", (reason) => toast(reason));
      match.on("over", ({ winner }) => (winner === 2 ? score.draws++ : score.wins[winner]++));
      router.start(match);
      render();
    }
    function render() {
      // match.state is null until the coin toss ends (match.phase === "playing").
      bar.update({ turn: match.phase === "playing" ? match.state.turn : -1, score });
      // While a friend match is on, Leave asks before ending it for everyone.
      shell.setInProgress(match.phase !== "over" && match.phase !== "aborted");
      // Draw match.state; on input call match.play(move) when match.canMove().
      if (match.phase === "over") result.show({ winner: match.state.winner === 2 ? -1 : match.state.winner, reason: "…" });
      else if (match.phase === "aborted") result.show({ stopped: true, reason: match.abortReason });
      else result.hide();
    }
    const offs = [session.on("rematch-start", newMatch)];
    newMatch();
    return { destroy: () => offs.forEach((off) => off()) };
  },
});
```

**Card games.** Use `CardMatch` from `../engine/card-match.js` the same way
(`new CardMatch({ send, me, players, rules, m })`). While `match.busy` is set
("keys", "shuffling", "dealing" or "auditing") the deck is working, so show
it. `match.face(slot)` is a card's face if you may see it, else `null`. After
"over", a "verified" event brings `match.verdict`: show "Fair play verified"
or what didn't add up, as Sea Battle does. If the session ends while
`match.busy` is "auditing", say the game couldn't be verified. A rematch can
start before the verdict arrives, so keep listening to the old match for it.
An "abort" carries `{ reason, seat, about }`: put the name of `seat` (who
broke the rules or stopped the match) before the reason, and when `about` is
set, the reason is about that player ("Ana stopped the match: Bob sent a
shuffle that doesn't check out").

**Settings (optional).** Clocks, board size, who goes first or a robot level
go in `settings.js`, built with the engine's `gameSettings()`, and are passed
to `startGameShell()`. The lobby shows them inside its card and their summary
on the host's waiting screen; don't add a settings card of your own.

```js
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

export const settings = gameSettings({
  key: "ddp-<slug>-settings", // localStorage; never rename it, or players lose their choice
  prefix: "<prefix>", // radio names: <prefix>-<group>; the panel is #<prefix>-settings
  normalize: normalizeConfig, // raw (or null) -> a complete, valid config
  hint: "In a friend game, the settings of whoever creates the room apply to both players.",
  groups: [
    // summary(value, label, config): the text of this group's chip in the summary ("" leaves it out).
    { name: "moveSeconds", legend: "Time per move", options: [[10, "10 s"], [0, "No limit"]], summary: (v, l) => (v ? `${l} a move` : "No move limit") },
    // robot: true tags the group "vs robot only", gives its chip a teal dot and keeps it off the waiting screen.
    { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
  ],
});
```

Pass `settings` to `startGameShell()` and read `settings.get()` when a game
starts: the host sends it to its guests as `setup {config}` (see **Room
settings** under Tic Tac Toe in `ARCHITECTURE.md`), and a robot game uses it
directly.

**More than two players.** Pass `minPlayers` and `maxPlayers` to
`startGameShell()` (and `robots`, the robot seats in a robot game: a number,
or a function such as `() => settings.get().robots`). The host
gets a player list and a Start button. In `onSession`, use `session.players`
(`{seat, name}`), `session.index` (your seat) and `session.others`, pass
`players: session.players.length` to `TurnMatch`, and write rules whose turn
moves to the next seat. `newState(first, players)` receives the player count.
Don't use `winner: 2` for a draw there, since 2 is a seat.

The view must provide:

- The player bar from `engine/players.js` (see **Player bar** in `ARCHITECTURE.md`), first in the view: names, whose turn it is, the score and **Leave**. Don't build your own. Pass `badges` (a node per seat: a mark, disc or colour) and `notes` (a short line per seat, such as pips) to `update()` if the game has them, and `classes` to `playerBar()` if seats have colours of their own.
- A clear status line.
- On game over, the result panel from `engine/result.js` (see **Result panel** in `ARCHITECTURE.md`): call `show({ winner, stopped, reason, places, extra })` when the match ends and `hide()` while it is on. Don't build your own result box or Rematch button: the panel shows who won, a reason line, **Rematch** with everyone's votes, and Leave. Pass `places` (`[{ seat, note }]` in finishing order) if the game plays on for places, and `extra` for a node of your own (Sea Battle's fair-play verdict).
- The result moment (see **Result moment** in `ARCHITECTURE.md`): from the panel's `onShow`, call `celebrate()` from `engine/celebrate.js` with the `outcome` it passes (`null` for a stopped match: play nothing), your game's `flavour` (`wood`, `paper`, `plastic`, `bell` or `water`, whichever its pieces sound like), `highlight` (the nodes that won the game, in the order they light up: a line, a king, the last piece home) and `board` (the node a loss dims). Don't add win or lose sounds of your own.
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

Use the shared type and motion instead of your own (see **Type and motion**
in `ARCHITECTURE.md`): no fonts of your own; headings already get the display
font; give timers and counts the `mono` class; use `.chip` for a seat
or a fact; time transitions with `var(--dur-fast)`, `var(--dur-med)` or
`var(--dur-slow)` and ease them with `var(--ease-out)` or `var(--ease-spring)`.
Animate only `transform` and `opacity`, start motion only on a player's action,
and check it stops with reduced motion on.

### 5b. Sounds (optional)

Sounds live in `sounds.js` and play through `engine/sound.js`, so every game
shares one output and one loudness scale. Never open an `AudioContext` or
import the engine's sound modules from `main.js`; `test/sound.test.js` fails
if you do.

```js
import { defineSounds } from "../engine/sound.js";
import { tone, noise } from "../engine/synth.js";

const rec = (...names) => names.map((n) => new URL(`./sounds/${n}.mp3`, import.meta.url).href);

export const sounds = defineSounds({
  // A recording: levelled to its role as it loads. Credit it in sounds/LICENSE.txt.
  move: { role: "action", samples: rec("move-1", "move-2") },
  // Synthesized: (audio context, output, start time, opts). `trim` brings it to its role.
  turn: { role: "ui", trim: 0, synth: (a, o, t) => tone(a, o, t, { freq: 880, dur: 0.15, gain: 0.08 }) },
});
export const play = sounds.play; // play("move"), play("turn", {}, 0.2) for 0.2 s from now
```

Give each sound the role that matches its job: `cue`, `ui`, `action`,
`highlight` or `fanfare` (see **Sound levels** in `ARCHITECTURE.md`). Then run
`node --test test/browser/sound-levels.test.js`: it measures every sound and,
for a synthesized one that is off, prints the `trim` to set.

### 5c. Preview (optional)

`preview.svg` is a 3–5 second animation of a few moves that the home tile loops
on hover (see **Tile previews** in `ARCHITECTURE.md`; `public/tic-tac-toe/preview.svg`
is the shortest to copy). Without one the tile keeps its icon.

- Root: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" class="tile-preview pv-<short name>">`, under 10 KB, no scripts, images or external refs.
- Colours only from tokens, in the file's `<style>`; start every selector with your `.pv-…` class, and keyframes and ids with your game's name, since the style applies to the whole home page.
- Players: the seat classes `.a` to `.d` set `currentColor`. Draw the player tags top right and light them in turn with `.lit` (`--d` start, `--l` length; `.stay` for the last).
- Moves: give a piece `.pop`, `.fade`, `.gone`, `.draw`, `.slide` (from `--x`, `--y`) or `.fall` (from `--y`) and its start time `--d`, or your own keyframes. Animate only transform and opacity, and put a moving piece in a `<g transform="…">` rather than giving it a `transform` of its own.
- Check it: hover the tile in light and dark, and run `npm test` (it checks the file) and `node --test test/browser/home-previews.test.js` (it checks the length).

### 6. Register it

In `public/games.json`, set the game's entry to `"status": "ready"` (add an
entry if the game isn't listed, and copy one more placeholder tile into
`public/index.html`'s `#games` list so the home page doesn't jump as it
loads). Fields: `slug`, `name`, `status`, `players`,
`maxPlayers` (2, or the same `maxPlayers` you pass to `startGameShell()` for a game with more players), and a one-sentence original `description`. The home tile and
the lobby both show it. The server reads `games.json` once at startup, so
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
- **Protocol** (in `match.test.js` or `robot.test.js`): pair two `TurnMatch`es over `localPair()` + `openSession()` + `matchRouter()` (see `public/engine/turn-match.test.js`), play a full game, and assert both states are equal. For more than two players, seat them with `localRoom()` from `engine/room.js` and pass `players` to each `TurnMatch` (see the three-player test in `turn-match.test.js`). For a card game, run `startCardRobot()` in every seat of a `localRoom()` and also assert every `match.verdict` is `{ ok: true }` (see `public/engine/card-match.test.js`).
- **Sounds:** nothing to add. `test/browser/sound-levels.test.js` finds every `sounds.js` and checks each sound's loudness.
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
- [ ] No hidden information leaks over the wire. Hidden cards go through `CardMatch`; other hidden information uses commitments like Sea Battle.
- [ ] All randomness comes from `SharedRandom`, through `TurnMatch` or a custom match
- [ ] `layout` passed to `startGameShell()`, and the view's top-level box has no `max-width`
- [ ] Names, turn, score and Leave come from `playerBar()`, not a bar of the game's own
- [ ] The result, Rematch and Leave at game over come from `resultPanel()`, not a box of the game's own
- [ ] The panel's `onShow` plays `celebrate()` with the game's `flavour`, its winning pieces and its board; no win or lose sounds of its own
- [ ] 360 px wide with no horizontal scroll, also with two 20-letter names; light and dark; touch and keyboard
- [ ] Coral or teal text uses `--accent-text` or `--accent-2-text`; controls are outlined in `--control-border`
- [ ] No fonts or timings of its own: timers carry `mono`, transitions use the `--dur-*` and `--ease-*` tokens
- [ ] Each player has the same colour on every screen (see **Player colours** in `ARCHITECTURE.md`): style `.mine` and `.theirs` with `--mine` and `--theirs`, and set `data-you` on the game's root
- [ ] A new `localStorage` key (such as the settings panel's `key`) is listed on `public/privacy/index.html`
- [ ] Sounds, if any, are in `sounds.js` with a role each, and `test/browser/sound-levels.test.js` passes
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
| `public/engine/card-match.js` | `CardMatch` and `startCardRobot()` for turn games with hidden cards; the deck runs in `deck-service.js` / `deck-worker.js` / `deck-crypto.js` |
| `vendor/`, `scripts/build-mental-poker.sh` | The mental-poker library (submodule), our patches and lock file, and the script that builds it into `public/engine/vendor/mental-poker/` |
| `public/engine/robot-pace.js` | `robotPause()`: robots' pauses, which browser tests shorten |
| `public/engine/fair.js` | Commitments and `SharedRandom` |
| `public/engine/shell.js` | Header, footer, theme toggle, nickname, `el()`, `toast()` |
| `public/engine/settings.js` | `gameSettings()`: a game's settings, shown in the lobby card |
| `public/engine/players.js` | `playerBar()`: names, whose turn it is, the score and Leave, above every game |
| `public/engine/result.js` | `resultPanel()`: the game-over panel with the result, Rematch and Leave, in every game |
| `public/engine/celebrate.js` | `celebrate()`: the win, loss and draw moment as the result panel opens, with its chimes from `chimes.js` |
| `public/engine/confirm.js` | `confirmDialog()`: a yes-or-no question in a modal dialog, such as "Leave the game?" |
| `public/engine/theme.css` | Design tokens (light and dark), fonts, motion and shared components |
| `public/sea-battle/` | The reference game, with hidden information and a custom protocol |
| `public/games.json` | Game registry, read by the home page and the server |
| `test/` | Server and signaling integration tests, plus the browser tests |
