// Game settings panel, shown under the lobby's home screen: clocks, who
// plays White and the robot's level. The choice is remembered on this device.
import { el } from "../engine/shell.js";
import { DEFAULT_CONFIG, normalizeConfig } from "./rules.js";

const KEY = "ddp-chess-settings";

export const LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard" };

const GROUPS = [
  { name: "moveSeconds", legend: "Time per move", options: [[30, "30 s"], [60, "60 s"], [90, "90 s"], [120, "120 s"], [0, "No limit"]] },
  {
    name: "gameSeconds",
    legend: "Time for each player",
    options: [[180, "3 min"], [300, "5 min"], [600, "10 min"], [900, "15 min"], [1200, "20 min"], [3600, "60 min"], [0, "No limit"]],
  },
  { name: "first", legend: "Who plays White (moves first)", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]] },
  { name: "level", legend: "Robot level", options: Object.entries(LEVEL_NAMES), hint: "Only for games against the robot." },
];

function load() {
  try {
    return normalizeConfig(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function save(config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {}
}

export function mountSettings(section, lobby) {
  let config = load();
  const groups = GROUPS.map(({ name, legend, options, hint }) =>
    el(
      "fieldset",
      { class: "chess-seg" },
      el("legend", {}, legend),
      el(
        "div",
        { class: "seg-options" },
        options.map(([value, label]) => {
          const input = el("input", { type: "radio", name: `chess-${name}`, value: String(value), checked: config[name] === value });
          input.addEventListener("change", () => {
            config = normalizeConfig({ ...config, [name]: value });
            save(config);
          });
          return el("label", { class: "seg-opt" }, input, el("span", {}, label));
        }),
      ),
      hint && el("p", { class: "hint" }, hint),
    ),
  );
  section.replaceChildren(
    el("h2", {}, "Game settings"),
    ...groups,
    el("p", { class: "hint" }, "In a friend game, the settings of whoever creates the room apply to both players."),
  );
  // Only on the lobby's home screen, where a new game is started.
  const sync = () => (section.hidden = lobby.hidden || !lobby.querySelector("#play-friend"));
  new MutationObserver(sync).observe(lobby, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });
  sync();
  return { get: () => ({ ...config }) };
}
