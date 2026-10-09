import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrefs, loadPrefs } from "./prefs.js";

const DEFAULTS = { theme: "system", sound: true, volume: 100, motion: "system", askBeforeLeaving: true };

// localStorage's interface over a Map.
function storage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("normalizePrefs fills in defaults and drops anything invalid", () => {
  for (const raw of [null, undefined, "dark", 42, [], {}]) assert.deepEqual(normalizePrefs(raw), DEFAULTS, String(raw));
  assert.deepEqual(normalizePrefs({ theme: "dark", sound: false, volume: 35, motion: "reduce", askBeforeLeaving: false }), {
    theme: "dark",
    sound: false,
    volume: 35,
    motion: "reduce",
    askBeforeLeaving: false,
  });
  assert.deepEqual(normalizePrefs({ theme: "pink", sound: "no", volume: "50", motion: "slow", askBeforeLeaving: 0 }), DEFAULTS);
  assert.equal(normalizePrefs({ volume: 140 }).volume, 100);
  assert.equal(normalizePrefs({ volume: -3 }).volume, 0);
  assert.equal(normalizePrefs({ volume: 33.6 }).volume, 34);
  assert.equal(normalizePrefs({ volume: NaN }).volume, 100);
});

test("the old theme and sound keys move into ddp-settings, once", () => {
  const s = storage({ "ddp-theme": "dark", "ddp-sound": "off", "ddp-name": "Ada", "ddp-ttt-settings": '{"size":5}' });
  const prefs = loadPrefs(s);
  assert.deepEqual(prefs, { ...DEFAULTS, theme: "dark", sound: false });
  assert.deepEqual(JSON.parse(s.map.get("ddp-settings")), prefs);
  assert.equal(s.map.has("ddp-theme"), false);
  assert.equal(s.map.has("ddp-sound"), false);
  // The nickname and the games' settings keep their keys.
  assert.equal(s.map.get("ddp-name"), "Ada");
  assert.equal(s.map.get("ddp-ttt-settings"), '{"size":5}');
  assert.deepEqual(loadPrefs(s), prefs, "read back from ddp-settings");
});

test("each old key moves on its own, and sound on stays on", () => {
  const light = storage({ "ddp-theme": "light" });
  assert.deepEqual(loadPrefs(light), { ...DEFAULTS, theme: "light" });
  assert.deepEqual([...light.map.keys()], ["ddp-settings"]);
  const on = storage({ "ddp-sound": "on" });
  assert.deepEqual(loadPrefs(on), DEFAULTS);
  assert.deepEqual([...on.map.keys()], ["ddp-settings"]);
});

test("nothing is written for a visitor who never changed anything", () => {
  const s = storage();
  assert.deepEqual(loadPrefs(s), DEFAULTS);
  assert.equal(s.map.size, 0);
});

test("ddp-settings wins over old keys, and a broken value reads as the defaults", () => {
  const s = storage({ "ddp-settings": JSON.stringify({ theme: "light", volume: 20 }), "ddp-theme": "dark" });
  assert.deepEqual(loadPrefs(s), { ...DEFAULTS, theme: "light", volume: 20 });
  assert.deepEqual(loadPrefs(storage({ "ddp-settings": "{not json" })), DEFAULTS);
});
