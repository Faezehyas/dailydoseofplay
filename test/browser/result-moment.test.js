// Headless-browser test for the result moment (engine/celebrate.js): every
// game, played to the end against the robot, celebrates as its result panel
// opens, with its own chime, and nothing moves with reduced motion; in a
// friend game of Tic Tac Toe each browser plays its own player's moment, and
// nothing plays when muted. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../helpers.js";
import { pw, wait } from "./ludo.shared.js";

const GAMES = [
  ["tic-tac-toe", "paper"],
  ["connect-4", "plastic"],
  ["gomoku", "paper"],
  ["chess", "wood"],
  ["checkers", "wood"],
  ["backgammon", "wood"],
  ["sea-battle", "water"],
  ["chutes-and-ladders", "bell"],
  ["dots-and-boxes", "paper"],
  ["ludo", "wood"],
];
// The outcome each title stands for: someone else's win is "over" with more than two players.
const OUTCOME = { "You won": "win", "You lost": "loss", Draw: "draw" };

// Plays this page's side with the game's own robot, at once, until the match ends.
function autoplay(page, slug) {
  return page.evaluate(async (slug) => {
    const { chooseMove } = await import(`/${slug}/robot.js`);
    window.__autoplay = setInterval(() => {
      const match = window.ddp.match;
      if (match.phase === "placing" && !match.locked) document.querySelector("#ready")?.click();
      if (match.canFire?.()) {
        const { weapon, target, dir } = chooseMove(match.state, match.me);
        match.fire(weapon, target, 1, dir);
      } else if (match.canMove?.()) match.play({ ...chooseMove(match.state, match.me), ms: 1 });
    }, 10);
  }, slug);
}

async function playToTheEnd(browser, base, slug) {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  await ctx.addInitScript(() => (globalThis.ddpRobotPace = 0.1));
  await ctx.addInitScript(() => (window.ddpSounds = []));
  // Two robots in the games for up to four, so a robot's win is "over" for you.
  await ctx.addInitScript(() => localStorage.setItem("ddp-ludo-settings", JSON.stringify({ robots: 2 })));
  await ctx.addInitScript(() => localStorage.setItem("ddp-cl-settings", JSON.stringify({ robots: 2 })));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${slug}: ${e.message}`));
  await page.goto(`${base}/${slug}/?robot=1`);
  await wait(page, () => !!window.ddp.match);
  await autoplay(page, slug);
  await page.locator("#result-panel.celebrate").waitFor({ timeout: 180_000 });
  await page.evaluate(() => clearInterval(window.__autoplay));
  return { page, ctx, errors };
}

test("every game celebrates the end of a robot game with its own chime, and nothing moves with reduced motion", { skip: !pw && "Playwright not installed", timeout: 900_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  for (const [slug, flavour] of GAMES) {
    const { page, ctx, errors } = await playToTheEnd(browser, srv.base, slug);
    const title = await page.locator("#result").innerText();
    const outcome = OUTCOME[title] ?? "over";
    assert.ok(await page.locator(`#result-panel.celebrate-${outcome}`).count(), `${slug}: "${title}" celebrates as ${outcome}`);
    const sounds = await page.evaluate(() => window.ddpSounds);
    assert.deepEqual(sounds.filter((n) => /^(win|loss|draw|over)-/.test(n)), [`${outcome}-${flavour}`], `${slug}: one chime, in its flavour`);
    assert.ok(!sounds.some((n) => /^(win|lose|draw)$/.test(n)), `${slug}: no end tune of its own`);
    const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.animationName?.startsWith("celebrate")).length + document.querySelectorAll(".celebrate-dot").length);
    assert.equal(moving, 0, `${slug}: nothing moves with reduced motion`);
    assert.deepEqual(errors, []);
    await ctx.close();
  }
});

// Plays these cells in turn, each by whichever friend is on move.
async function playCells(pages, cells) {
  for (const cell of cells) {
    const n = await pages[0].evaluate(() => window.ddp.match.state.moves.length);
    const mover = (await Promise.all(pages.map((p) => p.evaluate(() => window.ddp.match.canMove())))).indexOf(true);
    await pages[mover].evaluate((cell) => window.ddp.match.play({ cell, ms: 0 }), cell);
    for (const p of pages) await wait(p, (n) => window.ddp.match.state.moves.length > n, n);
  }
}

