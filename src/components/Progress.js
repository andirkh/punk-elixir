/* Where you are: the module you are in, and a dot per card — green for
   mastered, so the whole curriculum is one glance wide. */

import { html } from "../html.js";
import { CARDS } from "../deck.js";
import { state, showCard } from "../store.js";

export function Progress() {
  const card = state.currentCard.value;
  const cardIndex = state.currentCardIndex.value;
  const masteredSlugs = state.masteredSlugs.value;

  /** Green when mastered, blue for the card you are on, grey otherwise. */
  const dotColour = (deckCard, deckIndex) => {
    if (deckIndex === cardIndex) return "bg-punkPrimary-500";
    if (masteredSlugs.has(deckCard.slug)) return "bg-alert-succeedBg/70";
    return "bg-neutrals-greyDisabled hover:bg-neutrals-grey";
  };

  return html` <div
    class="rounded-xl border border-neutrals-greyTableBorder bg-neutrals-greybg px-4 py-3"
  >
    <div
      class="text-[10px] uppercase tracking-[0.18em] text-neutrals-grey mb-2"
    >
      where you are
    </div>
    <div class="text-footnote text-neutrals-greyDark leading-relaxed">
      <span class="text-azure-700 font-semibold">${card.moduleTitle}</span> ·
      card ${card.position} of ${CARDS.length}
    </div>
    <div class="mt-3 flex flex-wrap gap-1">
      ${CARDS.map(
        (deckCard, deckIndex) =>
          html` <button
            title=${deckCard.position + ". " + deckCard.title}
            onClick=${() => showCard(deckIndex)}
            class="h-2 w-2.5 sm:h-1.5 sm:w-[9px] rounded-full transition ${dotColour(deckCard, deckIndex)}"
          ></button>`,
      )}
    </div>
  </div>`;
}
