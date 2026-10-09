// The README lists every ready game, and the docs' relative links point at
// files that exist.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

const docs = [
  "README.md",
  "CONTRIBUTING.md",
  ...readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`),
];

test("readme: lists every ready game in games.json", () => {
  const readme = read("README.md");
  const ready = JSON.parse(read("public/games.json")).games.filter((g) => g.status === "ready");
  assert.ok(ready.length >= 10, "found the ready games");
  for (const game of ready) assert.ok(readme.includes(game.name), `README lists ${game.name}`);
});

test("readme: relative links in README, CONTRIBUTING and docs/ point at existing files", () => {
  for (const doc of docs) {
    const links = [...read(doc).matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    for (const link of links) {
      if (/^[a-z]+:/i.test(link) || link.startsWith("#")) continue;
      const target = path.join(ROOT, path.dirname(doc), link.split("#")[0]);
      assert.ok(existsSync(target), `${doc} links to ${link}`);
    }
  }
});
