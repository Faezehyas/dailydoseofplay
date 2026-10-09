// General settings: this device's preferences for every page (theme, sound
// and volume, animations, asking before leaving), kept together under one
// key. The nickname keeps its own key (ddp-name, in shell.js). onPrefsChange()
// is where syncing them to an account can hook in later. No DOM; runs in node too.
const KEY = "ddp-settings";
// Before ddp-settings, the theme and the mute had keys of their own.
const OLD_THEME = "ddp-theme";
const OLD_SOUND = "ddp-sound";

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

// A complete, valid set of preferences: defaults for anything missing or wrong.
// theme and motion: "system" follows the device; volume: 0 to 100.
export function normalizePrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  return {
    theme: pick(p.theme, ["system", "light", "dark"], "system"),
    sound: p.sound !== false,
    volume: Number.isFinite(p.volume) ? Math.round(Math.min(100, Math.max(0, p.volume))) : 100,
    motion: pick(p.motion, ["system", "reduce", "full"], "system"),
    askBeforeLeaving: p.askBeforeLeaving !== false,
  };
}

// Reads the preferences from `storage`, moving the old keys' values into
// ddp-settings the first time.
export function loadPrefs(storage) {
  const saved = storage.getItem(KEY);
  if (saved !== null) {
    try {
      return normalizePrefs(JSON.parse(saved));
    } catch {
      return normalizePrefs(null);
    }
  }
  const theme = storage.getItem(OLD_THEME);
  const sound = storage.getItem(OLD_SOUND);
  const prefs = normalizePrefs({ theme, sound: sound !== "off" });
  if (theme !== null || sound !== null) {
    storage.setItem(KEY, JSON.stringify(prefs));
    storage.removeItem(OLD_THEME);
    storage.removeItem(OLD_SOUND);
  }
  return prefs;
}

export function getPrefs() {
  try {
    return loadPrefs(localStorage);
  } catch {
    return normalizePrefs(null);
  }
}

const listeners = new Set();

// Changes some preferences, saves them, and tells every listener.
export function setPrefs(patch) {
  const prefs = normalizePrefs({ ...getPrefs(), ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
  for (const fn of listeners) fn(prefs);
}

// fn(prefs) runs after each change made on this page.
export function onPrefsChange(fn) {
  listeners.add(fn);
}
