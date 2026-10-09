// UI shell shared by the home page and every game: header, footer, theme and
// sound toggles, the settings panel, nickname storage and field, toasts,
// tab-title alerts and tiny DOM helpers.
import { getPrefs, setPrefs, onPrefsChange } from "./prefs.js";
import { checkName, cleanName } from "./names.js";

const NAME_KEY = "ddp-name";
const REPO = "https://github.com/Faezehyas/dailydoseofplay";
// The footer's links, in order.
const FOOTER_LINKS = [
  ["How it works", `${REPO}/blob/main/ARCHITECTURE.md`],
  ["GitHub", REPO],
  ["Privacy", "/privacy/"],
];

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}
function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// A name the rules in names.js refuse is never stored or used.
export function getNickname() {
  return cleanName(load(NAME_KEY), "");
}
export function setNickname(name) {
  const clean = cleanName(name, "");
  store(NAME_KEY, clean || null);
  return clean;
}
export const displayName = (fallback = "Player") => getNickname() || fallback;

// Why a nickname isn't used (see names.js); the player then plays under the default name.
const NAME_PROBLEMS = {
  link: "Not used: no links or @handles, please.",
  word: "Not used: please pick a kinder nickname.",
  chars: "Not used: only letters, numbers, spaces and . _ - ' are allowed.",
};

// The nickname field of the lobby and the settings panel. A change is saved
// and copied to the other field on the page, if there is one.
export function nicknameField(id = "nickname") {
  const input = el("input", {
    id,
    type: "text",
    maxlength: "20",
    autocomplete: "nickname",
    placeholder: "Your nickname (optional)",
    value: getNickname(),
    "aria-describedby": `${id}-problem`,
  });
  const problem = el("small", { id: `${id}-problem`, class: "field-problem", "aria-live": "polite" });
  const check = () => {
    problem.textContent = NAME_PROBLEMS[checkName(input.value).problem] ?? "";
    problem.hidden = !problem.textContent;
  };
  input.addEventListener("input", check);
  input.addEventListener("change", () => {
    setNickname(input.value);
    check();
    for (const other of document.querySelectorAll('input[autocomplete="nickname"]')) {
      if (other === input) continue;
      other.value = input.value;
      other.dispatchEvent(new Event("input"));
    }
  });
  check();
  return el("label", { class: "field" }, el("span", {}, "Nickname"), input, problem, el("small", {}, "Saved on this device only."));
}

// Whether Leave asks first during a live friend match ("Leaving a game with friends" in the settings panel).
export const askBeforeLeaving = () => getPrefs().askBeforeLeaving;

const systemDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
function effectiveDark() {
  const { theme } = getPrefs();
  return theme === "system" ? systemDark() : theme === "dark";
}

// Whether to keep motion to a minimum: the Animations setting, or the
// device's preference while it says "Follow system".
export function reducedMotion() {
  const { motion } = getPrefs();
  return motion === "system" ? matchMedia("(prefers-reduced-motion: reduce)").matches : motion === "reduce";
}

// The theme as <html data-theme> ("light" or "dark"; none follows the
// system) and animations as <html data-motion> ("reduce" or "full"), which
// theme.css and the games' styles read.
function applyPrefs() {
  const root = document.documentElement;
  const { theme } = getPrefs();
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  root.dataset.motion = reducedMotion() ? "reduce" : "full";
}

const ICONS = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path stroke-linejoin="round" d="M18.7 10.1L21.4 10.5L21.4 13.5L18.7 13.9L18.1 15.4L19.7 17.6L17.6 19.7L15.4 18.1L13.9 18.7L13.5 21.4L10.5 21.4L10.1 18.7L8.6 18.1L6.4 19.7L4.3 17.6L5.9 15.4L5.3 13.9L2.6 13.5L2.6 10.5L5.3 10.1L5.9 8.6L4.3 6.4L6.4 4.3L8.6 5.9L10.1 5.3L10.5 2.6L13.5 2.6L13.9 5.3L15.4 5.9L17.6 4.3L19.7 6.4L18.1 8.6z"/><circle cx="12" cy="12" r="3"/></svg>',
};

