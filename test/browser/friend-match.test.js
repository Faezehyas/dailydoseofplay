// Headless-browser test: two separate browser contexts play a full Sea Battle
// match as friends, over the real signaling server and a real WebRTC
// DataChannel (loopback ICE needs no STUN). A typed room code has to be let in
// by the host; the invite link joins straight away. Skips if Playwright is missing.
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
  assert.match(invite, new RegExp(`/sea-battle/\\?room=${code}&key=[\\w-]{22}$`));
  await host.screenshot({ path: `${ARTIFACTS}/1-invite.png` });

  // Friend opens the link on a phone-sized screen and lands in the game, with no prompt for the host.
  await host.evaluate(() => {
    window.__sawKnock = false;
    new MutationObserver(() => (window.__sawKnock ||= !!document.querySelector("li.knock"))).observe(document.body, { subtree: true, childList: true });
  });
  const guest = await open("guest", "Bo", { viewport: { width: 390, height: 844 }, hasTouch: true });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  await host.locator("#ready").waitFor();
  assert.equal(await host.evaluate(() => window.__sawKnock), false, "an invite link needs no Accept");
  assert.equal(await guest.evaluate(() => location.search), "", "the key leaves the address bar");
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
    const owned = ["big", "nuke", "carpet"].find((w) => view.inv[w] > 0);
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
  for (const p of pages) assert.doesNotMatch(await p.locator("#sb-over").innerText(), /false|undefined/);
  assert.match(await host.locator("#verdict").innerText(), /Fair play verified/);
  assert.match(await guest.locator("#verdict").innerText(), /Fair play verified/);
  const winner = await host.evaluate(() => window.ddp.match.state.winner);
  assert.equal(winner, 1, "the guest aimed at ships and wins");
  assert.match(await guest.locator(".sb-over h2").innerText(), /Victory/);
  // Each player sees only the gifts they can collect, never the opponent's.
  for (const p of [host, guest]) {
    const gifts = await p.evaluate(() => {
      const m = window.ddp.match;
      return { mine: m.state.boards[m.me].gifts.length, target: m.state.boards[1 - m.me].gifts.length };
    });
    assert.equal(await p.locator(".own .cell.gift").count(), 0, `own board hides ${gifts.mine} opponent gift(s)`);
    assert.equal(await p.locator(".enemy .cell.gift").count(), gifts.target);
    assert.doesNotMatch(await p.locator("#sb-log").innerText(), /picked up/);
  }
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
  await host.locator("#roster li.knock", { hasText: "Guest wants to join" }).getByRole("button", { name: "Accept" }).click();
  await guest.locator("#connect-error").waitFor({ timeout: 10_000 }).catch(async (err) => {
    throw new Error(`${err.message}\nguest lobby: ${await guest.locator("#lobby").innerText()}`);
  });
  assert.match(await guest.locator("#connect-error").innerText(), /relay \(TURN\)/);
  assert.equal(await guest.locator("#play-robot").count(), 1, "robot is offered as a fallback");

  // The failed guest left the room; the host's invite must still work for someone else.
  await host.locator("#lobby-status").filter({ hasText: "Waiting for your friend" }).waitFor({ timeout: 10_000 });
  assert.equal((await host.locator("#room-code").innerText()).trim(), code);
  const invite = await host.locator("#invite-link").inputValue();
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await friend.click("#join-room");
  await friend.locator("#ready").waitFor({ timeout: 20_000 });
  await host.locator("#ready").waitFor();
});

