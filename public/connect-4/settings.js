// Connect 4's settings: board size, clocks, who moves first and the robot's
// level.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  { name: "size", legend: "Board", options: [["7x6", "7 × 6", "classic"], ["8x7", "8 × 7"], ["8x8", "8 × 8"], ["9x7", "9 × 7"], ["9x9", "9 × 9"]] },
  { name: "moveSeconds", legend: "Time per move", options: [[10, "10 s"], [20, "20 s"], [30, "30 s"], [40, "40 s"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} a move` : c.gameSeconds ? "No move limit" : "") },
  { name: "gameSeconds", legend: "Time for each player", options: [[60, "1 min"], [120, "2 min"], [180, "3 min"], [240, "4 min"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} each` : c.moveSeconds ? "No game clock" : "No clocks") },
  { name: "first", legend: "First move (plays coral)", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]], summary: (v, l) => ({ host: "You go first", guest: "Opponent goes first" })[v] ?? l },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
];

export const settings = gameSettings({
  key: "ddp-c4-settings",
  prefix: "c4",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "In a friend game, the settings of whoever creates the room apply to both players.",
});
