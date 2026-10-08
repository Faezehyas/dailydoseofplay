// Headless-browser test for Ludo: four friends in four browsers fill a room and
// play for places, then one leaves. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, state, yardCorner, resultInView, autoplay, stopAutoplay } from "./ludo.shared.js";

test("four friends fill a Ludo room in four browsers and play for places, then one leaves", { skip: !pw && "Playwright not installed", timeout: 360_000 }, async (t) => {
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
    return page;
  }
  const host = await open("Ada");
  await host.goto(`${srv.base}/ludo/`);
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
      // Three in: the host could start now.
      await host.locator("#roster li.ready", { hasText: "Cy" }).waitFor();
      assert.match(await host.locator("#start-game").innerText(), /3 players/);
      assert.ok(await host.locator("#start-game").isEnabled());
    }
  }
  // The fourth player fills the room, so the game starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  const colors = ["red", "green", "yellow", "blue"];
  for (const [seat, p] of pages.entries()) {
    assert.equal(await p.locator(".ld-board .pawn").count(), 16, "sixteen tokens on the board");
    assert.equal(await p.locator(".ld-players .who").count(), 4);
    assert.equal(await p.locator("#ld-score > div").count(), 4);
    assert.equal(await yardCorner(p, colors[seat]), "bottom left", `${colors[seat]} sees their own yard bottom left`);
    // Each player's colour is the same on every screen.
    assert.equal(await p.locator(".ld-players .who.c-green").innerText().then((s) => s.split("\n")[0]), seat === 1 ? "Bo (you)" : "Bo");
  }
  assert.match(await friends[1].locator(".ld-players").innerText(), /Cy \(you\)[\s\S]*Ada[\s\S]*Bo[\s\S]*Di/, "you first, then the others in seat order");
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-4-four-mobile-dark.png`, fullPage: true });

  await Promise.all(pages.map(autoplay));
  // Mid-game, on the phone.
  await wait(friends[0], () => window.ddp.match.state.tokens.flat().filter((r) => r >= 0).length >= 6, undefined, 120_000);
  // Bo only rolls now, until a token waits to be picked.
  await friends[0].evaluate(() => {
    clearInterval(window.__autoplay);
    window.__autoplay = setInterval(() => document.querySelector("#ld-roll:not(:disabled)")?.click(), 30);
  });
  await wait(friends[0], () => document.querySelectorAll(".hit-token").length > 1 || window.ddp.match.phase !== "playing", undefined, 120_000);
  await stopAutoplay(friends[0]);
  await friends[0].waitForTimeout(300);
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-5-four-mobile-midgame.png`, fullPage: true });
  await autoplay(friends[0]);
  for (const p of pages) await wait(p, () => window.ddp.match.phase === "over", undefined, 240_000);
  await Promise.all(pages.map(stopAutoplay));
  const states = await Promise.all(pages.map(state));
  for (const st of states.slice(1)) assert.deepEqual(st, states[0], "all four browsers end on the same state");
  const st = states[0];
  assert.equal(st.order.length, 4);
  for (const p of st.order.slice(0, 3)) assert.ok(st.tokens[p].every((r) => r === 56), "three players finished for places");
  for (const p of pages) {
    await p.locator("#ld-standings").waitFor();
    assert.equal(await p.locator("#ld-standings li").count(), 4);
    assert.match(await p.locator("#ld-standings").innerText(), /1st[\s\S]*2nd[\s\S]*3rd[\s\S]*4th/);
  }
  assert.ok(await resultInView(friends[0]), "the standings fit a phone without scrolling");
  await host.screenshot({ path: `${ARTIFACTS}/ld-6-four-over.png` });
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-7-four-over-mobile.png` });

  // All four agree to a rematch; partway in, one player leaves. The game
  // ends for everyone, and the screen says why and where everyone stood.
  for (const p of pages.slice(0, 3)) await p.click("#rematch");
  await friends[2].locator("#rematch-status").filter({ hasText: "Ada, Bo and Cy want a rematch!" }).waitFor();
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Di" }).waitFor();
  await friends[2].click("#rematch");
  for (const p of pages) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await Promise.all(pages.map(autoplay));
  await wait(host, () => window.ddp.match.state.ply >= 40, undefined, 60_000);
  await Promise.all(pages.map(stopAutoplay));
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Cy (left the game|.*lost)/);
    assert.match(await p.locator("#ld-ended").innerText(), /game is over for all 4 of you[\s\S]*Cy: \d\/4 home \(left\)/);
  }
  await friends[0].screenshot({ path: `${ARTIFACTS}/ld-8-four-left-mobile.png` });
  assert.deepEqual(errors, []);
});
