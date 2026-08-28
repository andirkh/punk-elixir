/* The top bar: the deck button, where you are in the deck, how much of it
   you have mastered, and the two arrows. */

import { html } from "../html.js";
import { CARDS } from "../deck.js";
import {
  state,
  setDeckDrawerOpen,
  moveThroughDeck,
  resetPanelLayout,
} from "../store.js";

const NAV_BUTTON_CLASS =
  "px-2.5 py-1 rounded-lg border border-neutrals-hawkesBlue bg-neutrals-white text-neutrals-greyDark " +
  "hover:text-punkPrimary-500 hover:border-punkPrimary-400 disabled:opacity-40 text-caption";

export function Header() {
  const card = state.currentCard.value;
  const cardIndex = state.currentCardIndex.value;
  const masteredCount = state.masteredSlugs.value.size;
  const masteredPercent = Math.round((masteredCount / CARDS.length) * 100);
  const readPercent = ((cardIndex + 1) / CARDS.length) * 100;

  return html` <header
    class="shrink-0 border-b border-neutrals-greyTableBorder bg-neutrals-white shadow-cardInfo px-3 lg:px-4 py-2.5 flex items-center gap-2.5 lg:gap-4"
  >
    <button
      onClick=${() => setDeckDrawerOpen(true)}
      class="shrink-0 text-neutrals-greyDark hover:text-punkPrimary-500 px-2 py-1 rounded-lg border border-neutrals-hawkesBlue hover:border-punkPrimary-400 text-[11px] tracking-wide"
    >
      ☰<span class="hidden sm:inline"> deck</span>
    </button>

    <div class="flex items-baseline gap-2.5 min-w-0">
      <span
        class="font-bold tracking-tight text-[15px] text-primary-500 whitespace-nowrap"
        >Punk<span class="text-punkPrimary-500">Elixir</span></span
      >
      <span class="hidden lg:inline text-[11px] text-neutrals-greyDark truncate"
        >${card.moduleTitle}</span
      >
    </div>

    <div class="flex-1 flex items-center gap-2 lg:gap-3 min-w-0">
      <div
        class="h-1.5 flex-1 rounded-full bg-neutrals-hawkesBlue overflow-hidden max-w-md"
      >
        <div
          class="h-full bg-gradient-to-r from-azure-500 to-punkPrimary-500 transition-all duration-300"
          style=${{ width: readPercent + "%" }}
        ></div>
      </div>
      <span class="text-[11px] font-mono text-neutrals-greyDark shrink-0"
        >${String(cardIndex + 1).padStart(2, "0")}/${CARDS.length}</span
      >
    </div>

    <div
      class="hidden xl:flex items-center gap-2 text-[11px] text-neutrals-greyDark shrink-0"
    >
      <span class="text-alert-succeedBg font-semibold">${masteredCount}</span>
      mastered · ${masteredPercent}%
    </div>

    <div class="flex items-center gap-1.5 shrink-0">
      <button
        onClick=${resetPanelLayout}
        title="reset panel layout"
        class="hidden lg:block px-2.5 py-1 rounded-lg border border-neutrals-hawkesBlue bg-neutrals-white
                       text-neutrals-greyDark hover:text-punkPrimary-500 hover:border-punkPrimary-400 text-[11px]"
      >
        ⤢
      </button>
      <button
        onClick=${() => moveThroughDeck(-1)}
        disabled=${cardIndex === 0}
        class=${NAV_BUTTON_CLASS}
      >
        ←
      </button>
      <button
        onClick=${() => moveThroughDeck(1)}
        disabled=${cardIndex === CARDS.length - 1}
        class=${NAV_BUTTON_CLASS}
      >
        →
      </button>
    </div>
  </header>`;
}
