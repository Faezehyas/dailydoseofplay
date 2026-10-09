// A game's settings: groups of segmented options (clocks, board size, …),
// remembered on this device. The lobby shows them inside its card, folded to
// a one-line summary, and the summary again on the host's waiting screen.
// In a friend game the room creator's settings apply to everyone: the game
// sends them to its guests when the match is set up.
import { el } from "./shell.js";

// groups: [{ name, legend, options: [[value, label, hint?], …], robot?, summary? }]
// robot: the group only applies to robot games. summary(value, label, config)
// is the group's part of the summary line (default: the label; "" leaves it out).
// normalize(raw) returns a complete, valid config (defaults for anything else).
export function gameSettings({ key, prefix, groups, normalize, hint }) {
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
  // The summary line, one span per part so a part never breaks. withRobot:
  // false leaves out what only applies to robot games.
  function summary(withRobot = true) {
    const parts = groups
      .filter((g) => withRobot || !g.robot)
      .map(({ name, options, summary: part }) => {
        const label = options.find(([value]) => value === config[name])?.[1] ?? "";
        return part ? part(config[name], label, config) : label;
      })
      .filter(Boolean);
    return parts.flatMap((text, i) => [i ? " · " : "", el("span", { class: "settings-part" }, text)]);
  }
  // The lobby's home screen: the summary, which opens to the options.
  function panel() {
    const line = el("span", { class: "settings-line" }, summary());
    const change = el("span", { class: "settings-change" }, "Change");
    const fieldsets = groups.map(({ name, legend, options, robot }) =>
      el(
        "fieldset",
        { class: "settings-group" },
        el("legend", {}, legend, robot && el("small", { class: "robot-only" }, "vs robot only")),
        el(
          "div",
          { class: "seg-options" },
          options.map(([value, label, small]) => {
            const input = el("input", { type: "radio", name: `${prefix}-${name}`, value: String(value), checked: config[name] === value });
            input.addEventListener("change", () => {
              config = normalize({ ...config, [name]: value });
              save();
              line.replaceChildren(...summary());
            });
            return el("label", { class: "seg-opt" }, input, el("span", {}, label, small && el("small", {}, small)));
          }),
        ),
      ),
    );
    const details = el(
      "details",
      { class: "settings", id: `${prefix}-settings` },
      el("summary", {}, el("span", { class: "sr-only" }, "Game settings: "), line, change),
      el("div", { class: "settings-body" }, ...fieldsets, hint && el("p", { class: "hint" }, hint)),
    );
    details.addEventListener("toggle", () => (change.textContent = details.open ? "Done" : "Change"));
    return details;
  }
  return { get: () => ({ ...config }), summary, panel };
}
