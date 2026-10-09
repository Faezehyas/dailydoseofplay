// Every game plays its sounds through the engine (engine/sound.js), from its
// own sounds.js, so all of them share one output and one loudness scale. A
// game that opened its own audio context or output would bypass the levels.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const PUBLIC = new URL("../public/", import.meta.url);
const games = readdirSync(PUBLIC, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "engine" && existsSync(new URL(`${d.name}/main.js`, PUBLIC)));

test("games make sound only through the engine, from their sounds.js", () => {
  const problems = [];
  for (const { name } of games) {
    for (const file of readdirSync(new URL(`${name}/`, PUBLIC)).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))) {
      const code = readFileSync(new URL(`${name}/${file}`, PUBLIC), "utf8");
      const where = `${name}/${file}`;
      if (/AudioContext|\.destination\b/.test(code)) problems.push(`${where} opens its own audio output`);
      if (file !== "sounds.js" && /engine\/(sound|synth)\.js/.test(code)) problems.push(`${where} imports the sound engine; play through ./sounds.js`);
    }
    const sounds = new URL(`${name}/sounds.js`, PUBLIC);
    if (existsSync(sounds)) {
      const code = readFileSync(sounds, "utf8");
      if (!/export const sounds = defineSounds\(/.test(code)) problems.push(`${name}/sounds.js does not export its defineSounds() as \`sounds\``);
    }
  }
  assert.deepEqual(problems, []);
});
