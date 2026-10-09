// Sea Battle's settings: the room's time limits.
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  { name: "shotSeconds", legend: "Time per shot", options: [[10, "10 s"], [20, "20 s"], [30, "30 s"], [40, "40 s"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} a shot` : c.gameSeconds ? "No shot limit" : "") },
  { name: "gameSeconds", legend: "Time for each player", options: [[180, "3 min"], [300, "5 min"], [600, "10 min"], [0, "No limit"]], summary: (v, l, c) => (v ? `${l} each` : c.shotSeconds ? "No game clock" : "No clocks") },
];

export const settings = gameSettings({
  key: "ddp-sb-settings",
  prefix: "sb",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "If time for a shot runs out, a random shot is fired for you. If your own clock runs out, you lose. In a friend game, the settings of whoever creates the room apply to both players.",
});
