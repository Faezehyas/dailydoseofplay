// Chutes and Ladders' settings: the finish rule, spinning again on a 6, who
// goes first, whether the spinner spins by itself, and how many robots a
// robot game has.
import { gameSettings } from "../engine/settings.js";
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
    summary: (v) => ({ exact: "Exact spin to 100", bounce: "Bounce back off 100", any: "Any spin past 100 wins" })[v],
  },
  { name: "sixAgain", legend: "Spin a 6", options: [[false, "Turn ends", "classic"], [true, "Spin again"]], summary: (v) => (v ? "A 6 spins again" : "") },
  { name: "first", legend: "First spin", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Next player", "first friend in"]], summary: (v, l) => ({ host: "You go first", guest: "Next player goes first" })[v] ?? l },
  { name: "spin", legend: "Your spinner", scope: "view", options: [["tap", "Tap to spin"], ["auto", "Spins by itself"]] },
  { name: "robots", legend: "Play vs robot", robot: true, options: [[1, "1 robot"], [2, "2 robots"], [3, "3 robots"]] },
];

export const settings = gameSettings({
  key: "ddp-cl-settings",
  prefix: "cl",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "Up to four players. In a friend game, the settings of whoever creates the room apply to everyone, except the spinner: each player picks their own.",
});
