// Headless-browser test: every sound of every game, and the engine's result
// chimes (engine/chimes.js), lands at its role's loudness (engine/sound.js),
// so no sound is much louder or quieter than the others that do the same
// job, here or in another game. Each sound is
// rendered offline through the site's output, every recording and every
// synthesized stand-in, and measured as the ear hears it (engine/loudness.js).
// Random parts are seeded and averaged, so the result is the same every run.
// Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { startServer } from "../helpers.js";
import { pw } from "./ludo.shared.js";

const PUBLIC = new URL("../../public/", import.meta.url);
const GAMES = readdirSync(PUBLIC, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/sounds.js`, PUBLIC)))
  .map((d) => d.name);
const SOURCES = [...GAMES.map((g) => [g, `/${g}/sounds.js`]), ["engine", "/engine/chimes.js"]];

async function measure(page, url) {
  return page.evaluate(async (url) => {
    const { sounds } = await import(url);
    const { ROLES } = await import("/engine/sound.js");
    const { loudness } = await import("/engine/loudness.js");
    const random = Math.random;
    // mulberry32: a tiny seeded random, so noise and jitter repeat.
    const seeded = (seed) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const rows = [];
    try {
      for (const name of sounds.names) {
        const def = sounds.defs[name];
        const variants = [...(def.samples ?? []).keys(), ...(def.synth ? ["synth"] : [])];
        for (const variant of variants) {
          let sum = 0;
          let peak = 0;
          const seeds = variant === "synth" ? [1, 2, 3, 4, 5, 6] : [1];
          for (const seed of seeds) {
            Math.random = seeded(seed);
            const { samples, sampleRate } = await sounds.render(name, { variant });
            sum += loudness(samples, sampleRate);
            for (const v of samples) peak = Math.max(peak, Math.abs(v));
          }
          rows.push({ name, variant, role: def.role, offset: def.offset ?? 0, trim: def.trim ?? 0, lu: sum / seeds.length, target: ROLES[def.role] + (def.offset ?? 0), peak });
        }
      }
    } finally {
      Math.random = random;
    }
    return rows;
  }, url);
}

test("every game's sounds play at their role's loudness", { skip: !pw && "Playwright not installed", timeout: 300_000 }, async (t) => {
  assert.ok(GAMES.length >= 7, `found the games with sounds: ${GAMES.join(" ")}`);
  const { TOLERANCE, MAX_OFFSET } = await import("../../public/engine/sound.js");
  const srv = await startServer();
  const browser = await pw.chromium.launch({ args: ["--no-sandbox"] });
  t.after(async () => {
    await browser.close();
    await srv.close();
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${srv.base}/`);

  const off = [];
  const all = {};
  for (const [game, url] of SOURCES) {
    const rows = (all[game] = await measure(page, url));
    assert.ok(rows.length, `${game} has sounds`);
    for (const r of rows) {
      const what = `${game}/${r.name} (${r.variant === "synth" ? "synthesized" : `recording ${r.variant + 1}`})`;
      const miss = r.lu - r.target;
      if (Math.abs(r.offset) > MAX_OFFSET) off.push(`${what}: offset ${r.offset} dB is more than ${MAX_OFFSET} dB from its role; pick another role`);
      if (!(Math.abs(miss) <= TOLERANCE)) {
        const fix = r.variant === "synth" ? `set trim to ${(r.trim - miss).toFixed(1)}` : "check the recording (it is levelled as it loads)";
        off.push(`${what}: ${r.lu.toFixed(1)} LUFS, ${r.role}${r.offset ? ` ${r.offset > 0 ? "+" : ""}${r.offset}` : ""} wants ${r.target} ±${TOLERANCE}: ${fix}`);
      }
      if (r.peak >= 1) off.push(`${what}: peaks at full scale on its own`);
    }
  }
  assert.deepEqual(off, [], `sounds off their level:\n${off.join("\n")}`);
  assert.deepEqual(errors, []);

  // Issue #28: Ludo's die and a token's hop do the same job, so they sound
  // about as loud, the recording and its stand-in alike.
  const ludo = all.ludo;
  const hop = ludo.find((r) => r.name === "hop").lu;
  for (const die of ludo.filter((r) => r.name === "dice")) {
    assert.ok(Math.abs(die.lu - hop) <= 2 * TOLERANCE, `Ludo die (${die.variant}) ${die.lu.toFixed(1)} vs hop ${hop.toFixed(1)} LUFS`);
  }
});
