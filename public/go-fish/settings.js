// Go Fish's settings: cards dealt, what a lucky fish does, an empty hand,
// books of four or pairs, who goes first, the time to ask, the robots' level
// and number, and the four-colour deck (that one only changes how cards look
// on this device).
import { gameSettings } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

// The summary names only the rules that differ from the classic ones, and
// leaves out the card colours, which are yours alone.
const GROUPS = [
  { name: "hand", legend: "Cards dealt", options: [["classic", "Classic", "7, or 5 with four players"], [5, "5 each"], [7, "7 each"]], summary: (v, l) => (v === "classic" ? "" : `${l} dealt`) },
  { name: "lucky", legend: "Drawing the rank you asked for", options: [["again", "Show it, go again", "classic"], ["pass", "Turn passes"]], summary: (v) => (v === "pass" ? "Lucky fish: turn passes" : "") },
  { name: "empty", legend: "Out of cards", options: [["draw", "Draw one", "classic"], ["out", "Sit out"]], summary: (v) => (v === "out" ? "Empty hand sits out" : "") },
  { name: "books", legend: "Books", options: [[4, "Four of a kind", "classic"], [2, "Pairs", "easier for young players"]], summary: (v) => (v === 2 ? "Pairs" : "") },
  { name: "first", legend: "Who goes first", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Next player", "first friend in"]], summary: (v, l) => ({ host: "You go first", guest: "Next player goes first" })[v] ?? l },
  { name: "moveSeconds", legend: "Time to ask", options: [[0, "No limit"], [15, "15 s"], [30, "30 s"], [60, "60 s"]], summary: (v, l) => (v ? `${l} to ask` : "No time limit") },
  { name: "level", legend: "Robot level", robot: true, options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]], summary: (v, l) => `${l} robot` },
  { name: "robots", legend: "Play vs robot", robot: true, options: [[1, "1 robot"], [2, "2 robots"], [3, "3 robots"]] },
  { name: "fourColor", legend: "Card colours", options: [[false, "Two colours"], [true, "Four colours", "♦ blue · ♣ green"]], summary: () => "" },
];

export const settings = gameSettings({
  key: "ddp-go-fish-settings",
  prefix: "gf",
  groups: GROUPS,
  normalize: normalizeConfig,
  hint: "Two to four players. With friends, the settings of whoever creates the room apply to everyone, except card colours, which are yours. When time runs out, an ask is made for you.",
});
