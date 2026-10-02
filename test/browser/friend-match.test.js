// Headless-browser test: two separate browser contexts play a full Sea Battle
// match as friends, over the real signaling server and a real WebRTC
// DataChannel (loopback ICE needs no STUN). Skips if Playwright is missing.
//
//   npm run test:browser
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.js npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";

const ARTIFACTS = path.resolve("test-artifacts");

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright"];
  try {
    candidates.push(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {}
  for (const c of candidates.filter(Boolean)) {
    try {
      return require(c);
    } catch {}
  }
  return null;
}

const pw = await loadPlaywright();

test("two friends play a full match in real browsers", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, ...opts });
    if (nickname) await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }
  const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20_000 });

  // Host creates a room and gets an invite link.
  const host = await open("host", "Ada");
  await host.goto(`${srv.base}/sea-battle/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(invite, new RegExp(`/sea-battle/\\?room=${code}$`));
  await host.screenshot({ path: `${ARTIFACTS}/1-invite.png` });

  // Friend opens the link on a phone-sized screen and lands in the game.
  const guest = await open("guest", "Bo", { viewport: { width: 390, height: 844 }, hasTouch: true });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await host.locator("#ready").waitFor();
  await guest.locator("#ready").waitFor();
  assert.match(await host.locator(".sb-players").innerText(), /Bo/);
  assert.match(await guest.locator(".sb-players").innerText(), /Ada/);
  assert.equal(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal scroll on mobile");

  // Placement: shuffle, rotate via keyboard, then ready up.
  await host.click("#shuffle");
  await guest.click("#shuffle");
  await host.locator(".own .ship").first().focus();
  await host.keyboard.press("r");
  await host.click("#ready");
  await guest.click("#ready");
  await wait(host, () => window.ddp.match.phase === "playing");
  await wait(guest, () => window.ddp.match.phase === "playing");
  assert.equal(
    await host.evaluate(() => window.ddp.match.state.turn),
    await guest.evaluate(() => window.ddp.match.state.turn),
    "both browsers agree who starts",
  );
  // Fair play: neither browser holds the other's fleet during play.
  const guestFleet = await guest.evaluate(() => JSON.stringify(window.ddp.match.fleet));
  assert.equal(await host.evaluate(() => window.ddp.match.peerFleet), undefined);
  assert.equal(await host.evaluate((f) => JSON.stringify(window.ddp.match).includes(f.slice(1, -1)), guestFleet), false);
  await guest.screenshot({ path: `${ARTIFACTS}/2-playing-mobile.png`, fullPage: true });

  // Play it out. The test peeks at each page's own fleet only to aim quickly.
  const pages = [host, guest];
  const shipSquares = await Promise.all(
    pages.map((p) => p.evaluate(() => window.ddp.match.fleet.flatMap((s) => Array.from({ length: s.len }, (_, k) => (s.vertical ? (s.r + k) * 10 + s.c : s.r * 10 + s.c + k))))),
  );
  let usedWeapon = false;
  for (let guard = 0; guard < 400; guard++) {
    const phases = await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.phase)));
    if (phases.every((ph) => ph === "over")) break;
    assert.ok(!phases.includes("aborted"), "match aborted");
    const canFire = await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.canFire())));
    const k = canFire.indexOf(true);
    if (k < 0) {
      await host.waitForTimeout(20);
      continue;
    }
    const page = pages[k];
    const view = await page.evaluate(() => {
      const m = window.ddp.match;
      return { cells: m.state.boards[1 - m.me].cells, inv: m.state.inventory[m.me] };
    });
    const targets = shipSquares[1 - k].filter((i) => view.cells[i] === 0);
    // Host plays hopelessly (water first) so the guest's answers get exercised too.
    const water = [...Array(100).keys()].filter((i) => view.cells[i] === 0 && !shipSquares[1 - k].includes(i));
    let target = k === 0 && water.length > 40 ? water[0] : targets[0] ?? water[0];
    const owned = ["big", "nuke", "missile"].find((w) => view.inv[w] > 0);
    if (owned && !usedWeapon) {
      await page.click(`.weapon[data-w="${owned}"]`);
      usedWeapon = true;
    }
    const before = await page.evaluate(() => window.ddp.match.state.moves);
    await page.click(`.enemy .cell[data-i="${target}"]`);
    await wait(page, (n) => window.ddp.match.state.moves > n || window.ddp.match.phase !== "playing", before);
  }
  await wait(host, () => window.ddp.match.verdict);
  await wait(guest, () => window.ddp.match.verdict);
  assert.match(await host.locator("#verdict").innerText(), /Fair play verified/);
  assert.match(await guest.locator("#verdict").innerText(), /Fair play verified/);
  const winner = await host.evaluate(() => window.ddp.match.state.winner);
  assert.equal(winner, 1, "the guest aimed at ships and wins");
  assert.match(await guest.locator(".sb-over h2").innerText(), /Victory/);
  // Wins carry across rematches; the latest volley on each board is ringed.
  assert.equal(await guest.locator("#score-me").innerText(), "1");
  assert.equal(await host.locator("#score-opp").innerText(), "1");
  assert.equal(await host.locator("#score-me").innerText(), "0");
  assert.ok((await guest.locator(".enemy .cell.last").count()) >= 1);
  assert.ok((await host.locator(".own .cell.last").count()) >= 1);
  assert.match(await host.locator(".sb-over h2").innerText(), /Defeat/);
  await host.screenshot({ path: `${ARTIFACTS}/3-game-over.png`, fullPage: true });

  // Rematch: host asks, guest accepts, both are back to placing for match 2.
  await host.click("#rematch");
  await guest.locator("#rematch-status").filter({ hasText: "wants a rematch" }).waitFor();
  await guest.click("#rematch");
  await wait(host, () => window.ddp.match.m === 2 && window.ddp.match.phase === "placing");
  await wait(guest, () => window.ddp.match.m === 2 && window.ddp.match.phase === "placing");
  await host.click("#ready");
  await guest.click("#ready");
  await wait(host, () => window.ddp.match.phase === "playing");

  // Leaving a live friend game asks first; dismissing keeps the game.
  let asked = "";
  host.once("dialog", (d) => {
    asked = d.message();
    d.dismiss();
  });
  await host.click("#leave");
  assert.match(asked, /Leave the game\?/);
  assert.equal(await host.evaluate(() => window.ddp.match.phase), "playing");

  // Friend closes the tab: host is told.
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#ended").innerText(), /Bo (left the game|.*lost)/);
  assert.deepEqual(errors, []);
});

test("a blocked peer connection shows the no-TURN explanation", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const host = await (await browser.newContext()).newPage();
  await host.goto(`${srv.base}/sea-battle/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const code = (await host.locator("#room-code").innerText()).trim();
  // Simulate a network that blocks direct connections: relay-only ICE with
  // no relay gathers no candidates, and ICE reports failure.
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    const Real = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Real {
      constructor(cfg) {
        super({ ...cfg, iceTransportPolicy: "relay" });
        setTimeout(() => {
          Object.defineProperty(this, "iceConnectionState", { get: () => "failed" });
          this.oniceconnectionstatechange?.();
        }, 300);
      }
    };
  });
  const guest = await ctx.newPage();
  await guest.goto(`${srv.base}/sea-battle/`);
  await guest.fill("#join-code", code.toLowerCase());
  await guest.click(".join-row button");
  await guest.locator("#connect-error").waitFor({ timeout: 10_000 }).catch(async (err) => {
    throw new Error(`${err.message}\nguest lobby: ${await guest.locator("#lobby").innerText()}`);
  });
  assert.match(await guest.locator("#connect-error").innerText(), /relay \(TURN\)/);
  assert.equal(await guest.locator("#play-robot").count(), 1, "robot is offered as a fallback");

  // The failed guest left the room; the host's invite must still work for someone else.
  await host.locator("#lobby-status").filter({ hasText: "Waiting for your friend" }).waitFor({ timeout: 10_000 });
  assert.equal((await host.locator("#room-code").innerText()).trim(), code);
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(`${srv.base}/sea-battle/?room=${code}`);
  await friend.locator("#ready").waitFor({ timeout: 20_000 });
  await host.locator("#ready").waitFor();
});

