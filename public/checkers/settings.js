// Game settings panel, shown under the lobby's home screen: clocks, who
// moves first and the robot's level. The choice is remembered on this device.
import { el } from "../engine/shell.js";
import { DEFAULT_CONFIG, normalizeConfig } from "./rules.js";
import { LEVELS, DEFAULT_LEVEL } from "./robot.js";

const KEY = "ddp-checkers-settings";

const GROUPS = [
  { name: "moveSeconds", legend: "Time per move", options: [[30, "30 s"], [60, "1 min"], [90, "90 s"], [120, "2 min"], [0, "No limit"]] },
  {
    name: "gameSeconds",
    legend: "Time for each player",
    options: [[180, "3 min"], [300, "5 min"], [480, "8 min"], [900, "15 min"], [1200, "20 min"], [3600, "60 min"], [0, "No limit"]],
  },
  { name: "first", legend: "First move", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]] },
  { name: "level", legend: "Robot level", options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]] },
];

export const normalizeLevel = (level) => (Object.hasOwn(LEVELS, level) ? level : DEFAULT_LEVEL);
const normalize = (raw) => ({ ...normalizeConfig(raw), level: normalizeLevel(raw?.level) });

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return { ...DEFAULT_CONFIG, level: DEFAULT_LEVEL };
  }
}

function save(config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {}
}

export function mountSettings(section, lobby) {
  let config = load();
  const groups = GROUPS.map(({ name, legend, options }) =>
    el(
      "fieldset",
      { class: "ck-seg" },
      el("legend", {}, legend),
      el(
        "div",
        { class: "seg-options" },
        options.map(([value, label]) => {
          const input = el("input", { type: "radio", name: `ck-${name}`, value: String(value), checked: config[name] === value });
          input.addEventListener("change", () => {
            config = normalize({ ...config, [name]: value });
            save(config);
          });
          return el("label", { class: "seg-opt" }, input, el("span", {}, label));
        }),
      ),
    ),
  );
  section.replaceChildren(
    el("h2", {}, "Game settings"),
    ...groups,
    el("p", { class: "hint" }, "In a friend game, the settings of whoever creates the room apply to both players. The robot level only applies to games against the robot."),
  );
  // Only on the lobby's home screen, where a new game is started.
  const sync = () => (section.hidden = lobby.hidden || !lobby.querySelector("#play-friend"));
  new MutationObserver(sync).observe(lobby, { attributes: true, attributeFilter: ["hidden"], childList: true, subtree: true });
  sync();
  return { get: () => ({ ...config }) };
}
