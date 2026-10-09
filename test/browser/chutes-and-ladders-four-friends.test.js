// Headless-browser test for Chutes and Ladders: four friends in four browsers
// through the hub play a full game, then a rematch, then one leaves. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { ARTIFACTS, pw, wait, noHorizontalScroll, state, colours, spinUntilOver } from "./chutes-and-ladders.shared.js";

test("four friends fill a Chutes and Ladders room and play a full game, then a rematch", { skip: !pw && "Playwright not installed", timeout: 240_000 }, async (t) => {
  mkdirSync(ARTIFACTS, { recursive: true });
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    return page;
  }
  const host = await open("Ada");
  await host.goto(`${srv.base}/chutes-and-ladders/`);
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
  }
  // The fourth player fills the room, so the game starts by itself.
  const pages = [host, ...friends];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2, 3]);
  for (const p of pages) {
    assert.equal(await p.locator(".cl-board .pawn").count(), 4, "four pawns on the board");
    assert.equal(await p.locator(".pb-who").count(), 4);
    assert.equal(await p.locator("#score > div").count(), 4);
  }
  assert.match(await friends[1].locator(".pb-players").innerText(), /Cy \(you\)[\s\S]*Ada[\s\S]*Bo[\s\S]*Di/, "you first, then the others in seat order");
  const seen = await Promise.all(pages.map(colours));
  assert.deepEqual(seen[0], { Ada: "--accent --accent", Bo: "--accent-2 --accent-2", Cy: "--cl-p2 --cl-p2", Di: "--cl-p3 --cl-p3" }, "colours go by seat");
  for (const c of seen.slice(1)) assert.deepEqual(c, seen[0], "every screen shows each player in the same colour");
  assert.ok(await noHorizontalScroll(friends[0]), "four players fit a 360 px phone");
  await friends[0].screenshot({ path: `${ARTIFACTS}/cl-7-four-mobile-dark.png`, fullPage: true });

  async function playOut() {
    await Promise.all(pages.map((p) => spinUntilOver(p)));
    for (const p of pages) await wait(p, () => window.ddp.match.phase === "over", undefined, 60_000);
    const states = await Promise.all(pages.map(state));
    for (const st of states.slice(1)) assert.deepEqual(st, states[0], "all four browsers end on the same state");
    assert.equal(states[0].pos[states[0].winner], 100);
    assert.ok(states[0].spins.every((n) => n > 0), "everyone spun");
    return states[0];
  }
  const won = await playOut();
  const winnerPage = pages[won.winner];
  await winnerPage.locator("#result").filter({ hasText: "You won" }).waitFor();
  for (const p of pages.filter((p) => p !== winnerPage)) {
    await p.locator("#result-reason").waitFor();
    assert.match(await p.locator("#result-reason").innerText(), /reached 100 in \d+ spins?[\s\S]*Behind: .* and .*/);
  }
  await host.screenshot({ path: `${ARTIFACTS}/cl-8-four-over.png`, fullPage: true });

  // A rematch needs all four.
  for (const p of pages.slice(0, 3)) await p.click("#rematch");
  await friends[2].locator("#rematch-status").filter({ hasText: "Ada, Bo and Cy want a rematch!" }).waitFor();
  await host.locator("#rematch-status").filter({ hasText: "Waiting for Di" }).waitFor();
  await friends[2].click("#rematch");
  for (const p of pages) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  await playOut();

  // One player leaves: the game ends for the others.
  await friends[1].close();
  for (const p of [host, friends[0], friends[2]]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Cy (left the game|.*lost)/);
  }
  assert.deepEqual(errors, []);
});