export function logoSvg() {
  return '<svg viewBox="0 0 32 32" aria-hidden="true" class="logo-mark"><rect x="2" y="2" width="28" height="28" rx="8" class="logo-bg"/><circle cx="11" cy="11" r="3" class="logo-dot"/><circle cx="21" cy="21" r="3" class="logo-dot"/><circle cx="21" cy="11" r="3" class="logo-dot2"/><circle cx="11" cy="21" r="3" class="logo-dot2"/></svg>';
}

// settings: a game's gameSettings() (settings.js), shown in the settings panel's "This game" tab.
export function initShell({ title, settings } = {}) {
  applyPrefs();
  const header = el("header", { class: "site-header" });
  const brand = el("a", { class: "brand", href: "/" });
  brand.innerHTML = `${logoSvg()}<span>Daily Dose <em>of</em> Play</span>`;
  // Both toggles keep one label and give their state through aria-pressed.
  const themeBtn = el("button", { class: "icon-btn", type: "button", id: "theme-toggle", title: "Dark mode", "aria-label": "Dark mode" });
  const renderThemeBtn = () => {
    const dark = effectiveDark();
    themeBtn.innerHTML = dark ? ICONS.sun : ICONS.moon;
    themeBtn.setAttribute("aria-pressed", String(dark));
  };
  themeBtn.addEventListener("click", () => {
    const next = effectiveDark() ? "light" : "dark";
    // Back to "system" when the choice matches the OS preference.
    setPrefs({ theme: (next === "dark") === systemDark() ? "system" : next });
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", renderThemeBtn);
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", applyPrefs);
  renderThemeBtn();
  const settingsBtn = el("button", { class: "icon-btn", type: "button", id: "settings-open", title: "Settings", "aria-label": "Settings", "aria-haspopup": "dialog", onclick: () => openSettings(settings) });
  settingsBtn.innerHTML = ICONS.gear;
  const right = el("div", { class: "header-right" });
  let renderSoundBtn = () => {};
  if (title) {
    const soundBtn = el("button", { class: "icon-btn", type: "button", id: "sound-toggle", title: "Mute sounds", "aria-label": "Mute sounds" });
    renderSoundBtn = () => {
      const on = getPrefs().sound;
      soundBtn.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
      soundBtn.setAttribute("aria-pressed", on ? "false" : "true");
    };
    soundBtn.addEventListener("click", () => setPrefs({ sound: !getPrefs().sound }));
    renderSoundBtn();
    right.append(el("span", { class: "header-game" }, title), soundBtn);
  }
  right.append(themeBtn, settingsBtn);
  onPrefsChange(() => {
    applyPrefs();
    renderThemeBtn();
    renderSoundBtn();
  });
  header.append(el("nav", { "aria-label": "Site" }, brand), right);
  document.body.prepend(header);
  // A skip link, shown when focused, jumps past the header to the page's <main>.
  const main = $("main");
  if (main) {
    main.id ||= "main";
    document.body.prepend(el("a", { class: "skip-link", href: `#${main.id}` }, "Skip to content"));
  }
  document.body.append(
    el(
      "footer",
      { class: "site-footer" },
      el("p", {}, "Games run directly between your browsers. Nothing to install, no account: your nickname and settings are kept only on your device."),
      el("ul", { class: "footer-links" }, FOOTER_LINKS.map(([text, href]) => el("li", {}, el("a", { href }, text)))),
    ),
  );
  return header;
}

// A group of segmented options (radio buttons that look like buttons), as in
// the lobby's game settings and the settings panel. options: [[value, label, hint?], …]
export function segGroup({ name, legend, options, value, onChange }) {
  return el(
    "fieldset",
    { class: "settings-group" },
    el("legend", {}, legend),
    el(
      "div",
      { class: "seg-options" },
      options.map(([v, label, small]) => {
        const input = el("input", { type: "radio", name, value: String(v), checked: v === value });
        input.addEventListener("change", () => onChange(v));
        return el("label", { class: "seg-opt" }, input, el("span", {}, label, small && el("small", {}, small)));
      }),
    ),
  );
}

// The settings panel, opened by the header's gear: "General", this device's
// preferences for every page (prefs.js), and on a game page "This game", the
// game's settings as in the lobby card. Focus moves in; Esc or Done closes it
// and focus goes back where it was.
function openSettings(game) {
  const back = document.activeElement;
  const pages = [["general", "General", generalSettings()]];
  if (game) pages.push(["game", "This game", game.form("panel")]);
  const tabbed = pages.length > 1;
  const tabs = pages.map(([id, label], i) =>
    el("button", { type: "button", role: "tab", id: `settings-tab-${id}`, "aria-controls": `settings-${id}`, "aria-selected": String(!i), tabindex: i ? "-1" : null }, label),
  );
  const panels = pages.map(([id, , content], i) =>
    el("div", { id: `settings-${id}`, role: tabbed && "tabpanel", "aria-labelledby": tabbed && `settings-tab-${id}`, hidden: i > 0 }, content),
  );
  // Arrow keys, Home and End move between the tabs; each tab shows its page at once.
  const select = (i) => {
    tabs.forEach((tab, j) => {
      tab.setAttribute("aria-selected", String(i === j));
      tab.tabIndex = i === j ? 0 : -1;
      panels[j].hidden = i !== j;
    });
    tabs[i].focus();
  };
  tabs.forEach((tab, i) => tab.addEventListener("click", () => select(i)));
  const onkeydown = (e) => {
    const i = tabs.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    select((to + tabs.length) % tabs.length);
  };
  const dialog = el(
    "dialog",
    { class: "card settings-panel", id: "settings", "aria-labelledby": "settings-title" },
    el(
      "div",
      { class: "settings-head" },
      el("h2", { id: "settings-title" }, "Settings"),
      el("form", { method: "dialog" }, el("button", { class: "btn small", id: "settings-done" }, "Done")),
    ),
    tabbed && el("div", { class: "settings-tabs", role: "tablist", "aria-label": "Settings", onkeydown }, tabs),
    panels,
  );
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => {
    dialog.remove();
    back?.focus();
  });
}

// The General tab. Each change applies and is saved at once.
function generalSettings() {
  const prefs = getPrefs();
  const group = (key, legend, options) => segGroup({ name: `settings-${key}`, legend, options, value: prefs[key], onChange: (value) => setPrefs({ [key]: value }) });
  const volume = el("input", { type: "range", id: "settings-volume", min: "0", max: "100", step: "5", value: String(prefs.volume) });
  volume.addEventListener("input", () => setPrefs({ volume: Number(volume.value) }));
  const sound = group("sound", "Sound", [[true, "On"], [false, "Off"]]);
  sound.append(el("label", { class: "volume" }, el("span", {}, "Volume"), volume));
  return [
    nicknameField("settings-nickname"),
    group("theme", "Theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]]),
    sound,
    group("motion", "Animations", [["system", "Follow system"], ["reduce", "Reduced"], ["full", "Full"]]),
    group("askBeforeLeaving", "Leaving a game with friends", [[true, "Ask first"], [false, "Leave at once"]]),
  ];
}

// Prefix the tab title (e.g. "Your turn") so a background tab shows it.
let baseTitle = null;
export function setTabAlert(text) {
  if (baseTitle === null) baseTitle = document.title;
  document.title = text ? `● ${text} · ${baseTitle}` : baseTitle;
}

let toastTimer = null;
export function toast(message, ms = 2600) {
  let node = $("#toast");
  if (!node) {
    node = el("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" });
    document.body.append(node);
  }
  clearTimeout(toastTimer);
  const show = () => {
    node.textContent = message;
    node.classList.add("show");
    toastTimer = setTimeout(() => node.classList.remove("show"), ms);
  };
  // A screen reader skips text that is already there, so a repeat empties the
  // toast first and fills it again a moment later.
  if (node.textContent !== message) return show();
  node.textContent = "";
  toastTimer = setTimeout(show, 100);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el("textarea", { style: "position:fixed;opacity:0" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    ta.remove();
    return ok;
  }
}
