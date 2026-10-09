// Ludo's settings: the house rules, playing on for places, who rolls first,
// the move timer, and the robots' level and number.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

// The summary names only the house rules that differ from the classic ones.
const GROUPS = [
  { name: "threeSixes", legend: "Three 6s in a row", options: [[true, "Turn lost", "classic"], [false, "Keep rolling"]], summary: (v) => (v ? "" : "Three 6s keep rolling") },
  { name: "blocks", legend: "Two tokens on a square", options: [[false, "Can be passed", "classic"], [true, "Block the way"]], summary: (v) => (v ? "Blocks" : "") },
  { name: "captureBonus", legend: "After a capture", options: [[false, "Turn ends", "classic"], [true, "Roll again"]], summary: (v) => (v ? "A capture rolls again" : "") },
  { name: "places", legend: "When someone finishes", options: [[true, "Play for places"], [false, "Game ends"]], summary: (v) => (v ? "Play for places" : "First home wins") },
  { name: "first", legend: "First roll", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Next player", "first friend in"]], summary: (v, l) => ({ host: "You go first", guest: "Next player goes first" })[v] ?? l },
  { name: "moveSeconds", legend: "Time to move", options: [[0, "No limit"], [10, "10 s"], [20, "20 s"], [30, "30 s"]], summary: (v, l) => (v ? `${l} a move` : "No move limit") },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
  { name: "robots", legend: "Play vs robot", robot: true, options: [[1, "1 robot"], [2, "2 robots"], [3, "3 robots"]] },
];

export const settings = gameSettings({
  key: "ddp-ludo-settings",
  prefix: "ld",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "Up to four players. With friends, the settings of whoever creates the room apply to everyone. When time runs out, a move is made for you.",
});
