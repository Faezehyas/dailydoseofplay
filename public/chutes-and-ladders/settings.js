// Chutes and Ladders' settings panel: the finish rule, spinning again on a 6,
// who goes first and whether the spinner spins by itself.
import { mountSettings as mountPanel } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  {
    name: "finish",
    legend: "Reaching 100",
    options: [
      ["exact", "Exact spin", "classic"],
      ["bounce", "Bounce back", "extra steps go back"],
      ["any", "Any spin", "overshoot wins"],
    ],
  },
  { name: "sixAgain", legend: "Spin a 6", options: [[false, "Turn ends", "classic"], [true, "Spin again"]] },
  { name: "first", legend: "First spin", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]] },
  { name: "spin", legend: "Your spinner", options: [["tap", "Tap to spin"], ["auto", "Spins by itself"]] },
];

export function mountSettings(section, lobby) {
  return mountPanel(section, lobby, {
    key: "ddp-cl-settings",
    prefix: "cl",
    groups: GROUPS,
    normalize: normalizeConfig,
    hint: "In a friend game, the settings of whoever creates the room apply to both players, except the spinner: each player picks their own.",
  });
}
