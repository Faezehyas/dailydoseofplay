// Crazy Eights' settings panel: how drawing works, the action cards, who
// goes first, the move timer, the robots' level and number, and the
// four-colour deck (that one only changes how cards look on this device).
import { mountSettings as mountPanel } from "../engine/settings.js";
import { normalizeConfig } from "./rules.js";

const GROUPS = [
  { name: "draw", legend: "When you can't play", options: [["until", "Draw until you can", "classic"], ["one", "Draw one, then pass"]] },
  { name: "strict", legend: "Drawing", options: [[true, "Only if you can't play", "checked at the end"], [false, "Any time"]] },
  { name: "actions", legend: "Action cards", options: [[false, "Off", "classic"], [true, "On", "2 draw two · Q skip · A reverse"]] },
  { name: "first", legend: "Who goes first", options: [["random", "Coin toss"], ["host", "Me"], ["guest", "Next player", "first friend in"]] },
  { name: "moveSeconds", legend: "Time to move", options: [[0, "No limit"], [15, "15 s"], [30, "30 s"], [60, "60 s"]] },
  { name: "level", legend: "Robot level", options: [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]] },
  { name: "robots", legend: "Play vs robot", options: [[1, "1 robot"], [2, "2 robots"], [3, "3 robots"]] },
  { name: "fourColor", legend: "Card colours", options: [[false, "Two colours"], [true, "Four colours", "♦ blue · ♣ green"]] },
];

export function mountSettings(section, lobby) {
  return mountPanel(section, lobby, {
    key: "ddp-crazy-eights-settings",
    prefix: "ce",
    groups: GROUPS,
    normalize: normalizeConfig,
    hint: "Two to four players. With friends, the settings of whoever creates the room apply to everyone, except card colours, which are yours. When time runs out, a move is made for you.",
  });
}
