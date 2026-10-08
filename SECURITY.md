# Security

Daily Dose of Play is used by children and families, so security reports are
welcome and taken seriously.

## Reporting a vulnerability

Please report privately, never in a public issue, pull request or discussion.

1. Open the repository's **Security** tab:
   https://github.com/Faezehyas/dailydoseofplay/security
2. Click **Report a vulnerability**. This opens a private form (GitHub's
   private vulnerability reporting); only you and the maintainer can see it.
3. Describe the problem:
   - what an attacker can do, and to whom;
   - the steps or a small script to reproduce it;
   - the page, file or message type involved;
   - the browser and device, if it matters.

The maintainer replies in the same private thread. Once a fix is merged it
goes live on the next deploy, and the advisory can then be published with
credit to you, if you want it.

If the **Report a vulnerability** button is missing, open an issue that only
asks for a private contact. Leave out every detail of the problem.

## What is covered

- The live site, https://www.dailydoseofplay.com, and the code on `main`.
  Older versions are not supported.
- The server (`server/`): static files, `/ws` signaling, room codes and
  invite keys, rate limits and per-client limits.
- The browser engine and games (`public/`): WebRTC messages, fair play,
  nicknames.

Not a vulnerability on its own (see **Known limitations** in the
[README](README.md#known-limitations)):

- two players who can't connect because there is no relay (TURN) server;
- a modified client that lies during a game, which is caught when the game
  ends rather than prevented;
- a player who stalls or leaves a game.

Please don't run load tests or denial-of-service attempts against the live
site; reproduce those locally with `npm start`.

## For the maintainer: switch on private reporting

The **Report a vulnerability** button only appears once private vulnerability
reporting is on:

**Settings → Security and quality → Advanced Security → Private vulnerability
reporting → Enable.** (Older GitHub screens call this page **Code security**.)
