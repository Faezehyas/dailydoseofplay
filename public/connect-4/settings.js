// Game settings panel, shown under the lobby's home screen: board size,
// clocks, who moves first and the robot's level. The choice is remembered on
// this device.
import { el } from "../engine/shell.js";
import { DEFAULT_CONFIG, normalizeConfig } from "./rules.js";

const KEY = "ddp-c4-settings";

const GROUPS = [
  { name: "size", legend: "Board", options: [["7x6", "7 × 6", "classic"], ["8x7", "8 × 7"], ["8x8", "8 × 8"], ["9x7", "9 × 7"], ["9x9", "9 × 9"]] },
  { name: "moveSeconds", legend: "Time per move", options: [[10, "10 s"], [20, "20 s"], [30, "30 s"], [40, "40 s"], [0, "No limit"]] },
  { name: "gameSeconds", legend: "Time for each player", options: [[60, "1 min"], [120, "2 min"], [180, "3 min"], [240, "4 min"], [0, "No limit"]] },
  { name: "first", legend: "First move (plays coral)", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]] },
  { name: "level", legend: "Robot level", hint: "vs robot only", options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]] },
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
  const groups = GROUPS.map(({ name, legend, hint, options }) =>
    el(
      "fieldset",
      { class: "c4-seg" },
      el("legend", {}, legend, hint && el("small", {}, ` (${hint})`)),
      el(
        "div",
        { class: "seg-options" },
        options.map(([value, label, sub]) => {
          const input = el("input", { type: "radio", name: `c4-${name}`, value: String(value), checked: config[name] === value });
          input.addEventListener("change", () => {
            config = normalizeConfig({ ...config, [name]: value });
            save(config);
          });
          return el("label", { class: "seg-opt" }, input, el("span", {}, label, sub && el("small", {}, sub)));
        }),
      ),
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
