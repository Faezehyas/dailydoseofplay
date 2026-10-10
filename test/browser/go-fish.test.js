// Headless-browser test for Go Fish: two friends play on the host's room
// settings through the invite link and the Start button, over a real WebRTC
// DataChannel, with every shuffle proved and the game audited; then a
// rematch, one that starts before the last verdict, and a game one of them
// leaves during the audit. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, bg, pick, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./go-fish.shared.js";

test("two friends play Go Fish on the host's settings through the invite link, then a rematch", { skip: !pw && "Playwright not installed", timeout: 420_000 }, async (t) => {
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

  // Host (laptop, light): classic defaults, then the lucky fish passes and the host goes first.
  const host = await open("host", "Ada", { colorScheme: "light" });
  await host.goto(`${srv.base}/go-fish/`);
  for (const [name, value] of [["hand", "classic"], ["lucky", "again"], ["empty", "draw"], ["books", "4"], ["first", "random"], ["moveSeconds", "0"], ["level", "easy"], ["robots", "3"], ["fourColor", "false"]]) {
    assert.equal(await host.locator(`#gf-settings input[name="gf-${name}"]:checked`).getAttribute("value"), value, `classic default for ${name}`);
  }
  await pick(host, "lucky", "pass");
  await pick(host, "first", "host");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = await host.locator("#invite-link").inputValue();
  assert.match(invite, /\/go-fish\/\?room=[A-Z0-9]{4}&key=[\w-]{22}$/);

  // The friend (360 px phone, dark, four-colour deck, pairs on their own device) opens the link; the host presses Start with two in.
  const guest = await open("guest", "Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" });
  await guest.addInitScript(() => localStorage.setItem("ddp-go-fish-settings", JSON.stringify({ fourColor: true, books: 2 })));
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.match(await host.locator("#start-game").innerText(), /2 players/);
  await host.click("#start-game");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  await guest.locator("#gf-config").filter({ hasText: "a lucky fish passes" }).waitFor();
  assert.equal(await guest.locator("#gf-config").innerText(), "7 cards each · books of four · a lucky fish passes · an empty hand draws one");
  assert.equal(await host.locator("#gf-config").innerText(), await guest.locator("#gf-config").innerText(), "the host's settings reach the friend, not the friend's own");
  assert.match(await host.locator(".pb-players").innerText(), /Ada \(you\)[\s\S]*Bo/);
  assert.match(await guest.locator(".pb-players").innerText(), /Bo \(you\)[\s\S]*Ada/);
  // Seat colours are the same on both screens: Ada coral (seat 0), Bo teal (seat 1).
  for (const p of [host, guest]) {
    assert.equal(await p.locator(".pb-who.p-0").innerText().then((s) => s.split("\n")[0]), p === host ? "Ada (you)" : "Ada");
    assert.equal(await p.locator(".pc-seat.p-1, .pc-me.p-1").count(), 1);
  }
  const st0 = await state(host);
  assert.equal(st0.first, 0, "the room says the host goes first");
  assert.equal(st0.stock.length + st0.log.filter((e) => e.t === "draw").length, 52 - 14, "two players get 7 cards each");
  // The friend's four-colour deck is theirs alone.
  assert.equal(await guest.locator(".go-fish.four-colour").count(), 1);
  assert.equal(await host.locator(".go-fish.four-colour").count(), 0);
  assert.ok(await noHorizontalScroll(guest), "no horizontal scroll at 360 px");
  assert.equal(await bg(guest), "rgb(18, 21, 28)", "the phone follows its dark OS theme");
  await guest.screenshot({ path: `${ARTIFACTS}/gf-1-friend-mobile-dark.png`, fullPage: true });

  async function finish() {
    await Promise.all([autoplay(host), autoplay(guest)]);
    for (const p of [host, guest]) await wait(p, () => window.ddp.match.phase === "over", undefined, 150_000);
    await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
    for (const p of [host, guest]) {
      assert.deepEqual(await leaks(p), [], "no hidden face was known during play");
      assert.deepEqual(await domLeaks(p), [], "no hidden face was drawn");
      await wait(p, () => window.ddp.match.verdict, undefined, 60_000);
      assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
      await p.locator("#gf-verdict.ok").waitFor();
      assert.match(await p.locator("#gf-verdict").innerText(), /Fair play verified/);
    }
    const [a, b] = [await state(host), await state(guest)];
    assert.deepEqual(a, b, "both browsers end on the same state");
    assert.equal(a.books.flat().length, 13);
    assert.equal(a.winners.length, 1, "13 books between two players can't tie");
    const won = a.winner === 0 ? host : guest;
    assert.equal(await won.locator("#result").innerText(), "You won");
    assert.equal(await (won === host ? guest : host).locator("#result").innerText(), "You lost");
    assert.match(await host.locator("#result-reason").innerText(), new RegExp(`laid down the most: ${a.books[a.winner].length} books`));
    assert.equal(await host.locator("#gf-standings li").count(), 2);
    for (const p of [host, guest]) assert.ok(await resultInView(p), "the result fits without scrolling");
    // The player bar's score is each player's books.
    for (const p of [host, guest]) assert.equal(await p.locator("#score .p-0 dd").innerText(), String(a.books[0].length));
    return a;
  }

  await finish();
  await host.screenshot({ path: `${ARTIFACTS}/gf-2-friend-over.png` });
  await guest.screenshot({ path: `${ARTIFACTS}/gf-3-friend-over-mobile.png` });

  // Rematch: the friend asks, the host sees it and accepts.
  await guest.click("#rematch");
  await host.locator("#rematch-status").filter({ hasText: "Bo wants a rematch!" }).waitFor();
  await guest.locator("#rematch-status").filter({ hasText: "Waiting for Ada" }).waitFor();
  await host.click("#rematch");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing", undefined, 60_000);
  await finish();

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
  assert.equal(await host.evaluate(() => document.querySelector("#gf-note").textContent.includes("verified")), false, "the rematch began before the verdict");
  await host.locator("#gf-note").filter({ hasText: "Last game: fair play verified" }).waitFor({ timeout: 30_000 });

  // Bo's browser never sends its key again.
  await guest.evaluate(() => {
    const send = window.ddp.session.send.bind(window.ddp.session);
    window.ddp.session.send = (msg) => (msg.t === "audit" ? true : send(msg));
  });

  // The fourth game: Bo leaves during the audit.
  await Promise.all([autoplay(host), autoplay(guest)]);
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.phase === "over", undefined, 150_000);
  await Promise.all([stopAutoplay(host), stopAutoplay(guest)]);
  await host.locator("#gf-verdict:not(.ok)").waitFor();
  assert.equal(await host.evaluate(() => window.ddp.match.busy), "auditing", "still waiting for Bo's key");
  await guest.close();
  await host.locator("#ended").waitFor({ timeout: 20_000 });
  assert.match(await host.locator("#gf-ended").innerText(), /Bo left before the audit finished, so this game couldn't be verified\./);
  assert.deepEqual(errors, []);
});
