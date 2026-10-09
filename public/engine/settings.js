// A game's settings: groups of segmented options (clocks, board size, …),
// remembered on this device. The lobby shows them inside its card, folded to
// a summary of chips, and the summary again on the host's waiting screen;
// the settings panel's "This game" tab shows the same options.
// In a friend game the room creator's settings apply to everyone: the game
// sends them to its guests when the match is set up.
import { el, segGroup } from "./shell.js";

// groups: [{ name, legend, options: [[value, label, hint?], …], scope?, summary? }]
// scope: "room" (the default) is the game's rules, sent to the other players;
// "device" only applies to robot games (the robots' level and number; `robot:
// true` says the same); "view" is this player's own view of the game and
// can change during a game, which the game reads with get() when it needs it.
// summary(value, label, config) is the text of the group's chip in the
// summary (default: the label; "" leaves it out).
// normalize(raw) returns a complete, valid config (defaults for anything else).
export function gameSettings({ key, prefix, groups, normalize, hint }) {
  let config = load();
  let locked = false;
  const shown = new Map(); // what is on screen (summaries, options) → how to bring it up to date
  const scopeOf = (g) => g.scope ?? (g.robot ? "device" : "room");
  function load() {
    try {
      return normalize(JSON.parse(localStorage.getItem(key)));
    } catch {
      return normalize(null);
    }
  }
  function save() {
    try {
      localStorage.setItem(key, JSON.stringify(config));
    } catch {}
  }
  function set(name, value) {
    config = normalize({ ...config, [name]: value });
    save();
    refresh();
  }
  function refresh() {
    for (const [node, update] of shown) {
      if (node.isConnected) update();
      else shown.delete(node);
    }
  }
  // The summary: a chip per choice (robot-only ones with a teal dot), with
  // commas between them for screen readers. withRobot: false leaves out all
  // but the room's rules.
  function summary(withRobot = true) {
    const parts = groups
      .filter((g) => withRobot || scopeOf(g) === "room")
      .map((g) => {
        const label = g.options.find(([value]) => value === config[g.name])?.[1] ?? "";
        return { text: g.summary ? g.summary(config[g.name], label, config) : label, robot: scopeOf(g) === "device" };
      })
      .filter((p) => p.text);
    return parts.flatMap(({ text, robot }, i) => [i ? el("span", { class: "sr-only" }, ", ") : "", el("span", { class: robot ? "chip robot" : "chip" }, text)]);
  }
  // The options, one group per fieldset. While a game is on (lock), only
  // "view" options can change. Each copy on screen names its radio buttons
  // after `id`, and follows changes made in the others.
  function form(id = prefix) {
    const note = el("p", { class: "notice", id: `${id}-locked` }, "Locked during a game: rematches keep the room's settings. Change them in the lobby for your next game.");
    const sets = groups.map((g) => {
      const tag = scopeOf(g) === "device" && el("small", { class: "chip robot robot-only" }, "vs robot only");
      return segGroup({ name: `${id}-${g.name}`, legend: [g.legend, tag], options: g.options, value: config[g.name], onChange: (value) => set(g.name, value) });
    });
    const body = el("div", { class: "settings-body" }, note, sets, hint && el("p", { class: "hint" }, hint));
    const update = () => {
      note.hidden = !locked;
      groups.forEach((g, i) => {
        sets[i].disabled = locked && scopeOf(g) !== "view";
        for (const input of sets[i].querySelectorAll("input")) input.checked = input.value === String(config[g.name]);
      });
    };
    update();
    shown.set(body, update);
    return body;
  }
  // The lobby's home screen: the summary, which opens to the options.
  function panel() {
    const line = el("span", { class: "settings-line" }, summary());
    const change = el("span", { class: "settings-change" }, "Change");
    const details = el(
      "details",
      { class: "settings", id: `${prefix}-settings` },
      el("summary", {}, el("span", { class: "settings-title" }, "Game settings"), change, line),
      form(),
    );
    shown.set(line, () => line.replaceChildren(...summary()));
    details.addEventListener("toggle", () => (change.textContent = details.open ? "Done" : "Change"));
    return details;
  }
  // lock(true) while a game is on; the lobby calls it.
  function lock(on) {
    locked = on;
    refresh();
  }
  return { get: () => ({ ...config }), summary, panel, form, lock };
}
