// Playing-card art for the standard deck (faces.js), drawn as inline SVG:
// suit pips, the faces (large corner indices, pip layouts, and original court
// figures drawn once per rank and mirrored like a real double-headed card)
// and the back. Shapes live once in a hidden <svg> of symbols; a card is a
// few <use>s. Colours come from cards.css: a card's suit colour is --suit,
// set by its s-0…s-3 class.
import { suitOf, rankOf, RANK_NAMES } from "./faces.js";

// Suit pips in a 20×20 box around 0,0: spade, heart, diamond, club.
const SUIT_SHAPES = [
  '<path d="M0-9.4C1.8-6.6 9-2.6 9 1.8C9 4.6 7 6.4 4.6 6.4C3 6.4 1.8 5.6 1.1 4.6C1.4 6.6 2.4 8.2 3.6 9.4H-3.6C-2.4 8.2-1.4 6.6-1.1 4.6C-1.8 5.6-3 6.4-4.6 6.4C-7 6.4-9 4.6-9 1.8C-9-2.6-1.8-6.6 0-9.4Z"/>',
  '<path d="M0 8.8C-1.6 6.8-9.4 1.6-9.4-3.2C-9.4-6.5-7-8.8-4.4-8.8C-2.4-8.8-0.8-7.6 0-5.8C0.8-7.6 2.4-8.8 4.4-8.8C7-8.8 9.4-6.5 9.4-3.2C9.4 1.6 1.6 6.8 0 8.8Z"/>',
  '<path d="M0-9.6C2-6 4.6-2.8 7.6 0C4.6 2.8 2 6 0 9.6C-2 6-4.6 2.8-7.6 0C-4.6-2.8-2-6 0-9.6Z"/>',
  '<circle cx="0" cy="-4.4" r="4.3"/><circle cx="-4.7" cy="1.6" r="4.3"/><circle cx="4.7" cy="1.6" r="4.3"/><circle cx="0" cy="0.4" r="2.4"/><path d="M-1.2 1.5C-1.1 5.2-2.2 7.8-4 9.4H4C2.2 7.8 1.1 5.2 1.2 1.5Z"/>',
];

// The upper half of each court card (60×54, the card's centre line at the
// bottom); the lower half is the same, turned round.
const KING = `
  <path class="robe" d="M6 54C8 42 16 36 30 36C44 36 52 42 54 54Z"/>
  <path class="fur" d="M17 39Q30 46 43 39L45 43.5Q30 51.5 15 43.5Z"/>
  <g class="fur-dot"><circle cx="21" cy="44" r=".9"/><circle cx="30" cy="47" r=".9"/><circle cx="39" cy="44" r=".9"/></g>
  <path class="gold line" d="M48.5 54L50.5 31"/><circle class="gold" cx="50.7" cy="28.6" r="3.1"/>
  <circle class="skin" cx="30" cy="22" r="8.6"/>
  <path class="beard" d="M21.6 23Q21.4 36.5 30 39Q38.6 36.5 38.4 23Q34.6 30.5 30 30.5Q25.4 30.5 21.6 23Z"/>
  <path class="beard" d="M25 27.4Q30 24.6 35 27.4Q30 26.6 25 27.4Z"/>
  <circle class="ink" cx="26.8" cy="20.6" r="1"/><circle class="ink" cx="33.2" cy="20.6" r="1"/>
  <circle class="cheek" cx="24.9" cy="24" r="1.5"/><circle class="cheek" cx="35.1" cy="24" r="1.5"/>
  <path class="gold" d="M20.4 15.4L20.8 5.2L25.4 9.8L30 2.6L34.6 9.8L39.2 5.2L39.6 15.4Z"/>
  <rect class="gold-dark" x="20.4" y="13" width="19.2" height="3" rx="1"/>
  <circle class="gem" cx="30" cy="9.4" r="1.4"/>`;

const QUEEN = `
  <path class="hair-q" d="M19.4 24C18 34 19 42 22 46.5H38C41 42 42 34 40.6 24C40.6 14 35 11 30 11C25 11 19.4 14 19.4 24Z"/>
  <path class="robe" d="M8 54C10 43 18 38 30 38C42 38 50 43 52 54Z"/>
  <path class="skin" d="M23.2 38.4L30 46L36.8 38.4Z"/>
  <path class="gold line thin" d="M23.6 39.6Q30 47.4 36.4 39.6"/><circle class="gold" cx="30" cy="45.6" r="1.3"/>
  <circle class="skin" cx="30" cy="23" r="8"/>
  <path class="hair-q" d="M21.8 22.6Q23.6 14 30 14.4Q36.4 14 38.2 22.6Q34.4 17.6 30 18.2Q25.6 17.6 21.8 22.6Z"/>
  <circle class="ink" cx="27.2" cy="23.4" r=".95"/><circle class="ink" cx="32.8" cy="23.4" r=".95"/>
  <circle class="cheek" cx="25.6" cy="26.2" r="1.4"/><circle class="cheek" cx="34.4" cy="26.2" r="1.4"/>
  <path class="ink line thin" d="M28 27.8Q30 29.2 32 27.8"/>
  <path class="gold" d="M22.4 16Q30 10.2 37.6 16L36.2 12.4L33 13.6L30 9L27 13.6L23.8 12.4Z"/>
  <circle class="gem" cx="30" cy="12.6" r="1.1"/>
  <path class="leaf line" d="M12.5 46.5L15.5 54"/>
  <g class="petal"><circle cx="12" cy="40.6" r="2.3"/><circle cx="15.2" cy="43" r="2.3"/><circle cx="14" cy="46.6" r="2.3"/><circle cx="10" cy="46.6" r="2.3"/><circle cx="8.8" cy="43" r="2.3"/></g>
  <circle class="gold" cx="12" cy="44" r="1.5"/>`;

