// Gomoku's settings: clocks and who moves first.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  { name: "moveSeconds", legend: "Time per move", options: [[10, "10 s"], [20, "20 s"], [30, "30 s"], [40, "40 s"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} a move` : c.gameSeconds ? "No move limit" : "") },
  { name: "gameSeconds", legend: "Time for each player", options: [[120, "2 min"], [180, "3 min"], [240, "4 min"], [300, "5 min"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} each` : c.moveSeconds ? "No game clock" : "No clocks") },
  { name: "first", legend: "First move", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]], summary: (v, l) => ({ host: "You go first", guest: "Opponent goes first" })[v] ?? l },
];

export const settings = gameSettings({
  key: "ddp-gomoku-settings",
  prefix: "gmk",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "15 × 15 board, five in a row wins. In a friend game, the settings of whoever creates the room apply to both players.",
});
