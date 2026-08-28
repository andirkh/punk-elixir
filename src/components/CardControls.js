/* Previous · mastered · next, under the flashcard. */

import { html } from "../html.js";
import { CARDS } from "../deck.js";
import {
  state,
  moveThroughDeck,
  toggleMastered,
  isMastered,
} from "../store.js";

const STEP_BUTTON_CLASS =
  "flex-1 py-2.5 rounded-xl border border-neutrals-hawkesBlue bg-neutrals-white text-neutrals-greyDark " +
  "text-footnote hover:border-punkPrimary-400 hover:text-punkPrimary-500 disabled:opacity-40";

export function CardControls() {
  const card = state.currentCard.value;
  const cardIndex = state.currentCardIndex.value;
  const isCardMastered = isMastered(card);

  return html` <div class="flex items-center gap-2">
    <button
      onClick=${() => moveThroughDeck(-1)}
      disabled=${cardIndex === 0}
      class=${STEP_BUTTON_CLASS}
    >
      ← prev
    </button>
    <button
      onClick=${toggleMastered}
      class="px-4 py-2.5 rounded-xl border text-footnote transition whitespace-nowrap
                     ${
                       isCardMastered
                         ? "border-alert-succeedBg text-alert-succeedBg bg-alert-succeedBgLight font-semibold"
                         : "border-neutrals-hawkesBlue bg-neutrals-white text-neutrals-greyDark hover:border-alert-succeedBg hover:text-alert-succeedBg"
                     }"
    >
      ${isCardMastered ? "✓ mastered" : "mark mastered"}
    </button>
    <button
      onClick=${() => moveThroughDeck(1)}
      disabled=${cardIndex === CARDS.length - 1}
      class=${STEP_BUTTON_CLASS}
    >
      next →
    </button>
  </div>`;
}
