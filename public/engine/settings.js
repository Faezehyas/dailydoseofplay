// A game's settings: groups of segmented options (clocks, board size, …),
// remembered on this device. The lobby shows them inside its card, folded to
// a summary of chips, and the summary again on the host's waiting screen.
// In a friend game the room creator's settings apply to everyone: the game
// sends them to its guests when the match is set up.
import { el } from "./shell.js";

// groups: [{ name, legend, options: [[value, label, hint?], …], robot?, summary? }]
// robot: the group only applies to robot games. summary(value, label, config)
// is the text of the group's chip in the summary (default: the label; "" leaves it out).
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
  // The summary: a chip per choice (robot-only ones with a teal dot), with
  // commas between them for screen readers. withRobot: false leaves those out.
  function summary(withRobot = true) {
    const parts = groups
      .filter((g) => withRobot || !g.robot)
      .map(({ name, options, robot, summary: part }) => {
        const label = options.find(([value]) => value === config[name])?.[1] ?? "";
        return { text: part ? part(config[name], label, config) : label, robot };
      })
      .filter((p) => p.text);
    return parts.flatMap(({ text, robot }, i) => [i ? el("span", { class: "sr-only" }, ", ") : "", el("span", { class: robot ? "chip robot" : "chip" }, text)]);
  }
  // The lobby's home screen: the summary, which opens to the options.
  function panel() {
    const line = el("span", { class: "settings-line" }, summary());
    const change = el("span", { class: "settings-change" }, "Change");
    const fieldsets = groups.map(({ name, legend, options, robot }) =>
      el(
        "fieldset",
        { class: "settings-group" },
        el("legend", {}, legend, robot && el("small", { class: "chip robot robot-only" }, "vs robot only")),
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
      el("summary", {}, el("span", { class: "settings-title" }, "Game settings"), change, line),
      el("div", { class: "settings-body" }, ...fieldsets, hint && el("p", { class: "hint" }, hint)),
    );
    details.addEventListener("toggle", () => (change.textContent = details.open ? "Done" : "Change"));
    return details;
  }
  return { get: () => ({ ...config }), summary, panel };
}
