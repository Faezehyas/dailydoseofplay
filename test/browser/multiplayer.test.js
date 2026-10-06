// Headless-browser test for rooms of more than two players. No real game
// allows that yet, so this serves a copy of public/ that adds the test-only
// "party" game (test/fixtures/party, up to three players). Three browser
// contexts meet through the invite link, connect over real WebRTC through the
// host, play matches on shared dice, and see a player leave. Skips if
// Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { startServer } from "../helpers.js";
import { PUBLIC_DIR } from "../../server/app.js";

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
const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 20_000 });

function partySite() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ddp-party-"));
  for (const entry of readdirSync(PUBLIC_DIR)) {
    if (entry !== "games.json") symlinkSync(path.join(PUBLIC_DIR, entry), path.join(dir, entry));
  }
  symlinkSync(path.resolve("test/fixtures/party"), path.join(dir, "party"));
  const registry = JSON.parse(readFileSync(path.join(PUBLIC_DIR, "games.json"), "utf8"));
  registry.games.push({ slug: "party", name: "Party", status: "ready", players: "2-3 players", maxPlayers: 3, description: "Test game." });
  writeFileSync(path.join(dir, "games.json"), JSON.stringify(registry));
  return dir;
}

async function setup(t) {
  const dir = partySite();
  const srv = await startServer({ publicDir: dir });
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const errors = [];
  async function open(nickname) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${nickname}: ${e.message}`));
    return page;
  }
  return { srv, open, errors };
}

// Everyone rolls in turn until the match is over; returns the final states.
async function playOut(pages) {
  for (let guard = 0; guard < 100; guard++) {
    const phases = await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.phase)));
    assert.ok(!phases.includes("aborted"), "match aborted");
    if (phases.every((ph) => ph === "over")) break;
    const can = await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.canMove())));
    const k = can.indexOf(true);
    if (k < 0) {
      await pages[0].waitForTimeout(20);
      continue;
    }
    const before = await pages[k].evaluate(() => window.ddp.match.state.log.length);
    await pages[k].click("#move");
    for (const p of pages) await wait(p, (n) => window.ddp.match.state.log.length > n, before);
  }
  return Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.state)));
}

test("three friends fill a room through the invite link, play on shared dice, rematch, and see a player leave", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/party/`);
  assert.equal(await host.locator("#play-friend").innerText(), "Play with friends");
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);
  assert.match(await host.locator("#roster").innerText(), /Ada\s+host/);
  assert.equal(await host.locator("#start-game").isDisabled(), true, "can't start alone");

  const bo = await open("Bo");
  await bo.goto(invite);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  assert.equal(await host.locator("#start-game").innerText(), "Start game (2 players)");
  await bo.locator("#lobby-status", { hasText: "Waiting for Ada to start (2 players in)" }).waitFor();

  // The third player fills the room, so the game starts by itself.
  const cy = await open("Cy");
  await cy.goto(invite);
  const pages = [host, bo, cy];
  for (const p of pages) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.deepEqual(await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.session.index))), [0, 1, 2]);
  assert.equal(await cy.locator("#party-players").innerText(), "Ada, Bo, Cy (you)");
  assert.equal(await host.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal scroll");

  const [a, b, c] = await playOut(pages);
  assert.deepEqual(b, a, "Bo agrees with Ada");
  assert.deepEqual(c, a, "Cy agrees with Ada");
  assert.deepEqual(new Set(a.log.map(([seat]) => seat)), new Set([0, 1, 2]), "everyone rolled");

  // The room was freed when the game started.
  const late = await open("Dee");
  await late.goto(invite);
  await late.locator(".notice", { hasText: "doesn't exist any more" }).waitFor();

  // A rematch needs all three votes.
  await host.click("#rematch");
  await bo.click("#rematch");
  await cy.locator("#party-status", { hasText: "Rematch votes: 2" }).waitFor();
  assert.equal(await host.evaluate(() => window.ddp.match.m), 1);
  await cy.click("#rematch");
  for (const p of pages) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  const [a2, b2, c2] = await playOut(pages);
  assert.deepEqual([b2, c2], [a2, a2]);

  // One player leaving ends the game for the others, who are told who left.
  await cy.close();
  for (const p of [host, bo]) {
    await p.locator("#ended").waitFor({ timeout: 20_000 });
    assert.match(await p.locator("#ended").innerText(), /Cy (left the game|.*lost)/);
  }
  assert.deepEqual(errors, []);
});

test("the host can start before the room is full; a guest who leaves the waiting room drops off the list", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const host = await open("Ada");
  await host.goto(`${srv.base}/party/`);
  await host.click("#play-friend");
  await host.locator("#room-code").waitFor();
  const invite = (await host.locator("#invite-link").inputValue()).replace(/^https?:\/\/[^/]+/, srv.base);

  const quitter = await open("Quinn");
  await quitter.goto(invite);
  await host.locator("#roster li.ready", { hasText: "Quinn" }).waitFor();
  await quitter.close();
  await host.locator("#toast", { hasText: "Quinn left. The invite link still works." }).waitFor();
  assert.doesNotMatch(await host.locator("#roster").innerText(), /Quinn/);
  assert.equal(await host.locator("#start-game").isDisabled(), true);

  const bo = await open("Bo");
  await bo.goto(invite);
  await host.locator("#roster li.ready", { hasText: "Bo" }).waitFor();
  await host.click("#start-game");
  for (const p of [host, bo]) await wait(p, () => window.ddp.match?.phase === "playing");
  assert.equal(await bo.evaluate(() => window.ddp.session.players.length), 2);
  const [a, b] = await playOut([host, bo]);
  assert.deepEqual(b, a);

  // The host leaving ends it for the guest.
  await host.click("#leave");
  await bo.locator("#ended", { hasText: "Ada left the game." }).waitFor({ timeout: 20_000 });
  assert.deepEqual(errors, []);
});

test("against robots (straight from a ?robot link), every robot seat plays", { skip: !pw && "Playwright not installed", timeout: 60_000 }, async (t) => {
  const { srv, open, errors } = await setup(t);
  const page = await open("Ada");
  await page.goto(`${srv.base}/party/?robot`);
  await wait(page, () => window.ddp.match?.phase === "playing");
  assert.equal(await page.locator("#party-players").innerText(), "Ada (you), Robot 1, Robot 2");
  const [state] = await playOut([page]);
  assert.equal(state.players, 3);
  assert.equal(await page.evaluate(() => window.ddp.robots.length), 2);
  for (const k of [0, 1]) assert.deepEqual(await page.evaluate((k) => window.ddp.robots[k].match.state, k), state, `robot ${k + 1} agrees`);
  assert.deepEqual(errors, []);
});
