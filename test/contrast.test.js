// WCAG 2.2 AA contrast for the theme tokens in public/engine/theme.css, light
// and dark: 4.5:1 for text, 3:1 for the edges of controls (1.4.3 and 1.4.11).
// https://www.w3.org/WAI/WCAG22/quickref/#contrast-minimum
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/engine/theme.css", import.meta.url), "utf8");

// The custom properties of the first `<selector> { … }` block.
function tokens(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `theme.css has a ${selector} block`);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

function luminance(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${hex} is a #rrggbb colour`);
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  light: tokens(":root"),
  dark: tokens(':root[data-theme="dark"]'),
};

// [foreground, background, minimum ratio]
const PAIRS = [
  ["text", "bg", 4.5],
  ["text", "surface", 4.5],
  ["muted", "bg", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "surface-2", 4.5], // option hints, the "Coming soon" badge
  ["accent-ink", "accent", 4.5], // primary buttons, badges, selected options
  ["accent-ink", "accent-2", 4.5], // ink on a teal disc
  ["accent-text", "bg", 4.5],
  ["accent-text", "surface", 4.5],
  ["accent-2-text", "bg", 4.5],
  ["accent-2-text", "surface", 4.5],
  ["control-border", "surface", 3], // inputs and segmented options in a card
  ["control-border", "bg", 3], // an input's own fill
];

test("the contrast formula matches WCAG's reference values", () => {
  assert.equal(contrast("#000000", "#ffffff"), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54");
});

for (const [theme, t] of Object.entries(THEMES)) {
  test(`${theme} tokens meet WCAG AA contrast`, () => {
    for (const [fg, bg, min] of PAIRS) {
      assert.ok(t[fg] && t[bg], `${theme} defines --${fg} and --${bg}`);
      const ratio = contrast(t[fg], t[bg]);
      assert.ok(ratio >= min, `${theme}: --${fg} ${t[fg]} on --${bg} ${t[bg]} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  });
}

test("dark mode from the OS and from the toggle use the same tokens", () => {
  const start = css.indexOf("@media (prefers-color-scheme: dark)");
  const block = css.slice(start, css.indexOf("}\n}", start));
  const fromOs = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  assert.deepEqual(fromOs, THEMES.dark);
});
