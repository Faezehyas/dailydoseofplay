// Third-party recordings keep their own terms, so every sounds/ folder must
// credit each audio file in its LICENSE.txt, one line starting with its name.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const AUDIO = /\.(mp3|ogg|wav|m4a|aac|opus|flac|webm)$/;

// Every sounds/ folder under public/: a game's, or the card games' shared one in engine/cards/.
const folders = readdirSync(PUBLIC, { recursive: true })
  .filter((f) => path.basename(f) === "sounds" && statSync(path.join(PUBLIC, f)).isDirectory())
  .map((f) => path.join(PUBLIC, f));

test("licenses: every sounds/ folder credits each audio file in LICENSE.txt", () => {
  assert.ok(folders.length >= 5, `found the sounds folders: ${folders.map((f) => path.relative(PUBLIC, f)).join(" ")}`);
  assert.ok(folders.some((f) => path.relative(PUBLIC, f) === path.join("engine", "cards", "sounds")), "the card games' shared recordings");
  for (const dir of folders) {
    const where = path.relative(PUBLIC, dir);
    const license = path.join(dir, "LICENSE.txt");
    assert.ok(existsSync(license), `${where}/LICENSE.txt`);
    const credits = readFileSync(license, "utf8");
    for (const file of readdirSync(dir).filter((f) => AUDIO.test(f))) {
      const name = file.replace(/[.]/g, "\\.");
      assert.match(credits, new RegExp(`^${name}\\s`, "m"), `${where}/${file} credited`);
    }
  }
});
