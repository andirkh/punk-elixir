/* Panel 2 — the flashcard and everything that moves you through the deck.
   Only the card itself waits on the card's file; the controls, the dots
   and the hints are all deck-level, and are there from the first paint. */

import { html } from "../html.js";
import { state } from "../store.js";
import { Flashcard } from "./Flashcard.js";
import { CardControls } from "./CardControls.js";
import { Progress } from "./Progress.js";
import { KeyHints } from "./KeyHints.js";

export function StudyPanel() {
  return html` <div
    class="p-4 sm:p-5 flex flex-col gap-4 fade-in"
    key=${state.currentCard.value.slug}
  >
    <${Flashcard} />
    <${CardControls} />
    <${Progress} />
    <${KeyHints} />
  </div>`;
}
