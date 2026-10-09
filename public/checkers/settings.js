// Checkers' settings: clocks, who moves first and the robot's level.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";
import { LEVELS, DEFAULT_LEVEL } from "./robot.js";

const GROUPS = [
  { name: "moveSeconds", legend: "Time per move", options: [[30, "30 s"], [60, "1 min"], [90, "90 s"], [120, "2 min"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} a move` : c.gameSeconds ? "No move limit" : "") },
  {
    name: "gameSeconds",
    legend: "Time for each player",
    options: [[180, "3 min"], [300, "5 min"], [480, "8 min"], [900, "15 min"], [1200, "20 min"], [3600, "60 min"], [0, "No limit"]],
    summary: (v, l, c) => (v ? `${l} each` : c.moveSeconds ? "No game clock" : "No clocks"),
  },
  { name: "first", legend: "First move", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Opponent"]], summary: (v, l) => ({ host: "You go first", guest: "Opponent goes first" })[v] ?? l },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
];

export const normalizeLevel = (level) => (Object.hasOwn(LEVELS, level) ? level : DEFAULT_LEVEL);
const normalize = (raw) => ({ ...normalizeConfig(raw), level: normalizeLevel(raw?.level) });

export const settings = gameSettings({
  key: "ddp-checkers-settings",
  prefix: "ck",
  groups: GROUPS,
  normalize,
  hint: "In a friend game, the settings of whoever creates the room apply to both players.",
});
