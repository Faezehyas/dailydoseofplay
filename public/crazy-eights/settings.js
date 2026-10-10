// Crazy Eights' settings: how drawing works, the action cards, who goes
// first, the move timer, the robots' level and number, and the four-colour
// deck (that one only changes how cards look on this device).
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

// The summary names only the rules that differ from the classic ones, and
// leaves out the card colours, which are yours alone.
const GROUPS = [
  { name: "draw", legend: "When you can't play", options: [["until", "Draw until you can", "classic"], ["one", "Draw one, then pass"]], summary: (v, l) => (v === "one" ? l : "") },
  { name: "strict", legend: "Drawing", options: [[true, "Only if you can't play", "checked at the end"], [false, "Any time"]], summary: (v) => (v ? "" : "Draw any time") },
  { name: "actions", legend: "Action cards", options: [[false, "Off", "classic"], [true, "On", "2 draw two · Q skip · A reverse"]], summary: (v) => (v ? "Action cards" : "") },
  { name: "first", legend: "Who goes first", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Next player", "first friend in"]], summary: (v, l) => ({ host: "You go first", guest: "Next player goes first" })[v] ?? l },
  { name: "moveSeconds", legend: "Time to move", options: [[0, "No limit"], [15, "15 s"], [30, "30 s"], [60, "60 s"]], summary: (v, l) => (v ? `${l} a move` : "No move limit") },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
  { name: "robots", legend: "Play vs robot", robot: true, options: [[1, "1 robot"], [2, "2 robots"], [3, "3 robots"]] },
  { name: "fourColor", legend: "Card colours", options: [[false, "Two colours"], [true, "Four colours", "♦ blue · ♣ green"]], summary: () => "" },
];

export const settings = gameSettings({
  key: "ddp-crazy-eights-settings",
  prefix: "ce",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "Two to four players. With friends, the settings of whoever creates the room apply to everyone, except card colours, which are yours. When time runs out, a move is made for you.",
});
