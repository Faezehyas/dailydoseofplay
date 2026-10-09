// UI shell shared by the home page and every game: header, Games menu, theme
// and sound toggles, the game list, nickname and last-game storage, toasts,
// tab-title alerts and tiny DOM helpers.
import { soundOn, setSound } from "./sound.js";
import { cleanName } from "./names.js";

const THEME_KEY = "ddp-theme";
const NAME_KEY = "ddp-name";
const LAST_GAME_KEY = "ddp-last-game";

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

// The slug of the last game started on this device; the home page shows it first.
export const getLastGame = () => load(LAST_GAME_KEY);
export const setLastGame = (slug) => store(LAST_GAME_KEY, slug);

// The games in games.json, fetched once per page; a failed fetch is tried
// again on the next call.
let gamesRequest = null;
export function loadGames() {
  gamesRequest ||= fetch("/games.json")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(({ games }) => games)
    .catch((err) => {
      gamesRequest = null;
      throw err;
    });
  return gamesRequest;
}

// Theme: "system" (default), "light" or "dark", applied as <html data-theme>.
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
function currentTheme() {
  const t = load(THEME_KEY);
  return t === "light" || t === "dark" ? t : "system";
}
function effectiveDark() {
  const t = currentTheme();
  if (t !== "system") return t === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

const ICONS = {
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
  games: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
};

export function logoSvg() {
  return '<svg viewBox="0 0 32 32" aria-hidden="true" class="logo-mark"><rect x="2" y="2" width="28" height="28" rx="8" class="logo-bg"/><circle cx="11" cy="11" r="3" class="logo-dot"/><circle cx="21" cy="21" r="3" class="logo-dot"/><circle cx="21" cy="11" r="3" class="logo-dot2"/><circle cx="11" cy="21" r="3" class="logo-dot2"/></svg>';
}

// The header's Games button opens a list of every game in games.json: ready
// games are links (this page's marked aria-current), the rest plain text. It
// closes on Esc (focus goes back to the button) and when a click or focus
// lands outside it.
function gamesMenu() {
  const list = el("ul", { class: "games-menu-list" });
  // tabindex -1: a click on the panel's padding keeps focus inside, so it stays open.
  const panel = el("div", { class: "games-menu", id: "games-menu", tabindex: "-1", hidden: true }, list);
  const button = el("button", { class: "btn small games-btn", type: "button", id: "games-toggle", "aria-expanded": "false", "aria-controls": "games-menu" });
  button.innerHTML = `${ICONS.games}<span>Games</span>`;
  let filled = false;
  const fill = async () => {
    list.replaceChildren(el("li", { class: "games-menu-note" }, "Loading…"));
    try {
      const games = await loadGames();
      list.replaceChildren(
        ...games.map((g) => {
          const players = el("small", {}, g.status === "ready" ? g.players : `${g.players} · coming soon`);
          if (g.status !== "ready") return el("li", { class: "soon" }, el("span", {}, g.name), players);
          const current = location.pathname === `/${g.slug}/` && "page";
          return el("li", {}, el("a", { href: `/${g.slug}/`, "aria-current": current }, el("span", {}, g.name), players));
        }),
      );
      filled = true;
    } catch {
      list.replaceChildren(el("li", { class: "games-menu-note" }, "Couldn't load the game list."));
    }
  };
  const setOpen = (open) => {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open && !filled) fill();
  };
  const wrap = el("div", {}, button, panel);
  button.addEventListener("click", () => setOpen(panel.hidden));
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || panel.hidden) return;
    setOpen(false);
    button.focus();
  });
  wrap.addEventListener("focusout", (e) => {
    if (!wrap.contains(e.relatedTarget)) setOpen(false);
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });
  return wrap;
}

export function initShell() {
  applyTheme(currentTheme());
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
    const osDark = matchMedia("(prefers-color-scheme: dark)").matches;
    store(THEME_KEY, (next === "dark") === osDark ? null : next);
    applyTheme(currentTheme());
    renderThemeBtn();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", renderThemeBtn);
  renderThemeBtn();
  const soundBtn = el("button", { class: "icon-btn", type: "button", id: "sound-toggle", title: "Mute sounds", "aria-label": "Mute sounds" });
  const renderSoundBtn = () => {
    const on = soundOn();
    soundBtn.innerHTML = on ? ICONS.soundOn : ICONS.soundOff;
    soundBtn.setAttribute("aria-pressed", on ? "false" : "true");
  };
  soundBtn.addEventListener("click", () => {
    setSound(!soundOn());
    renderSoundBtn();
  });
  renderSoundBtn();
  header.append(el("nav", { "aria-label": "Site" }, brand, gamesMenu()), el("div", { class: "header-right" }, soundBtn, themeBtn));
  document.body.prepend(header);
  // A skip link, shown when focused, jumps past the header to the page's <main>.
  const main = $("main");
  if (main) {
    main.id ||= "main";
    document.body.prepend(el("a", { class: "skip-link", href: `#${main.id}` }, "Skip to content"));
  }
  return header;
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
