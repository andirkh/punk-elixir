/* ------------------------------------------------------------------
   The keyboard.

   One listener for the whole app: with the state in signals there is no
   component that has to own this, and no dependency array to keep in
   step. The hints under the flashcard are generated from the same list,
   so they cannot drift from what the keys actually do.
   ------------------------------------------------------------------ */

import {
  state,
  moveThroughDeck,
  flipCard,
  toggleMastered,
  togglePanelCollapsed,
  setActiveTab,
  setDeckDrawerOpen,
  closeDiagramZoom,
} from "./store.js";

/** What the flashcard panel prints under the buttons. */
export const KEY_HINTS = [
  { keys: ["←", "→"], action: "move" },
  { keys: ["space"], action: "flip" },
  { keys: ["m"], action: "mastered" },
  { keys: ["/"], action: "deck" },
  { keys: ["1", "2", "3"], action: "collapse panel" },
];

const PANEL_KEYS = ["1", "2", "3"];

/** Binds the shortcuts to the window. Called once, at start. */
export function bindKeys() {
  window.addEventListener("keydown", (keyboardEvent) => {
    const eventTarget = /** @type {HTMLElement} */ (keyboardEvent.target);
    if (eventTarget && /^(INPUT|TEXTAREA)$/.test(eventTarget.tagName)) {
      return; // the drawer's search box
    }

    const pressedKey = keyboardEvent.key;

    if (pressedKey === "ArrowRight" || pressedKey === "j") {
      keyboardEvent.preventDefault();
      moveThroughDeck(1);
    } else if (pressedKey === "ArrowLeft" || pressedKey === "k") {
      keyboardEvent.preventDefault();
      moveThroughDeck(-1);
    } else if (pressedKey === " " || pressedKey === "Enter") {
      keyboardEvent.preventDefault();
      flipCard();
    } else if (pressedKey === "m") {
      toggleMastered();
    } else if (PANEL_KEYS.includes(pressedKey)) {
      /* Wide enough for all three panels? Collapse the one named.
         Otherwise the same key picks which single panel is on screen. */
      const panelIndex = PANEL_KEYS.indexOf(pressedKey);
      if (state.isWideLayout.value) togglePanelCollapsed(panelIndex);
      else setActiveTab(panelIndex);
    } else if (pressedKey === "/") {
      keyboardEvent.preventDefault();
      setDeckDrawerOpen(true);
    } else if (pressedKey === "Escape") {
      setDeckDrawerOpen(false);
      closeDiagramZoom();
    }
  });
}
