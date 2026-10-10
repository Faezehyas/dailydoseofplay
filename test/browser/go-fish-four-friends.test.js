// Headless-browser test for Go Fish: four friends in four browsers fill a
// room from the invite link (the host's Start button is ready from three)
// and play a full game of Pairs where an empty hand sits out, audited at the
// end; then a rematch where one of them leaves. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, pick, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./go-fish.shared.js";

test("four friends play Go Fish in four browsers, with every hand hidden and the game audited, then one leaves", { skip: !pw && "Playwright not installed", timeout: 360_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${nickname}: ${m.text()}`));
    return page;
  }
  // The host picks Pairs, where an empty hand sits out: the last player with cards takes the pond.
  const host = await open("Ada");
  await host.goto(`${srv.base}/go-fish/`);
  await pick(host, "books", 2);
  await pick(host, "empty", "out");
  assert.equal(await host.locator("#play-friend").innerText(), "Play with friends");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  const friends = [];
  for (const [name, opts] of [["Bo", { viewport: { width: 360, height: 740 }, hasTouch: true, colorScheme: "dark" }], ["Cy", {}], ["Di", {}]]) {
    const page = await open(name, opts);
    await page.goto(invite);
    await page.click("#join-room");
    friends.push(page);
    if (friends.length === 2) {
      // Three in: the waiting room's Start button could start a three-player game now.
      await host.locator("#roster li.ready", { hasText: "Cy" }).waitFor();
      assert.match(await host.locator("#start-game").innerText(), /3 players/);
      assert.ok(await host.locator("#start-game").isEnabled());
    }
  }
  // The fourth fills the room, which starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing", undefined, 60_000);
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  const st0 = await state(host);
  assert.equal(st0.stock.length + st0.log.filter((e) => e.t === "draw").length, 52 - 20, "four players get 5 cards each");
  for (const [seat, p] of pages.entries()) {
    assert.equal(await p.locator(".pc-seat").count(), 3);
    // Each seat's count matches its hand, once this screen has caught up.
    await wait(p, () => {
      const st = window.ddp.match.state;
      return [...document.querySelectorAll(".pc-seat")].every((e) => Number(e.querySelector(".count").textContent) === st.hands[Number(e.dataset.seat)].length);
    });
    // The next player sits on your left, then across, then on your right; colours follow the seat everywhere.
    const seatsShown = await p.locator(".pc-seat").evaluateAll((els) => els.map((e) => [Number(e.dataset.seat), [...e.classList].find((c) => c.startsWith("pos-"))]));
    assert.deepEqual(seatsShown, [[(seat + 1) % 4, "pos-left"], [(seat + 2) % 4, "pos-top"], [(seat + 3) % 4, "pos-right"]]);
    assert.equal(await p.locator(".pb-who.p-1").innerText().then((s) => s.split("\n")[0]), seat === 1 ? "Bo (you)" : "Bo");
    assert.equal(await p.locator(".pc-seat.p-1, .pc-me.p-1").count(), 1);
  }
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");
  await friends[0].screenshot({ path: `${ARTIFACTS}/gf-4-four-mobile-dark.png`, fullPage: true });

  await Promise.all(pages.map(autoplay));
  await wait(host, () => window.ddp.match.state.books.flat().length >= 8 || window.ddp.match.phase !== "playing", undefined, 120_000);
  await friends[0].screenshot({ path: `${ARTIFACTS}/gf-5-four-mobile-midgame.png`, fullPage: true });
  for (const p of pages) await wait(p, () => window.ddp.match.phase === "over", undefined, 240_000);
  await Promise.all(pages.map(stopAutoplay));
  for (const p of pages) {
    assert.deepEqual(await leaks(p), [], "no seat knew another's card during play");
    assert.deepEqual(await domLeaks(p), []);
  }
  const states = await Promise.all(pages.map(state));
  for (const st of states.slice(1)) assert.deepEqual(st, states[0], "all four browsers end on the same state");
  for (const p of pages) {
    await wait(p, () => window.ddp.match.verdict, undefined, 60_000);
    assert.deepEqual(await p.evaluate(() => window.ddp.match.verdict), { ok: true });
    await p.locator("#gf-standings").waitFor();
    assert.equal(await p.locator("#gf-standings li").count(), 4);
    assert.match(await p.locator("#gf-verdict").innerText(), /Fair play verified/);
  }
  // Standings by books, most first; players level on books share a place.
  const st = states[0];
  assert.equal(st.books.flat().length, 26, "26 pairs");
  assert.ok(st.books.flat().every((b) => b.slots.length === 2));
  assert.match(await host.locator("#gf-config").innerText(), /pairs · .* · an empty hand sits out/);
  const counts = (await host.locator("#gf-standings li small").allInnerTexts()).map(Number);
  assert.deepEqual(counts, st.books.map((b) => b.length).sort((a, b) => b - a));
  const places = await host.locator("#gf-standings .place").allInnerTexts();
  counts.forEach((n, i) => assert.equal(places[i], ["1st", "2nd", "3rd", "4th"][counts.indexOf(n)]));
  assert.ok(await resultInView(friends[0]), "the standings fit a phone without scrolling");
  await host.screenshot({ path: `${ARTIFACTS}/gf-6-four-over.png` });
  await friends[0].screenshot({ path: `${ARTIFACTS}/gf-7-four-over-mobile.png` });

  // All four agree to a rematch; partway in, one player leaves. The game ends
  // for everyone, and the screen says why and whether it was checked.
  for (const p of pages.slice(0, 3)) await p.click("#rematch");
  await friends[2].locator("#rematch-status").filter({ hasText: "Ada, Bo and Cy want a rematch!" }).waitFor();
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Di" }).waitFor();
  await friends[2].click("#rematch");
  for (const p of pages) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing", undefined, 60_000);
  await Promise.all(pages.map(autoplay));
  await wait(host, () => window.ddp.match.state.moves >= 12 || window.ddp.match.phase !== "playing", undefined, 60_000);
  await Promise.all(pages.map(stopAutoplay));
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Cy (left the game|.*lost)/);
    assert.match(await p.locator("#gf-ended").innerText(), /game is over for all 4 of you[\s\S]*Cy: \d+ cards?, \d+ pairs? \(left\)/);
    assert.match(await p.locator("#gf-ended").innerText(), /The game stopped before the end, so it wasn't checked\./);
  }
  await friends[0].screenshot({ path: `${ARTIFACTS}/gf-8-four-left-mobile.png` });
  assert.deepEqual(errors, []);
});
