// Third-party recordings keep their own terms, so every sounds/ folder must
// credit each audio file in its LICENSE.txt, one line starting with its name.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const AUDIO = /\.(mp3|ogg|wav|m4a|aac|opus|flac|webm)$/;

const folders = readdirSync(PUBLIC, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(path.join(PUBLIC, d.name, "sounds")))
  .map((d) => path.join(PUBLIC, d.name, "sounds"));

test("licenses: every sounds/ folder credits each audio file in LICENSE.txt", () => {
  assert.ok(folders.length >= 4, "found the sounds folders");
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