test("in a friend game each browser plays its own moment: the winner's line lights up and dots rise, the loser's board dims, a draw pulses the pills", { skip: !pw && "Playwright not installed", timeout: 120_000 }, async (t) => {
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox", "--disable-background-timer-throttling"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const errors = [];
  async function open(name, nickname, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, reducedMotion: "no-preference", ...opts });
    await ctx.addInitScript((n) => localStorage.setItem("ddp-name", n), nickname);
    await ctx.addInitScript(() => (window.ddpSounds = []));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    return page;
  }
  const host = await open("host", "Ada");
  await host.addInitScript(() => localStorage.setItem("ddp-ttt-settings", JSON.stringify({ size: 3, moveSeconds: 0, gameSeconds: 0, first: "host" })));
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await host.click("#play-friend");
  const invite = await host.locator("#invite-link").inputValue();
  const guest = await open("guest", "Bo", { colorScheme: "dark" });
  await guest.goto(invite.replace(/^https?:\/\/[^/]+/, srv.base));
  await guest.click("#join-room");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match?.phase === "playing");
  // The friend mutes: the moment still shows, without its chime.
  await guest.click("#sound-toggle");
  const chimes = (page) => page.evaluate(() => window.ddpSounds.filter((n) => /^(win|loss|draw|over)-/.test(n)));
  const celebrating = (page) => page.evaluate(() => [...document.querySelectorAll("[class*=celebrate]")].map((n) => n.getAttribute("class").match(/celebrate[-\w]*/g).join(" ")));

  // Ada lines up the top row.
  await playCells([host, guest], [0, 3, 1, 4, 2]);
  await host.locator("#result-panel.celebrate-win").waitFor();
  await guest.locator("#result-panel.celebrate-loss").waitFor();
  assert.deepEqual(
    await host.evaluate(() => [...document.querySelectorAll(".celebrate-lit")].map((n) => [n.dataset.i, n.style.getPropertyValue("--i")])),
    [["0", "0"], ["1", "1"], ["2", "2"]],
    "the winning line lights up cell by cell",
  );
  assert.equal(await host.locator(".celebrate-burst .celebrate-dot").count(), 12, "three sets of the logo's four dots");
  const running = (page) => page.evaluate(() => [...new Set(document.getAnimations().map((a) => a.animationName).filter((n) => n?.startsWith("celebrate")))].sort());
  assert.deepEqual(await running(host), ["celebrate-light", "celebrate-rise"]);
  assert.deepEqual(await chimes(host), ["win-paper"]);
  assert.ok(await guest.locator("#ttt-board.celebrate-dim").count(), "the loser's board dims");
  assert.deepEqual(await running(guest), ["celebrate-dim", "celebrate-fade"]);
  assert.equal(await guest.locator(".celebrate-lit, .celebrate-dot").count(), 0, "no lights or dots for a loss");
  assert.deepEqual(await chimes(guest), [], "nothing plays when muted");
  await host.locator(".celebrate-burst").waitFor({ state: "detached" });

  // A rematch clears the moment; a full board without a line is a draw.
  await host.click("#rematch");
  await guest.click("#rematch");
  for (const p of [host, guest]) await wait(p, () => window.ddp.match.m === 2 && window.ddp.match.phase === "playing");
  assert.deepEqual(await celebrating(host), []);
  assert.deepEqual(await celebrating(guest), []);
  await playCells([host, guest], [0, 4, 8, 1, 7, 6, 2, 5, 3]);
  for (const p of [host, guest]) {
    await p.locator("#result-panel.celebrate-draw").waitFor();
    assert.equal(await p.locator(".pb-who.celebrate-pulse").count(), 2, "both pills pulse");
    assert.deepEqual(await running(p), ["celebrate-pulse"]);
  }
  assert.deepEqual(await chimes(host), ["win-paper", "draw-paper"]);
  assert.deepEqual(await chimes(guest), []);
  assert.deepEqual(errors, []);
});