const JACK = `
  <path class="wood line" d="M11.5 54L9.6 30"/><path class="leaf" d="M9.4 31C5.6 27 6.4 22 9 19.6C11.8 22.4 12.6 27 9.4 31Z"/>
  <path class="robe" d="M7 54C9 43 17 37 30 37C43 37 51 43 53 54Z"/>
  <path class="fur" d="M16.6 40.4L20 44.6L23 40.8L26.2 45.4L30 41.2L33.8 45.4L37 40.8L40 44.6L43.4 40.4L44.6 44Q30 50.6 15.4 44Z"/>
  <circle class="skin" cx="30" cy="24.4" r="8"/>
  <path class="hair-j" d="M22 24.6Q21.4 17.2 30 16.8Q38.6 17.2 38 24.6Q36 20.6 30 21Q24 20.6 22 24.6Z"/>
  <circle class="ink" cx="27.2" cy="24.8" r=".95"/><circle class="ink" cx="32.8" cy="24.8" r=".95"/>
  <circle class="cheek" cx="25.5" cy="27.6" r="1.4"/><circle class="cheek" cx="34.5" cy="27.6" r="1.4"/>
  <path class="ink line thin" d="M28.2 29Q30 30.2 31.8 29"/>
  <path class="gold" d="M38.4 15.4C45 9.4 49.4 5.2 52.4 1.6C50.4 7.6 46.6 13 40.2 17.8Z"/>
  <path class="cap" d="M17.6 18.6C17.8 12.2 24 9.6 30.6 10.2C37.4 10.8 41.6 14 41 18.4C35 16.4 24 16.4 17.6 18.6Z"/>
  <rect class="gold-dark" x="18" y="16.6" width="23" height="2.4" rx="1.2"/>`;

const COURTS = { 10: JACK, 11: QUEEN, 12: KING };

// Inline styles for the shapes in symbols: a <use> clone doesn't match the page's class selectors.
const LOOK = {
  robe: "fill:var(--suit)",
  fur: "fill:#fffaf0;stroke:rgb(0 0 0/25%);stroke-width:.5",
  "fur-dot": "fill:#2b2b36",
  skin: "fill:var(--pc-skin);stroke:rgb(0 0 0/22%);stroke-width:.5",
  beard: "fill:var(--pc-beard)",
  "hair-q": "fill:var(--pc-hair-q)",
  "hair-j": "fill:var(--pc-hair-j)",
  ink: "fill:#2b2b36",
  cheek: "fill:var(--pc-cheek);opacity:.7",
  gold: "fill:var(--pc-gold)",
  "gold-dark": "fill:var(--pc-gold-dark)",
  gem: "fill:var(--suit)",
  cap: "fill:var(--pc-cap)",
  petal: "fill:var(--pc-petal)",
  leaf: "fill:var(--pc-leaf)",
  "gold line": "fill:none;stroke:var(--pc-gold);stroke-width:2;stroke-linecap:round",
  "gold line thin": "fill:none;stroke:var(--pc-gold);stroke-width:.8;stroke-linecap:round",
  "ink line thin": "fill:none;stroke:#2b2b36;stroke-width:.8;stroke-linecap:round",
  "leaf line": "fill:none;stroke:var(--pc-leaf);stroke-width:2;stroke-linecap:round",
  "wood line": "fill:none;stroke:var(--pc-wood);stroke-width:2;stroke-linecap:round",
  "back-bg": "fill:var(--pc-back)",
  "back-bg back-line": "fill:var(--pc-back);stroke:var(--pc-back-line)",
  "back-line": "stroke:var(--pc-back-line)",
  "back-dot": "fill:var(--pc-back-line);opacity:.7",
  "back-star": "fill:var(--pc-back-line)",
};
const styled = (markup) => markup.replace(/class="([^"]+)"/g, (all, cls) => (LOOK[cls] ? `style="${LOOK[cls]}"` : all));

