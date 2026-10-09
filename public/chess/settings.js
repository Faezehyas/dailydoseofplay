// Chess' settings: clocks, who plays White and the robot's level.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

export const LEVEL_NAMES = { easy: "Easy", medium: "Medium", hard: "Hard" };

const GROUPS = [
  { name: "moveSeconds", legend: "Time per move", options: [[30, "30 s"], [60, "60 s"], [90, "90 s"], [120, "120 s"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} a move` : c.gameSeconds ? "No move limit" : "") },
  {
    name: "gameSeconds",
    legend: "Time for each player",
    options: [[180, "3 min"], [300, "5 min"], [600, "10 min"], [900, "15 min"], [1200, "20 min"], [3600, "60 min"], [0, "No limit"]],
    summary: (v, l, c) => (v ? `${l} each` : c.moveSeconds ? "No game clock" : "No clocks"),
  },
  { name: "first", legend: "Who plays White (moves first)", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]], summary: (v, l) => ({ host: "You play White", guest: "Opponent plays White" })[v] ?? l },
  { name: "level", legend: "Robot level", robot: true, options: Object.entries(LEVEL_NAMES), summary: (v, l) => `${l} robot` },
];

export const settings = gameSettings({
  key: "ddp-chess-settings",
  prefix: "chess",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "In a friend game, the settings of whoever creates the room apply to both players.",
});
