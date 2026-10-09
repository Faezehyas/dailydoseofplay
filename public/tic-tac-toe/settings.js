// Tic Tac Toe's settings: board size, clocks and who moves first.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  { name: "size", legend: "Board", options: [[3, "3 × 3", "three in a row"], [5, "5 × 5", "four in a row"]] },
  { name: "moveSeconds", legend: "Time per move", options: [[5, "5 s"], [10, "10 s"], [15, "15 s"], [30, "30 s"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} a move` : c.gameSeconds ? "No move limit" : "") },
  { name: "gameSeconds", legend: "Time for each player", options: [[60, "1 min"], [120, "2 min"], [180, "3 min"], [300, "5 min"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} each` : c.moveSeconds ? "No game clock" : "No clocks") },
  { name: "first", legend: "First move (plays X)", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]], summary: (v, l) => ({ host: "You go first", guest: "Opponent goes first" })[v] ?? l },
];

export const settings = gameSettings({
  key: "ddp-ttt-settings",
  prefix: "ttt",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "In a friend game, the settings of whoever creates the room apply to both players.",
});
