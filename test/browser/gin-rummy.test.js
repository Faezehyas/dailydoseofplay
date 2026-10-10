// Headless-browser test for Gin Rummy: two friends play on the host's room
// settings through the invite link, over a real WebRTC DataChannel, with
// every shuffle proved and the game audited; a full hand, the score carried
// through a rematch, a rematch that starts before the last verdict, and a
// game one of them leaves during the audit. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, bg, pick, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./gin-rummy.shared.js";

test("two friends play Gin Rummy on the host's settings through the invite link, and the score carries through a rematch", { skip: !pw && "Playwright not installed", timeout: 420_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    // Reduced motion plays every card at once, so whole games fit the test.
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    return page;
  }

  // Host (laptop, light): classic defaults, then one hand a game, Oklahoma knocking, and the host deals first.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/gin-rummy/`);
  for (const [name, value] of [["target", "100"], ["knock", "classic"], ["bigGin", "false"], ["dealer", "random"], ["moveSeconds", "0"], ["level", "easy"], ["fourColor", "false"]]) {
    assert.equal(await host.locator(`#gr-settings input[name="gr-${name}"]:checked`).getAttribute("value"), value, `classic default for ${name}`);
  }
  await pick(host, "target", 0);
  await pick(host, "knock", "oklahoma");
  await pick(host, "dealer", "host");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  assert.match(invite, /\/gin-rummy\/\?room=[A-Z0-9]{4}&key=[\w-]{22}$/);

  // The friend (360 px phone, dark, four-colour deck, Big Gin on their own device) opens the link.
  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.addInitScript(() => localStorage.setItem("ddp-gin-rummy-settings", JSON.stringify({ fourColor: true, bigGin: true })));
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  await guest.locator("#gr-config").filter({ hasText: "Oklahoma" }).waitFor();
  assert.equal(await guest.locator("#gr-config").innerText(), "One hand a game · Oklahoma: the upcard sets the knock limit");
  assert.equal(await host.locator("#gr-config").innerText(), await guest.locator("#gr-config").innerText(), "the host's settings reach the friend, not the friend's own");
  assert.match(await host.locator(".pb-players").innerText(), /Ada \(you\)[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo \(you\)[\s\S]*Ada/);
  // Seat colours are the same on both screens: Ada coral (seat 0), Bo teal (seat 1).
  for (const p of [host, guest]) {
    assert.equal(await p.locator(".pb-who.p-0").innerText().then((s) => s.split("\n")[0]), p === host ? "Ada (you)" : "Ada");
    assert.equal(await p.locator(".pc-seat.p-1, .pc-me.p-1").count(), 1);
  }
  const st0 = await state(host);
  assert.deepEqual([st0.dealer, st0.turn, st0.hands[0].length, st0.hands[1].length], [0, 1, 10, 10], "the host deals, so Bo is offered the upcard");
  await wait(host, () => window.ddp.match.state.limit !== null);
  // The friend's four-colour deck is theirs alone.
  assert.equal(await guest.locator(".gin-rummy.four-colour").count(), 1);
  assert.equal(await host.locator(".gin-rummy.four-colour").count(), 0);
  // Bo is offered the upcard: Take and Pass on the phone; nothing to do for Ada.
  await guest.locator("#gr-pass:not([hidden])").waitFor();
  assert.equal(await host.locator("#gr-pass:not([hidden]), #gr-take:not([hidden])").count(), 0);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  await guest.screenshot({ path: `${ARTIFACTS}/gr-1-friend-mobile-dark.png`, fullPage: true });

  async function finish(m) {
    await Promise.all([autoplay(host), autoplay(guest)]);
    for (const p of [host, guest]) await wait(p, (n) => window.ddp.match.m === n && window.ddp.match.phase === "over", m, 150_000);
    await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
    for (const p of [host, guest]) {
      assert.deepEqual(await leaks(p), [], "no hidden face was known during play");
      assert.deepEqual(await domLeaks(p), [], "no hidden face was drawn");
      await wait(p, () => window.ddp.match.verdict, undefined, 60_000);
      assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
      await p.locator("#gr-verdict.ok").waitFor();
      assert.match(await p.locator("#gr-verdict").innerText(), /Fair play verified/);
      assert.ok(await resultInView(p), "the result fits without scrolling");
    }
    const [a, b] = [await state(host), await state(guest)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.equal(a.history.length, 1, "one hand a game");
    if (a.winner < 2) {
      const won = a.winner === 0 ? host : guest;
      assert.equal(await won.locator("#result").innerText(), "You won");
      assert.equal(await (won === host ? guest : host).locator("#result").innerText(), "You lost");
    } else for (const p of [host, guest]) assert.equal(await p.locator("#result").innerText(), "Draw");
    return a;
  }

  const first = await finish(1);
  await host.screenshot({ path: `${ARTIFACTS}/gr-2-friend-over.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/gr-3-friend-over-mobile.png` });
  for (const p of [host, guest]) assert.equal(await p.locator("#score .p-0 dd").innerText(), String(first.scores[0]));

  // Rematch: the friend asks, the host sees it and accepts. The score carries on from the first hand.
  await guest.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Bo wants a rematch!" }).waitFor();
  await host.click("#rematch");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing", undefined, 60_000);
  for (const p of [host, guest]) assert.deepEqual([await p.locator("#score .p-0 dd").innerText(), await p.locator("#score .p-1 dd").innerText()], first.scores.map(String));
  const second = await finish(2);
  for (const p of [host, guest]) assert.deepEqual([await p.locator("#score .p-0 dd").innerText(), await p.locator("#score .p-1 dd").innerText()], [0, 1].map((s) => String(first.scores[s] + second.scores[s])), "the score adds up across rematches");

  // A third game, and a rematch that starts before the host's audit has finished: the verdict still reaches the screen.
  await guest.click("#rematch");
  await host.click("#rematch");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.m === 3 && window.ddp.match.phase === "playing", undefined, 60_000);
  await host.evaluate(() => {
    // The host's deck work for the audit takes 4 s longer, once.
    const deck = window.ddp.match.deck;
    const faces = deck.faces;
    deck.faces = async (...args) => {
      deck.faces = faces;
      await new Promise((r) => setTimeout(r, 4000));
      return faces(...args);
    };
  });
  await Promise.all([autoplay(host), autoplay(guest)]);
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.phase === "over", undefined, 150_000);
  await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
  await guest.click("#rematch");
  await host.click("#rematch");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.m === 4 && window.ddp.match.phase === "playing", undefined, 60_000);
  assert.equal(await host.evaluate(() => document.querySelector("#gr-note").textContent.includes("verified")), false, "the rematch began before the verdict");
  await host.locator("#gr-note").filter({ hasText: "Last game: fair play verified" }).waitFor({ timeout: 30_000 });

  // Bo's browser never sends its key again; the fourth game, Bo leaves during the audit.
  await guest.evaluate(() => {
    const send = window.ddp.session.send.bind(window.ddp.session);
    window.ddp.session.send = (msg) => (msg.t === "audit" ? true : send(msg));
  });
  await Promise.all([autoplay(host), autoplay(guest)]);
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.phase === "over", undefined, 150_000);
  await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
  await host.locator("#gr-verdict:not(.ok)").waitFor();
  assert.equal(await host.evaluate(() => window.ddp.match.busy), "auditing", "still waiting for Bo's key");
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#gr-ended").innerText(), /Bo left before the audit finished, so this game couldn't be verified\./);
  assert.deepEqual(errors, []);
});