test("home page, theme toggle, drag-to-move and a robot game on a phone", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${srv.base}/`);
  await page.locator('.game-card[data-slug="sea-battle"]').waitFor();
  const { games } = await (await fetch(`${srv.base}/games.json`)).json();
  const soon = games.filter((g) => g.status === "soon");
  assert.equal(await page.locator(".game-card.soon").count(), soon.length);
  assert.equal(await page.locator("a.game-card").count(), games.length - soon.length);
  for (const g of soon) assert.match(await page.locator(`.game-card[data-slug="${g.slug}"]`).innerText(), /Coming soon/);
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click("#theme-toggle");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), before);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "theme choice persists");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

  await page.click('.game-card[data-slug="sea-battle"]');
  await page.fill("#nickname", "Cleo");
  await page.click("#play-robot");
  await page.locator("#ready").waitFor();
  assert.match(await page.locator(".sb-players").innerText(), /Cleo[\s\S]*Robot/);

  // Drag the destroyer to the first free legal spot, in its current orientation.
  const target = await page.evaluate(() => {
    const fleet = window.ddp.match.fleet;
    const k = fleet.findIndex((s) => s.len === 2);
    const me = fleet[k];
    const taken = new Set();
    fleet.forEach((s, j) => {
      if (j === k) return;
      for (let q = 0; q < s.len; q++) {
        const r = s.vertical ? s.r + q : s.r;
        const c = s.vertical ? s.c : s.c + q;
        for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) taken.add(`${r + dr},${c + dc}`);
      }
    });
    for (let r = 0; r < (me.vertical ? 9 : 10); r++) {
      for (let c = 0; c < (me.vertical ? 10 : 9); c++) {
        const second = me.vertical ? `${r + 1},${c}` : `${r},${c + 1}`;
        if (!taken.has(`${r},${c}`) && !taken.has(second) && (r !== me.r || c !== me.c)) return { k, r, c, from: { r: me.r, c: me.c } };
      }
    }
    return null;
  });
  assert.ok(target, "a free spot exists");
  const box = await page.locator(".own .board").boundingBox();
  const cell = box.width / 10;
  await page.mouse.move(box.x + (target.from.c + 0.5) * cell, box.y + (target.from.r + 0.5) * cell);
  await page.mouse.down();
  await page.mouse.move(box.x + (target.c + 0.5) * cell, box.y + (target.r + 0.5) * cell, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate((k) => window.ddp.match.fleet[k], target.k);
  assert.deepEqual([moved.r, moved.c], [target.r, target.c], "ship dragged to the new square");
  // Tap the selected ship to rotate it (or get told there's no room).
  const orientation = moved.vertical;
  await page.locator(`.own .ship[data-k="${target.k}"]`).click();
  const rotated = await page.evaluate((k) => window.ddp.match.fleet[k].vertical, target.k);
  if (rotated === orientation) await page.locator("#toast.show").waitFor();

  await page.click("#ready");
  await page.waitForFunction(() => window.ddp.match.phase === "playing", null, { timeout: 10_000 });
  for (let shots = 0; shots < 3; ) {
    await page.waitForFunction(() => window.ddp.match.canFire() || window.ddp.match.phase !== "playing", null, { timeout: 15_000 });
    if (await page.evaluate(() => window.ddp.match.phase !== "playing")) break;
    const i = await page.evaluate(() => window.ddp.match.state.boards[1].cells.findIndex((v) => v === 0));
    const moves = await page.evaluate(() => window.ddp.match.state.moves);
    await page.click(`.enemy .cell[data-i="${i}"]`);
    await page.waitForFunction((n) => window.ddp.match.state.moves > n, moves);
    shots++;
  }
  assert.ok((await page.locator("#sb-log li").count()) >= 3);
  assert.equal(await page.locator("#sb-clock").isVisible(), false, "no turn clock against the robot");
  const toastBox = await page.locator("#toast").boundingBox();
  assert.ok(toastBox && toastBox.y < 120, "toasts sit at the top, clear of the boards");
  await page.click("#sound-toggle");
  assert.equal(await page.evaluate(() => localStorage.getItem("ddp-sound")), "off");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});

test("the turn clock fires a random shot when time runs out (friend game)", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const open = async () => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => (window.ddpTurnSeconds = 2));
    return ctx.newPage();
  };
  const host = await open();
  await host.goto(`${srv.base}/sea-battle/`);
  await host.click("#play-friend");
  const invite = await host.locator("#invite-link").inputValue();
  const guest = await open();
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await host.click("#ready");
  await guest.click("#ready");
  for (const p of [host, guest]) await p.waitForFunction(() => window.ddp.match.phase === "playing", null, { timeout: 20_000 });
  const shooter = (await host.evaluate(() => window.ddp.match.canFire())) ? host : guest;
  const watcher = shooter === host ? guest : host;
  assert.match(await shooter.locator("#sb-clock").innerText(), /Your shot: \ds/);
  assert.match(await watcher.locator("#sb-clock").innerText(), /: \ds/);
  // Nobody clicks: after 2 s the shooter's browser fires on its own.
  await shooter.waitForFunction(() => window.ddp.match.state.moves >= 1, null, { timeout: 10_000 });
  await watcher.waitForFunction(() => window.ddp.match.state.moves >= 1, null, { timeout: 10_000 });
  assert.match(await shooter.locator("#toast").innerText(), /Time's up/);
});
