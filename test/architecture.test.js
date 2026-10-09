// The import graph in ARCHITECTURE.md must name every module in public/ and
// server/, so it can't go stale when one is added. Modules are the .js files
// (tests aside) and every package they import; node: built-ins are left out.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const IMPORT = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

const sources = (dir) =>
  readdirSync(path.join(ROOT, dir), { recursive: true })
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
    .map((f) => path.join(dir, f));

// The diagram's subgraph and box label for a module, given as a path from the repo root.
function placeOf(file) {
  const [top, dir, ...rest] = file.split(path.sep);
  if (top === "server") return { box: "server", label: [dir, ...rest].join("/") };
  if (rest.length === 0) return { box: "pages", label: dir };
  if (dir === "engine") return { box: "engine", label: rest.join("/") };
  if (rest.join("/") === "main.js") return { box: "pages", label: "main.js" };
  return { box: "game", label: rest.join("/") };
}

function modules() {
  const found = new Map();
  for (const file of [...sources("public"), ...sources("server")]) {
    found.set(file, placeOf(file));
    for (const m of readFileSync(path.join(ROOT, file), "utf8").matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith("/")) found.set(path.join("public", spec), placeOf(path.join("public", spec)));
      else if (spec.startsWith(".")) found.set(path.join(path.dirname(file), spec), placeOf(path.join(path.dirname(file), spec)));
      else found.set(spec, { box: placeOf(file).box, label: spec });
    }
  }
  return found;
}

// The labels in each subgraph of the import-graph diagram, by subgraph id.
function diagram() {
  const doc = readFileSync(path.join(ROOT, "ARCHITECTURE.md"), "utf8");
  const block = doc.slice(doc.indexOf("**Import graph.**")).match(/```mermaid\n([\s\S]*?)```/)[1];
  const boxes = new Map();
  let box = null;
  for (const line of block.split("\n")) {
    const open = line.match(/^\s*subgraph (\w+)/);
    if (open) boxes.set((box = open[1]), new Set());
    else if (/^\s*end\s*$/.test(line)) box = null;
    else if (box) for (const [, label] of line.matchAll(/\["([^"]+)"\]/g)) boxes.get(box).add(label.split("<br>")[0]);
  }
  return boxes;
}

test("the import graph in ARCHITECTURE.md names every module", () => {
  const boxes = diagram();
  const missing = [];
  for (const [module, { box, label }] of modules()) {
    if (boxes.get(box)?.has(label)) continue;
    const id = `${box[0]}_${label.replace(/\.js$/, "").replace(/\W/g, "_")}`;
    missing.push(`${module} is missing from the import-graph diagram in ARCHITECTURE.md: add the line  ${id}["${label}"]  inside "subgraph ${box}" (and an arrow for each import)`);
  }
  assert.deepEqual(missing, []);
});
