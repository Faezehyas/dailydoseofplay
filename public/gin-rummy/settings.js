// Gin Rummy's settings: the game's length, the knock limit, Big Gin, who
// deals first, the time per move, the robot's level, and the four-colour
// deck (that one only changes how cards look on this device).
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

// The summary names only the rules that differ from the classic ones, and
// leaves out the card colours, which are yours alone.
const GROUPS = [
  { name: "target", legend: "Game", options: [[100, "To 100", "classic, with bonuses"], [0, "One hand", "scores add up across rematches"]], summary: (v) => (v ? "" : "One hand a game") },
  { name: "knock", legend: "Knocking", options: [["classic", "10 or less", "classic"], ["oklahoma", "Oklahoma", "the upcard sets the limit"]], summary: (v) => (v === "oklahoma" ? "Oklahoma knocking" : "") },
  { name: "bigGin", legend: "Big Gin", options: [[false, "Off", "classic"], [true, "On", "all eleven cards: 31 + deadwood"]], summary: (v) => (v ? "Big Gin" : "") },
  { name: "dealer", legend: "Who deals first", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "The other player"]], summary: (v, l) => ({ host: "You deal first", guest: "The other player deals first" })[v] ?? l },
  { name: "moveSeconds", legend: "Time per move", options: [[0, "No limit"], [15, "15 s"], [30, "30 s"], [60, "60 s"]], summary: (v, l) => (v ? `${l} a move` : "No time limit") },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
  { name: "fourColor", legend: "Card colours", options: [[false, "Two colours"], [true, "Four colours", "♦ blue · ♣ green"]], summary: () => "" },
];

export const settings = gameSettings({
  key: "ddp-gin-rummy-settings",
  prefix: "gr",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "With a friend, the settings of whoever creates the room apply to both of you, except card colours, which are yours. When time runs out, a sensible move is made for you.",
});
