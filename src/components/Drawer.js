/* The whole curriculum, grouped by module and searchable.

   It searches titles and module names — which is everything the deck
   knows without going and fetching all ninety-nine cards, and is what a
   table of contents is for. */

import { useState } from "preact/hooks";
import { html } from "../html.js";
import { CARDS } from "../deck.js";
import { state, showCard, setDeckDrawerOpen } from "../store.js";

/** @typedef {import('../types.js').Card} Card */

/**
 * Cards whose title or module name contains the query. An empty query
 * matches the whole deck.
 * @param {string} searchQuery
 * @returns {Card[]}
 */
function searchDeck(searchQuery) {
  const normalisedQuery = searchQuery.trim().toLowerCase();
  if (!normalisedQuery) return CARDS;
  return CARDS.filter((card) =>
    (card.title + " " + card.moduleTitle)
      .toLowerCase()
      .includes(normalisedQuery),
  );
}

/**
 * Runs of cards sharing a module, in deck order — so the list reads as
 * the curriculum does, and a filtered list keeps its headings.
 * @param {Card[]} cards
 * @returns {{ moduleTitle: string, cards: Card[] }[]}
 */
function groupByModule(cards) {
  const moduleGroups = [];
  cards.forEach((card) => {
    const currentGroup = moduleGroups[moduleGroups.length - 1];
    if (currentGroup && currentGroup.moduleTitle === card.moduleTitle)
      currentGroup.cards.push(card);
    else moduleGroups.push({ moduleTitle: card.moduleTitle, cards: [card] });
  });
  return moduleGroups;
}

export function Drawer() {
  const [searchQuery, setSearchQuery] = useState("");
  if (!state.isDeckDrawerOpen.value) return null;

  const currentCardIndex = state.currentCardIndex.value;
  const masteredSlugs = state.masteredSlugs.value;
  const matchingCards = searchDeck(searchQuery);
  const moduleGroups = groupByModule(matchingCards);

  const closeDrawer = () => setDeckDrawerOpen(false);

  return html` <div
    class="fixed inset-0 z-40 bg-primary-500/50 backdrop-blur-sm"
    onClick=${closeDrawer}
  >
    <div
      class="absolute left-0 top-0 h-full w-full max-w-md bg-neutrals-white border-r border-neutrals-greyTableBorder shadow-dropdownShadow flex flex-col"
      onClick=${(clickEvent) => clickEvent.stopPropagation()}
    >
      <div class="p-4 border-b border-neutrals-greyTableBorder shrink-0">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-caption font-bold tracking-wide text-primary-500">
            CURRICULUM · ${CARDS.length} CARDS
          </h2>
          <button
            onClick=${closeDrawer}
            class="text-neutrals-grey hover:text-primary-500 text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>
        <input
          autofocus
          value=${searchQuery}
          onInput=${(inputEvent) => setSearchQuery(inputEvent.target.value)}
          placeholder="search titles and modules…"
          class="w-full bg-neutrals-greybg border border-neutrals-hawkesBlue rounded-lg px-3 py-2 text-footnote text-neutrals-black
                   placeholder:text-neutrals-grey outline-none focus:border-punkPrimary-400"
        />
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        ${moduleGroups.map(
            (moduleGroup) =>
              html` <div class="mb-4">
                <div
                  class="text-[10px] uppercase tracking-[0.18em] text-neutrals-grey px-2 mb-1.5"
                >
                  ${moduleGroup.moduleTitle}
                </div>
                ${moduleGroup.cards.map((card) => {
                const cardIndex = card.position - 1;
                const isCurrentCard = cardIndex === currentCardIndex;
                const isCardMastered = masteredSlugs.has(card.slug);

                return html` <button
                  onClick=${() => {
                      showCard(cardIndex);
                      closeDrawer();
                    }}
                  class="w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2.5 transition
                           ${
                             isCurrentCard
                               ? "bg-secondary-500 text-primary-500 font-semibold"
                               : "hover:bg-secondary-300 text-neutrals-greyDark"
                           }"
                >
                  <span
                    class="text-[10px] font-mono w-6 shrink-0 ${isCardMastered ? "text-alert-succeedBg" : "text-neutrals-greyDisabled"}"
                  >
                    ${isCardMastered ? "✓" : String(card.position).padStart(2, "0")}
                  </span>
                  <span class="text-[12.5px] truncate">${card.title}</span>
                </button>`;
              })}
              </div>`,
          )}
        ${
            matchingCards.length === 0
              ? html`<div
                  class="text-center text-neutrals-grey text-caption py-10"
                >
                  nothing matches
                </div>`
              : null
          }
      </div>
    </div>
  </div>`;
}
