// Ludo's settings panel: the house rules, playing on for places, who rolls
// first, the move timer, and the robots' level and number.
import { mountSettings as mountPanel } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  { name: "threeSixes", legend: "Three 6s in a row", options: [[true, "Turn lost", "classic"], [false, "Keep rolling"]] },
  { name: "blocks", legend: "Two tokens on a square", options: [[false, "Can be passed", "classic"], [true, "Block the way"]] },
  { name: "captureBonus", legend: "After a capture", options: [[false, "Turn ends", "classic"], [true, "Roll again"]] },
  { name: "places", legend: "When someone finishes", options: [[true, "Play for places"], [false, "Game ends"]] },
  { name: "first", legend: "First roll", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Next player", "first friend in"]] },
  { name: "moveSeconds", legend: "Time to move", options: [[0, "No limit"], [10, "10 s"], [20, "20 s"], [30, "30 s"]] },
  { name: "level", legend: "Robot level", options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]] },
  { name: "robots", legend: "Play vs robot", options: [[1, "1 robot"], [2, "2 robots"], [3, "3 robots"]] },
];

export function mountSettings(section, lobby) {
  return mountPanel(section, lobby, {
    key: "ddp-ludo-settings",
    prefix: "ld",
    groups: GROUPS,
    normalize: normalizeConfig,
    hint: "Up to four players. With friends, the settings of whoever creates the room apply to everyone. When time runs out, a move is made for you.",
  });
}