test("two friends play a game to 100: several hands, each shuffled again, and the bonuses at the end", { skip: !pw && "Playwright not installed", timeout: 420_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  const pages = [];
  for (const [name, nick] of [["host", "Ada"], ["guest", "Bo"]]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nick);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    pages.push(page);
  }
  const [host, guest] = pages;
  await host.goto(`${srv.base}/gin-rummy/?friend=1`);
  const invite = await host.locator("#invite-link").inputValue();
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  // Play the first hand, stop at its score, and look at the table.
  await Promise.all(pages.map((p) => p.evaluate(() => (window.__hold = true))));
  await Promise.all(pages.map(autoplay));
  for (const p of pages) await wait(p, () => window.ddp.match.state.history.length >= 1 && !document.querySelector(".gr-fly .pc-card"), undefined, 120_000);
  const mid = await state(host);
  await host.screenshot({ path: `${ARTIFACTS}/gr-4-friend-hand-scored.png` });
  if (mid.history[0].kind !== "draw") {
    // Both hands lie face up: the knocker's melds, the defender's melds, deadwood and any lay-offs.
    for (const p of pages) {
      await p.locator("#gr-score:not([hidden])").waitFor();
      const laid = (await p.locator(".gr-spread-them .pc-card").count()) + (await p.locator(".gr-spread-mine .pc-card").count());
      assert.equal(laid, 20, "all twenty cards, lay-offs on the knocker's melds");
    }
  }
  // Both say Next hand from the keyboard, twice: the second N doesn't carry over into the next hand's score.
  if (mid.phase === "result") {
    for (const p of pages) await p.locator("#gr-next:not([hidden])").waitFor();
    for (let i = 0; i < 2; i++) for (const p of pages) await p.keyboard.press("n");
    for (const p of pages) await wait(p, () => window.ddp.match.phase === "over" || (window.ddp.match.state.hand === 2 && window.ddp.match.state.phase === "result"), undefined, 120_000);
  }
  if ((await state(host)).phase === "result") {
    await host.waitForTimeout(1500);
    const held = await state(host);
    assert.deepEqual([held.hand, held.phase, held.ready], [2, "result", 0], "hand 2's score waits for both players");
  }
  await Promise.all(pages.map((p) => p.evaluate(() => (window.__hold = false))));
  for (const p of pages) await wait(p, () => window.ddp.match.phase === "over", undefined, 300_000);
  await Promise.all(pages.map(stopAutoplay));
  const st = await state(host);
  assert.deepEqual(await state(guest), st);
  assert.ok(st.history.length >= 2, `${st.history.length} hands`);
  assert.ok(Math.max(...st.scores) >= 100);
  for (const p of pages) {
    await wait(p, () => window.ddp.match.verdict, undefined, 60_000);
    assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
    assert.equal(await p.locator("#gr-standings tbody tr").count(), 2);
    assert.ok(await resultInView(p), "the result fits without scrolling, with both hands laid out");
  }
  assert.match(await host.locator("#result-reason").innerText(), new RegExp(`reached 100 first, after ${st.history.length} hands: ${st.final.totals[st.winner]} to ${st.final.totals[1 - st.winner]} with the bonuses`));
  await host.screenshot({ path: `${ARTIFACTS}/gr-5-friend-game-over.png` });
  assert.deepEqual(errors, []);
});
