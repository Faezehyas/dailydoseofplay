# Daily Dose of Play

Free, no-login classic games for two, in the browser. Send a link to a friend
or play the robot. The gameplay and flow follow papergames.io; names, art,
text and code are original.

**Games:**

- Sea Battle: Battleship rules, with gifts and special weapons.
- Tic Tac Toe: 3×3 with three in a row, or 5×5 with four in a row; optional move and game clocks.
- Gomoku: five in a row on a 15×15 board; optional move and game clocks.
- Chess: standard rules with castling, en passant and promotion; optional clocks; a robot with three levels.

More are coming, one at a time; see [GAMES.md](GAMES.md).

- **Live:** https://dailydoseofplay.wasmer.app (after the one-time setup below)
- **How it works:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Adding a game:** [CONTRIBUTING.md](CONTRIBUTING.md)

## Run locally

Requires Node 22 or newer.

```bash
npm install
npm start                 # http://localhost:8080  (PORT=3000 npm start to change)
```

- Home: http://localhost:8080/
- Sea Battle: http://localhost:8080/sea-battle/
- Tic Tac Toe: http://localhost:8080/tic-tac-toe/
- Gomoku: http://localhost:8080/gomoku/
- Chess: http://localhost:8080/chess/
- Shortcuts: `/<game>/?robot=1` starts a robot game; `/<game>/?room=CODE` joins a room.
- Health: http://localhost:8080/healthz

To play a friend match on one machine, open the game in two windows (one
private), click **Play with a friend** in one, and open the invite link in
the other. Two devices on the same Wi-Fi work too: open
`http://<your-computer's-LAN-IP>:8080`.

## Tests

```bash
npm test                  # unit (rules, robot, fair play, protocol) + server/signaling integration
npm run test:browser      # headless Chromium: friend matches with rematch, robot games, failure screen
```

The browser test needs Playwright (`npm i -g playwright && npx playwright
install chromium`). It skips itself when Playwright is not found. Screenshots
go to `test-artifacts/`.

## Layout

```
server/            Node server: static files, /ws signaling, /healthz
public/
  index.html       home page (cards from games.json)
  games.json       game registry
  engine/          shared browser engine: lobby, signaling client, WebRTC, sessions, fair play, UI shell
  sea-battle/      Sea Battle: rules, protocol, robot, view, tests
  tic-tac-toe/     Tic Tac Toe: rules, robot, view, tests (TurnMatch protocol)
  gomoku/          Gomoku: rules, robot, view, tests (TurnMatch protocol)
  chess/           Chess: rules, robot, view, tests (TurnMatch protocol)
test/              integration and browser tests
app.yaml           Wasmer Edge app config (name dailydoseofplay, owner faezeh_yass)
```

## Deploy on Wasmer Edge (one-time setup)

Deploys run through Wasmer's GitHub integration: every push to `main`
deploys. The repo holds no tokens or secrets, and nothing needs to be
configured besides the steps below. Wasmer's dashboard labels may change
slightly over time; the flow is the same.

1. **Merge the PR into `main`.**
2. **Sign in** at https://wasmer.io with the account that owns the `faezeh_yass` namespace.
3. **Create the app from the repository.**
   - In the dashboard choose **Deploy / Import from GitHub** (https://wasmer.io/new).
   - When asked, install or authorize the **Wasmer GitHub app** for the `Faezehyas` account. Granting access to just `dailydoseofplay` is enough.
   - Pick `Faezehyas/dailydoseofplay` and set the production branch to **`main`**.
   - Leave build settings empty. Wasmer reads `app.yaml` (name `dailydoseofplay`, owner `faezeh_yass`, region `fr-roub1`, a `/healthz` health check) and detects Node from `package.json` (`npm start`).
   - Click **Deploy**.

   If the dashboard only offers to connect Git to an **existing** app: deploy once from a checkout of `main`: install the CLI (`curl https://get.wasmer.io -sSfL | sh`, see https://docs.wasmer.io/install), run `wasmer login`, then `wasmer deploy --build-remote --non-interactive`. Then open the app in the dashboard → **Settings → Git** → choose **GitHub** → select `Faezehyas/dailydoseofplay` and branch `main` → **Save**. If the CLI writes `app_id` and `annotations:` into `app.yaml`, commit that change.
4. **Check the first build.** The log should show `Packaging project directory (N files…)` with N in the dozens (if N is 1 or 2 the upload was empty) and `Detected Node.js provider`. Then open https://dailydoseofplay.wasmer.app/healthz, which should return `{"ok":true,…}`.
5. **Alias `dailydoseofplay.wasmer.app`.** Every Wasmer app gets `<app-name>.wasmer.app`, and the app name is `dailydoseofplay`, so this URL is assigned automatically if no one else holds it. Check the URL shown on the app's dashboard page.
   - If it shows a suffixed URL (e.g. `dailydoseofplay-faezeh_yass.wasmer.app`), open the app → **Settings → Domains**, type `dailydoseofplay.wasmer.app`, click **Add** and follow the prompt.
   - If Wasmer refuses it, another account owns that alias. Keep the suffixed URL or add a custom domain on the same page.
6. **Smoke-test production.** Open the site in two browsers, play a friend match via the invite link, and play a robot game.

From then on, merging a PR into `main` deploys it. To roll back, pick an
earlier version on the app's **Versions** page.

## Known limitations

- **No relay (TURN) server.** Wasmer Edge has no UDP, so some network pairs can't connect directly (strict NAT, some mobile carriers or VPNs). The game says so and offers a retry or the robot.
- **Rooms live in server memory.** The app is pinned to one region to keep rooms on one set of instances. A friend's join could still in theory land on a different instance.
- **Fair play is checked after the game, not refereed live.** A modified client could lie during play; the lie is detected at the end, and stalling or leaving is not prevented.
