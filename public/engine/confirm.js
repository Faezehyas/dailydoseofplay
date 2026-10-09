// A yes-or-no question in a modal <dialog>, styled like the site. Focus moves
// to Cancel; Esc or Cancel says no; focus then goes back where it was.
import { el } from "./shell.js";

export function confirmDialog({ title, text, yes, no = "Cancel" }) {
  const back = document.activeElement;
  const dialog = el(
    "dialog",
    { class: "card confirm", id: "confirm", "aria-labelledby": "confirm-title", "aria-describedby": "confirm-text" },
    el("h2", { id: "confirm-title" }, title),
    el("p", { id: "confirm-text" }, text),
    el(
      "form",
      { method: "dialog", class: "confirm-actions" },
      el("button", { class: "btn", id: "confirm-no", value: "no", autofocus: true }, no),
      el("button", { class: "btn primary", id: "confirm-yes", value: "yes" }, yes),
    ),
  );
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) =>
    dialog.addEventListener("close", () => {
      dialog.remove();
      back?.focus();
      resolve(dialog.returnValue === "yes");
    }),
  );
}
