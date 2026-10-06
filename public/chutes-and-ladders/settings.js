// Chutes and Ladders' settings panel: the finish rule, spinning again on a 6,
// who goes first, whether the spinner spins by itself, and how many robots a
// robot game has.
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
  { name: "first", legend: "First spin", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Next player", "first friend in"]] },
  { name: "spin", legend: "Your spinner", options: [["tap", "Tap to spin"], ["auto", "Spins by itself"]] },
  { name: "robots", legend: "Play vs robot", options: [[1, "1 robot"], [2, "2 robots"], [3, "3 robots"]] },
];

export function mountSettings(section, lobby) {
  return mountPanel(section, lobby, {
    key: "ddp-cl-settings",
    prefix: "cl",
    groups: GROUPS,
    normalize: normalizeConfig,
    hint: "Up to four players. In a friend game, the settings of whoever creates the room apply to everyone, except the spinner: each player picks their own.",
  });
}