// Pip centres for 2–10 in the card's 100×140 box; those below the middle are drawn upside down.
const L = 33;
const C = 50;
const R = 67;
const PIPS = {
  1: [[C, 27], [C, 113]],
  2: [[C, 27], [C, 70], [C, 113]],
  3: [[L, 27], [R, 27], [L, 113], [R, 113]],
  4: [[L, 27], [R, 27], [C, 70], [L, 113], [R, 113]],
  5: [[L, 27], [R, 27], [L, 70], [R, 70], [L, 113], [R, 113]],
  6: [[L, 27], [R, 27], [C, 48], [L, 70], [R, 70], [L, 113], [R, 113]],
  7: [[L, 27], [R, 27], [C, 48], [L, 70], [R, 70], [C, 92], [L, 113], [R, 113]],
  8: [[L, 27], [R, 27], [L, 55.3], [R, 55.3], [C, 70], [L, 84.7], [R, 84.7], [L, 113], [R, 113]],
  9: [[L, 27], [R, 27], [C, 41], [L, 55.3], [R, 55.3], [L, 84.7], [R, 84.7], [C, 99], [L, 113], [R, 113]],
};

const pip = (s, x, y, size, flip = false) =>
  `<use href="#pc-s${s}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}"${flip ? ` transform="rotate(180 ${x} ${y})"` : ""}/>`;

// The hidden symbols every card uses; added to the page once.
export function symbols() {
  const box = (id, vb, body) => `<symbol id="${id}" viewBox="${vb}">${body}</symbol>`;
  const star = Array.from({ length: 16 }, (_, i) => {
    const r = i % 2 ? 6.6 : 15;
    const a = (i * Math.PI) / 8 - Math.PI / 2;
    return `${(50 + r * Math.cos(a)).toFixed(2)} ${(70 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" L");
  const back = `
    <rect class="back-bg" x="0" y="0" width="100" height="140" rx="7"/>
    <rect class="back-line" x="5" y="5" width="90" height="130" rx="4.5" fill="none" stroke-width="1.6"/>
    <rect x="9" y="9" width="82" height="122" rx="3" fill="url(#pc-lattice)"/>
    <ellipse class="back-bg back-line" cx="50" cy="70" rx="22" ry="26" stroke-width="1.6"/>
    <ellipse class="back-line" cx="50" cy="70" rx="18.5" ry="22.5" fill="none" stroke-width=".8"/>
    <path class="back-star" d="M${star}Z"/>
    <circle class="back-bg" cx="50" cy="70" r="3.4"/>`;
  return styled(`<svg class="pc-symbols" aria-hidden="true" focusable="false" width="0" height="0" style="position:absolute">
    <defs>
      <pattern id="pc-lattice" width="10" height="10" patternUnits="userSpaceOnUse" x="9" y="9">
        <path class="back-line" d="M5 0L10 5L5 10L0 5Z" fill="none" stroke-width=".7"/>
        <circle class="back-dot" cx="5" cy="5" r="1.2"/><circle class="back-dot" cx="0" cy="0" r=".7"/><circle class="back-dot" cx="10" cy="0" r=".7"/><circle class="back-dot" cx="0" cy="10" r=".7"/><circle class="back-dot" cx="10" cy="10" r=".7"/>
      </pattern>
    </defs>
    ${SUIT_SHAPES.map((d, s) => box(`pc-s${s}`, "-10 -10 20 20", d)).join("")}
    ${Object.entries(COURTS).map(([r, body]) => box(`pc-c${r}`, "0 0 60 54", body)).join("")}
    ${box("pc-back", "0 0 100 140", back)}
  </svg>`);
}

const faceCache = new Map();

// A card's face as SVG markup (0–51).
export function faceSvg(face) {
  if (faceCache.has(face)) return faceCache.get(face);
  const s = suitOf(face);
  const r = rankOf(face);
  const label = RANK_NAMES[r];
  const corner = `<text x="11.5" y="24" class="${label.length > 1 ? "narrow" : ""}">${label}</text>${pip(s, 11.5, 34.5, 12.5)}`;
  let middle;
  if (r === 0) middle = `<circle class="ace-ring" cx="50" cy="70" r="30"/>${pip(s, 50, 70, 44)}`;
  else if (COURTS[r]) {
    const half = `<use href="#pc-c${r}" x="20" y="16" width="60" height="54"/>${pip(s, 50, 61.5, 8)}`;
    middle = `<rect class="court-bg" x="18" y="13" width="64" height="114" rx="4"/>${half}<g transform="rotate(180 50 70)">${half}</g><path class="court-line" d="M18 70H82"/>`;
  } else {
    const size = r >= 8 ? 15 : 17;
    middle = PIPS[r].map(([x, y]) => pip(s, x, y, size, y > 70.5)).join("");
  }
  const svg = `<svg class="pc-svg" viewBox="0 0 100 140" aria-hidden="true" focusable="false"><rect class="paper" x=".75" y=".75" width="98.5" height="138.5" rx="7"/>${middle}<g class="idx">${corner}</g><g class="idx" transform="rotate(180 50 70)">${corner}</g></svg>`;
  faceCache.set(face, svg);
  return svg;
}

export const BACK_SVG = '<svg class="pc-svg" viewBox="0 0 100 140" aria-hidden="true" focusable="false"><use href="#pc-back" width="100" height="140"/></svg>';

// A suit sign on its own, for badges, pickers and logs.
export const suitSvg = (s) => `<svg class="pc-suit" viewBox="-10 -10 20 20" aria-hidden="true" focusable="false"><use href="#pc-s${s}" x="-10" y="-10" width="20" height="20"/></svg>`;
