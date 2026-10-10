// Headless-browser test for Crazy Eights: four friends in four browsers fill
// a room from the invite link and play a full game, audited at the end; then
// a rematch where one of them leaves. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, state, resultInView, autoplay, stopAutoplay, leaks, domLeaks } from "./crazy-eights.shared.js";

test("four friends play Crazy Eights in four browsers, with every hand hidden and the game audited, then one leaves", { skip: !pw && "Playwright not installed", timeout: 360_000 }, async (t) => {
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
  const host = await open("Ada");
  await host.goto(`${srv.base}/crazy-eights/`);
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
  // Four players get 5 cards each (whoever goes first may already have drawn).
  const st0 = await state(host);
  assert.deepEqual(st0.hands.map((h, p) => h.length - st0.draws[p] + st0.plays[p]), [5, 5, 5, 5], "four players get 5 cards each");
  for (const [seat, p] of pages.entries()) {
    assert.equal(await p.locator(".ce-seat").count(), 3);
    // Each seat's count matches its hand, once this screen has caught up.
    await wait(p, () => {
      const st = window.ddp.match.state;
      return [...document.querySelectorAll(".ce-seat")].every((e) => Number(e.querySelector(".count").textContent) === st.hands[Number(e.dataset.seat)].length);
    });
    // The next player sits on your left, then across, then on your right; colours follow the seat everywhere.
    const seatsShown = await p.locator(".ce-seat").evaluateAll((els) => els.map((e) => [Number(e.dataset.seat), [...e.classList].find((c) => c.startsWith("pos-"))]));
    assert.deepEqual(seatsShown, [[(seat + 1) % 4, "pos-left"], [(seat + 2) % 4, "pos-top"], [(seat + 3) % 4, "pos-right"]]);
    assert.equal(await p.locator(".pb-who.p-1").innerText().then((s) => s.split("\n")[0]), seat === 1 ? "Bo (you)" : "Bo");
    assert.equal(await p.locator(".ce-seat.p-1, .ce-me.p-1").count(), 1);
  }
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");
  await friends[0].screenshot({ path: `${ARTIFACTS}/ce-4-four-mobile-dark.png`, fullPage: true });

  await Promise.all(pages.map(autoplay));
  await wait(host, () => window.ddp.match.state.moves >= 8 || window.ddp.match.phase !== "playing", undefined, 120_000);
  await friends[0].screenshot({ path: `${ARTIFACTS}/ce-5-four-mobile-midgame.png`, fullPage: true });
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
    await p.locator("#ce-standings").waitFor();
    assert.equal(await p.locator("#ce-standings li").count(), 4);
    assert.match(await p.locator("#ce-standings").innerText(), /1st[\s\S]*2nd[\s\S]*3rd[\s\S]*4th/);
    assert.match(await p.locator("#ce-verdict").innerText(), /Fair play verified/);
  }
  // Everyone else is ranked by penalty points, now that the audit has shown every hand.
  const pts = await host.locator("#ce-standings li small").allInnerTexts();
  const nums = pts.slice(1).map((s) => Number(/(\d+) pts/.exec(s)?.[1]));
  assert.ok(nums.every((n, i) => Number.isInteger(n) && (i === 0 || n >= nums[i - 1])), `ranked by points: ${pts.join(" | ")}`);
  assert.ok(await resultInView(friends[0]), "the standings fit a phone without scrolling");
  await host.screenshot({ path: `${ARTIFACTS}/ce-6-four-over.png` });
  await friends[0].screenshot({ path: `${ARTIFACTS}/ce-7-four-over-mobile.png` });

  // All four agree to a rematch; partway in, one player leaves. The game ends
  // for everyone, and the screen says why and whether it was checked.
  for (const p of pages.slice(0, 3)) await p.click("#rematch");
  await friends[2].locator("#rematch-status").filter({ hasText: "Ada, Bo and Cy want a rematch!" }).waitFor();
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Di" }).waitFor();
  await friends[2].click("#rematch");
  for (const p of pages) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing", undefined, 60_000);
  await Promise.all(pages.map(autoplay));
  await wait(host, () => window.ddp.match.state.moves >= 4 || window.ddp.match.phase !== "playing", undefined, 60_000);
  await Promise.all(pages.map(stopAutoplay));
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Cy (left the game|.*lost)/);
    assert.match(await p.locator("#ce-ended").innerText(), /game is over for all 4 of you[\s\S]*Cy: \d+ cards? \(left\)/);
    assert.match(await p.locator("#ce-ended").innerText(), /The game stopped before the end, so it wasn't checked\./);
  }
  await friends[0].screenshot({ path: `${ARTIFACTS}/ce-8-four-left-mobile.png` });
  assert.deepEqual(errors, []);
});
