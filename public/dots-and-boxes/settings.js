// Dots and Boxes' settings: the board, clocks, who draws first and the
// robot's level.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  { name: "size", legend: "Board", options: [[3, "3×3", "9 boxes"], [4, "4×4", "16 boxes"], [5, "5×5", "25 boxes"], [6, "6×6", "36 boxes"]], summary: (v, l) => `${l} boxes` },
  { name: "moveSeconds", legend: "Time per line", options: [[10, "10 s"], [20, "20 s"], [30, "30 s"], [60, "1 min"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} a line` : c.gameSeconds ? "No line limit" : "") },
  { name: "gameSeconds", legend: "Time for each player", options: [[60, "1 min"], [180, "3 min"], [300, "5 min"], [600, "10 min"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} each` : c.moveSeconds ? "No game clock" : "No clocks") },
  { name: "first", legend: "First line", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]], summary: (v, l) => ({ host: "You go first", guest: "Opponent goes first" })[v] ?? l },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
];

export const settings = gameSettings({
  key: "ddp-db-settings",
  prefix: "db",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "In a friend game, the settings of whoever creates the room apply to both players.",
});
