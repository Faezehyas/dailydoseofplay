// Game settings panel, shown under the lobby's home screen: board size,
// clocks and who moves first. The choice is remembered on this device.
import { el } from "../engine/shell.js";
import { DEFAULT_CONFIG, normalizeConfig } from "./rules.js";

const KEY = "ddp-ttt-settings";

const GROUPS = [
  { name: "size", legend: "Board", options: [[3, "3 × 3", "three in a row"], [5, "5 × 5", "four in a row"]] },
  { name: "moveSeconds", legend: "Time per move", options: [[5, "5 s"], [10, "10 s"], [15, "15 s"], [30, "30 s"], [0, "No limit"]] },
  { name: "gameSeconds", legend: "Time for each player", options: [[60, "1 min"], [120, "2 min"], [180, "3 min"], [300, "5 min"], [0, "No limit"]] },
  { name: "first", legend: "First move (plays X)", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]] },
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
  const groups = GROUPS.map(({ name, legend, options }) =>
    el(
      "fieldset",
      { class: "ttt-seg" },
      el("legend", {}, legend),
      el(
        "div",
        { class: "seg-options" },
        options.map(([value, label, hint]) => {
          const input = el("input", { type: "radio", name: `ttt-${name}`, value: String(value), checked: config[name] === value });
          input.addEventListener("change", () => {
            config = normalizeConfig({ ...config, [name]: value });
            save(config);
          });
          return el("label", { class: "seg-opt" }, input, el("span", {}, label, hint && el("small", {}, hint)));
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
