// A game's settings panel, shown under the lobby's home screen: groups of
// segmented options (clocks, board size, …), remembered on this device.
// In a friend game the room creator's settings apply to both players: the
// game sends them to its guest when the match is set up.
import { el } from "./shell.js";

// groups: [{ name, legend, options: [[value, label, hint?], …] }]
// normalize(raw) returns a complete, valid config (defaults for anything else).
export function mountSettings(section, lobby, { key, prefix, groups, normalize, hint }) {
  let config = load();
  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(key)));
    } catch {
      return normalize(null);
    }
  }
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(config));
    } catch {}
  }
  const fieldsets = groups.map(({ name, legend, options }) =>
    el(
      "fieldset",
      { class: "settings-group" },
      el("legend", {}, legend),
      el(
        "div",
        { class: "seg-options" },
        options.map(([value, label, small]) => {
          const input = el("input", { type: "radio", name: `${prefix}-${name}`, value: String(value), checked: config[name] === value });
          input.addEventListener("change", () => {
            config = normalize({ ...config, [name]: value });
            save();
          });
          return el("label", { class: "seg-opt" }, input, el("span", {}, label, small && el("small", {}, small)));
        }),
      ),
    ),
  );
  section.classList.add("settings-card");
  section.replaceChildren(el("h2", {}, "Game settings"), ...fieldsets, hint && el("p", { class: "hint" }, hint));
  // Only on the lobby's home screen, where a new game is started.
  const sync = () => (section.hidden = lobby.hidden || !lobby.querySelector("#play-friend"));
  new MutationObserver(sync).observe(lobby, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });
  sync();
  return { get: () => ({ ...config }) };
}
