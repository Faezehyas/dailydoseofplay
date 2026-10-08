// Nickname rules, shared by the lobby, the session handshake and the server
// (server/signaling.js imports this file), so all of them accept the same names.
// checkName() says what is wrong with a name; cleanName() swaps a bad one for a default.
export const NAME_MAX = 20;

// Letters and marks of any script, digits, spaces, . _ - ' and the zero-width
// joiners some scripts (e.g. Persian) need inside words.
const ALLOWED = /^[\p{L}\p{M}\p{N} ._'\-\u200c\u200d]+$/u;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const LINK = /:\/\/|\bwww\.|\w\s*\.\s*(?:com|net|org|io|gg|tv|xyz|ly|ru|info|biz|app|link|site|shop|live)\b|\bdot\s*(?:com|net|org)\b|@\S/i;

// Matched anywhere in the name once separators are removed.
const ANYWHERE = [
  "fuck", "bullshit", "cunt", "bitch", "whore", "slut", "nigger", "nigga", "faggot", "retard",
  "asshole", "jackass", "dumbass", "bastard", "wanker", "bollocks", "dildo", "hitler",
];
// Matched at the start of a word ("shitty", but not Matsushita).
const WORD_START = ["shit", "piss", "porn"];
// Matched only as a whole word, because they hide inside ordinary names
// (Nazir, Peacock, Essex, therapist, raccoon).
const WHOLE_WORD = [
  "ass", "anal", "cock", "dick", "tit", "tits", "cum", "fag", "hoe", "sex", "sexy",
  "penis", "vagina", "rape", "rapist", "nazi", "wank", "kys", "kkk", "coon", "spic", "chink", "kike",
  "tranny",
];

// Look-alike swaps (0/o, 1/i/l, 3/e, 4/a, 5/s, $/s) and a few Cyrillic and Greek twins of Latin letters.
const SWAPS = { 0: "o", 1: "i", l: "i", 3: "e", 4: "a", 5: "s", $: "s",
  "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u0456": "i", "\u043a": "k",
  "\u03bf": "o", "\u03b1": "a", "\u03b5": "e", "\u03b9": "i", "\u03ba": "k", "\u03c4": "t" };

function skeleton(text) {
  const plain = typeof text.normalize === "function" ? text.normalize("NFD") : text;
  return plain.toLowerCase().replace(/\p{M}|[\u200c\u200d]/gu, "").replace(/./gsu, (c) => SWAPS[c] ?? c);
}
// "fuck" -> /f+u+c+k+/, so stretched letters ("fuuuck") still match.
const stretch = (word) => [...skeleton(word)].map((c) => `${c}+`).join("");
const ANYWHERE_RE = new RegExp(ANYWHERE.map(stretch).join("|"));
const WHOLE_RE = new RegExp(`^(?:${WHOLE_WORD.map(stretch).join("|")})(?:e?s)?$`);
const START_RE = new RegExp(`^(?:${WORD_START.map(stretch).join("|")})`);

function offensive(name) {
  // "BigAss" -> "Big Ass": camel case counts as a word break.
  const words = name.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").split(/[\s._'\-]+/).map(skeleton);
  const joined = words.join("");
  // Spelled out ("a s s") only counts when every word is one letter, so "Ana L." stays fine.
  const spelled = words.every((w) => [...w].length <= 1) && (WHOLE_RE.test(joined) || START_RE.test(joined));
  return spelled || ANYWHERE_RE.test(joined) || words.some((w) => WHOLE_RE.test(w) || START_RE.test(w));
}

// { name, problem }: name is trimmed and capped at NAME_MAX characters;
// problem is null, "link" (URL or @handle), "word" (blocklist) or "chars".
export function checkName(raw) {
  const flat = String(raw ?? "").replace(CONTROL, "").replace(/\s+/gu, " ").replace(/[\u2018\u2019]/g, "'").trim();
  const name = [...flat].slice(0, NAME_MAX).join("").trim();
  if (!name) return { name, problem: null };
  if (LINK.test(name)) return { name, problem: "link" };
  if (offensive(name)) return { name, problem: "word" };
  if (!ALLOWED.test(name)) return { name, problem: "chars" };
  return { name, problem: null };
}

export function cleanName(raw, fallback) {
  const { name, problem } = checkName(raw);
  return name && !problem ? name : fallback;
}