test("a typed room code waits for the host: Decline turns a stranger away, Accept lets a friend in to play", { skip: !pw && "Playwright not installed", timeout: 90_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname) {
    const ctx = await browser.newContext();
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    return page;
  }
  const typeCode = async (page, code) => {
    await page.goto(`${srv.base}/sea-battle/`);
    await page.fill("#join-code", code);
    await page.locator("#lobby-status", { hasText: "Waiting for the host to let you in" }).waitFor();
  };
  const host = await open("Ada");
  await host.goto(`${srv.base}/sea-battle/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const code = (await host.locator("#room-code").innerText()).trim();
  assert.match(await host.locator("#lobby").innerText(), /types the code instead has to be let in by you/);

  const stranger = await open("Mal");
  await typeCode(stranger, code);
  const knock = host.locator("#roster li.knock", { hasText: "Mal wants to join" });
  await knock.waitFor();
  assert.match(await host.title(), /Mal wants to join/, "the tab title tells a host who is busy elsewhere");
  await knock.getByRole("button", { name: "Decline" }).click();
  await stranger.locator("#join-error", { hasText: "didn't let you in" }).waitFor();
  await host.locator("#roster").waitFor({ state: "hidden" });
  assert.equal(await stranger.locator("#ready").count(), 0);

  const friend = await open("Bo");
  await typeCode(friend, code.toLowerCase());
  await host.locator("#roster li.knock", { hasText: "Bo wants to join" }).getByRole("button", { name: "Accept" }).click();
  await host.locator("#ready").waitFor({ timeout: 20_000 });
  await friend.locator("#ready").waitFor({ timeout: 20_000 });
  assert.match(await host.locator(".sb-players").innerText(), /Bo/);
  // The guest's match exists once the host's settings arrive.
  for (const p of [host, friend]) await p.waitForFunction(() => window.ddp.match?.phase === "placing", null, { timeout: 20_000 });
  await host.click("#ready");
  await friend.click("#ready");
  const playing = (p) => p.waitForFunction(() => window.ddp.match?.phase === "playing", null, { timeout: 20_000 });
  await Promise.all([playing(host), playing(friend)]);
  assert.deepEqual(errors, []);
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
  assert.equal(await page.locator(".game-card h2 a").count(), games.length - soon.length);
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
  assert.ok(await page.locator("#sb-settings").isVisible(), "game settings on the home screen");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "settings fit on a phone");
  await page.click("#play-robot");
  await page.locator("#ready").waitFor();
  assert.ok(await page.locator("#sb-settings").isHidden(), "settings only on the home screen");
  assert.match(await page.locator(".sb-players").innerText(), /Cleo[\s\S]*Robot/);
  assert.equal(await page.locator("#sb-config").innerText(), "30 s a shot · 10 min each", "default settings");

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

  // Drag a ship, press R mid-drag, drop it: it lands rotated.
  const plan = await page.evaluate(async () => {
    const R = await import("/sea-battle/rules.js");
    const fleet = window.ddp.match.fleet;
    for (let k = 0; k < fleet.length; k++) {
      const ship = fleet[k];
      const others = fleet.filter((_, j) => j !== k);
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          const turned = { ...ship, r, c, vertical: !ship.vertical };
          if ((r !== ship.r || c !== ship.c) && R.canPlace(others, turned)) return { k, from: { r: ship.r, c: ship.c }, to: turned };
        }
      }
    }
    return null;
  });
  assert.ok(plan, "some ship can be moved and turned");
  await page.mouse.move(box.x + (plan.from.c + 0.5) * cell, box.y + (plan.from.r + 0.5) * cell);
  await page.mouse.down();
  await page.mouse.move(box.x + (plan.from.c + 0.6) * cell, box.y + (plan.from.r + 0.6) * cell);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + (plan.to.c + 0.5) * cell, box.y + (plan.to.r + 0.5) * cell, { steps: 8 });
  await page.mouse.up();
  const dropped = await page.evaluate((k) => window.ddp.match.fleet[k], plan.k);
  assert.deepEqual(
    { r: dropped.r, c: dropped.c, vertical: dropped.vertical },
    { r: plan.to.r, c: plan.to.c, vertical: plan.to.vertical },
    "R while dragging rotates the ship",
  );

  await page.click("#ready");
  await page.waitForFunction(() => window.ddp.match.phase === "playing", null, { timeout: 10_000 });
  for (let shots = 0; shots < 3; ) {
    await page.waitForFunction(() => window.ddp.match.canFire() || window.ddp.match.phase !== "playing", null, { timeout: 15_000 });
    if (await page.evaluate(() => window.ddp.match.phase !== "playing")) break;
    const i = await page.evaluate(() => window.ddp.match.state.boards[1].cells.findIndex((v) => v === 0));
    const moves = await page.evaluate(() => window.ddp.match.state.moves);
    await page.click(`.enemy .cell[data-i="${i}"]`);
    await page.waitForFunction((n) => window.ddp.match.state.moves > n, moves);
    // The log line waits for the shell to land; hits fire again without waiting.
    const name = await page.evaluate(async (i) => (await import("/sea-battle/rules.js")).cellName(i), i);
    await page.locator("#sb-log li.mine", { hasText: `You fired at ${name}:` }).waitFor();
    shots++;
  }
  assert.ok((await page.locator("#sb-log li").count()) >= 3);
  assert.match(await page.locator("#clock-me").innerText(), /You \d+:\d\d/);
  assert.equal(await page.locator("#clock-opp").isVisible(), false, "the robot's clock doesn't run");

  // Missile rain isn't aimed: a tap on the board must not launch it (it could
  // miss the gift you tapped); it fires from its own button.
  await page.waitForFunction(() => window.ddp.match.canFire() || window.ddp.match.phase !== "playing", null, { timeout: 15_000 });
  if (await page.evaluate(() => window.ddp.match.phase === "playing")) {
    const giveRain = (n) => page.evaluate((n) => {
      const m = window.ddp.match;
      m.state.inventory[m.me].rain = n; // local only, never fired
      m.emit("update");
    }, n);
    await page.waitForTimeout(1200); // let the robot's last volley land and toast
    await giveRain(1);
    await page.click('.weapon[data-w="rain"]');
    assert.equal(await page.locator("#launch-rain").isVisible(), true);
    const moves = await page.evaluate(() => window.ddp.match.state.moves);
    const free = await page.evaluate(() => window.ddp.match.state.boards[1].cells.findIndex((v) => v === 0));
    await page.click(`.enemy .cell[data-i="${free}"]`);
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.ddp.match.state.moves), moves, "a board tap doesn't fire rain");
    assert.equal(await page.evaluate(() => window.ddp.match.pending), null);
    assert.match(await page.locator("#toast").innerText(), /Launch rain/);
    await giveRain(0);
    assert.equal(await page.locator("#launch-rain").count(), 0);

    // Carpet bomb: aims at a whole row; R (or the button) switches to a column.
    await page.evaluate(() => {
      const m = window.ddp.match;
      m.state.inventory[m.me].carpet = 1; // local only, never fired
      m.emit("update");
    });
    await page.click('.weapon[data-w="carpet"]');
    assert.equal(await page.locator("#carpet-dir").innerText(), "↔ Row");
    await page.hover(`.enemy .cell[data-i="${free}"]`);
    const inRow = (await page.evaluate((f) => window.ddp.match.state.boards[1].cells.filter((v, i) => v === 0 && Math.floor(i / 10) === Math.floor(f / 10)).length, free));
    assert.equal(await page.locator(".enemy .cell.aim").count(), inRow, "the whole row is aimed");
    await page.keyboard.press("r");
    assert.equal(await page.locator("#carpet-dir").innerText(), "↕ Column");
    const inCol = (await page.evaluate((f) => window.ddp.match.state.boards[1].cells.filter((v, i) => v === 0 && i % 10 === f % 10).length, free));
    assert.equal(await page.locator(".enemy .cell.aim").count(), inCol, "R re-aims along the column");
    await page.click("#carpet-dir");
    assert.equal(await page.locator("#carpet-dir").innerText(), "↔ Row");
    await page.evaluate(() => {
      const m = window.ddp.match;
      m.state.inventory[m.me].carpet = 0;
      m.emit("update");
    });
    assert.equal(await page.locator("#carpet-dir").count(), 0);
  }
  const toastBox = await page.locator("#toast").boundingBox();
  assert.ok(toastBox && toastBox.y < 120, "toasts sit at the top, clear of the boards");
  await page.click("#sound-toggle");
  assert.equal(await page.evaluate(() => localStorage.getItem("ddp-sound")), "off");
  assert.equal(await page.locator("#sound-toggle").getAttribute("aria-pressed"), "true");
  await page.click("#leave");
  await page.locator("#play-friend").waitFor();
  assert.deepEqual(errors, []);
});

test("a robot game on a 360 px phone with the longest nickname has no sideways scroll", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("ddp-name", "W".repeat(20)));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const noSideScroll = async (when) =>
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 360, `no horizontal scroll ${when}`);

  await page.goto(`${srv.base}/sea-battle/`);
  await page.click("#play-robot");
  await page.locator("#ready").waitFor();
  await noSideScroll("while placing ships");
  // A long name is cut short, but both scores stay on screen.
  for (const id of ["#score-me", "#score-opp"]) {
    const box = await page.locator(id).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 360, `${id} is on screen`);
  }

  await page.click("#ready");
  await page.waitForFunction(() => window.ddp.match.phase === "playing", null, { timeout: 10_000 });
  await page.waitForFunction(() => window.ddp.match.canFire(), null, { timeout: 15_000 });
  // Every weapon in stock (local only, never fired) and the carpet bomb's row/column button showing.
  await page.evaluate(() => {
    const m = window.ddp.match;
    Object.assign(m.state.inventory[m.me], { big: 1, rain: 1, nuke: 1, carpet: 1 });
    m.emit("update");
  });
  await page.click('.weapon[data-w="carpet"]');
  await page.locator("#carpet-dir").waitFor();
  await noSideScroll("with every weapon in the bar");
  for (const box of await page.locator(".sb-weapons button").evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().toJSON()))) {
    assert.ok(box.left >= 0 && box.right <= 360 && box.height >= 44, "each weapon is on screen and big enough to tap");
  }
  assert.deepEqual(errors, []);
});

const pick = (page, name, value) => page.click(`#sb-settings label:has(input[name="sb-${name}"][value="${value}"])`);

test("the host's time settings apply to both friends; a shot's time running out fires a random shot", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const host = await (await browser.newContext()).newPage();
  await host.clock.install();
  await host.goto(`${srv.base}/sea-battle/`);
  await pick(host, "shotSeconds", 10);
  await pick(host, "gameSeconds", 180);
  await host.click("#play-friend");
  const invite = await host.locator("#invite-link").inputValue();
  // The guest's own (different) settings must not matter.
  const guestCtx = await browser.newContext();
  await guestCtx.addInitScript(() => localStorage.setItem("ddp-sb-settings", JSON.stringify({ shotSeconds: 40, gameSeconds: 0 })));
  const guest = await guestCtx.newPage();
  await guest.clock.install();
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  for (const p of [host, guest]) assert.equal(await p.locator("#sb-config").innerText(), "10 s a shot · 3 min each");
  await host.click("#ready");
  await guest.click("#ready");
  for (const p of [host, guest]) await p.waitForFunction(() => window.ddp.match.phase === "playing", null, { timeout: 20_000 });
  const shooter = (await host.evaluate(() => window.ddp.match.canFire())) ? host : guest;
  const watcher = shooter === host ? guest : host;
  assert.match(await shooter.locator("#sb-clock").innerText(), /Your shot: \d+s/);
  assert.match(await watcher.locator("#sb-clock").innerText(), /: \d+s/);
  for (const p of [host, guest]) {
    assert.match(await p.locator("#clock-me").innerText(), /You [23]:\d\d/);
    assert.match(await p.locator("#clock-opp").innerText(), /[23]:\d\d/);
  }
  // Nobody clicks: after 10 s the shooter's browser fires on its own.
  await shooter.clock.fastForward("00:11");
  await shooter.waitForFunction(() => window.ddp.match.state.moves >= 1, null, { timeout: 15_000 });
  await watcher.waitForFunction(() => window.ddp.match.state.moves >= 1, null, { timeout: 15_000 });
  assert.match(await shooter.locator("#toast").innerText(), /Time's up/);
  const clocks = await Promise.all([host, guest].map((p) => p.evaluate(() => window.ddp.match.state.clocks)));
  assert.deepEqual(clocks[0], clocks[1], "both browsers deducted the same time");
  assert.ok(Math.min(...clocks[0]) === 170_000, `the shooter spent its whole 10 s: ${clocks[0]}`);
});

test("against the robot, running out of your own clock loses the game", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto(`${srv.base}/sea-battle/`);
  await pick(page, "shotSeconds", 0);
  await pick(page, "gameSeconds", 180);
  await page.click("#play-robot");
  await page.click("#ready");
  await page.waitForFunction(() => window.ddp.match.phase === "playing", null, { timeout: 10_000 });
  assert.equal(await page.locator("#sb-config").innerText(), "no shot limit · 3 min each");
  assert.equal(await page.locator("#sb-clock").isVisible(), false, "no shot clock");
  await page.waitForFunction(() => window.ddp.match.canFire(), null, { timeout: 15_000 });
  await page.clock.fastForward("03:01");
  await page.waitForFunction(() => window.ddp.match.phase === "over", null, { timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.ddp.match.state.reason), "timeout");
  assert.equal(await page.evaluate(() => window.ddp.match.state.winner), 1);
  assert.equal(await page.locator("#sb-status").innerText(), "You ran out of time.");
  assert.equal(await page.locator("#sb-detail").innerText(), "Your clock ran out.");
  await page.locator("#verdict.ok").waitFor({ timeout: 10_000 });
  assert.deepEqual(errors, []);
});
