/* The card itself: question on the front, answer on the back, one
   rotateY between them. */

import { html } from "../html.js";
import { state, flipCard, isMastered } from "../store.js";
import { prose } from "../lib/highlight.js";
import { Loading } from "./Loading.js";

export function Flashcard() {
  const card = state.currentCard.value;
  const cardContent = state.currentCardContent.value;
  const isAnswerShowing = state.isAnswerShowing.value;
  const isCardMastered = isMastered(card);

  if (!cardContent) {
    return html`<${Loading}
      what="the card"
      className="min-h-[240px] sm:min-h-[300px]"
    />`;
  }

  return html` <div
    class="flip w-full cursor-pointer select-none"
    onClick=${flipCard}
  >
    <div class="flip-inner ${isAnswerShowing ? "flipped" : ""}">
      <div class="face">
        <div
          class="rounded-2xl border border-punkPrimary-200 bg-gradient-to-br from-secondary-300 to-secondary-500 p-5 sm:p-6 shadow-cardShadow min-h-[240px] sm:min-h-[300px] flex flex-col"
        >
          <div class="flex items-center gap-2 mb-5">
            <span
              class="text-[10px] uppercase tracking-[0.2em] text-punkPrimary-500 font-bold"
              >question</span
            >
            <span class="h-px flex-1 bg-punkPrimary-200"></span>
            ${isCardMastered ? html`<span class="text-[10px] text-alert-succeedBg font-semibold">✓ known</span>` : null}
          </div>
          <h3 class="text-header3 font-bold leading-snug text-primary-500 mb-4">
            ${card.title}
          </h3>
          <p
            class="text-[14.5px] leading-relaxed text-neutrals-black flex-1"
            dangerouslySetInnerHTML=${{ __html: prose(cardContent.front) }}
          ></p>
          <div
            class="mt-6 text-[11px] text-neutrals-greyDark flex items-center gap-2"
          >
            <kbd
              class="px-1.5 py-0.5 rounded border border-neutrals-hawkesBlue bg-neutrals-white"
              >space</kbd
            >
            <span>or click to reveal</span>
          </div>
        </div>
      </div>

      <div class="face face-back">
        <div
          class="rounded-2xl border border-alert-succeedBg/40 bg-alert-succeedBgLight p-5 sm:p-6 shadow-cardInfo min-h-[240px] sm:min-h-[300px] flex flex-col"
        >
          <div class="flex items-center gap-2 mb-5">
            <span
              class="text-[10px] uppercase tracking-[0.2em] text-alert-succeedBg font-bold"
              >answer</span
            >
            <span class="h-px flex-1 bg-alert-succeedBg/25"></span>
          </div>
          <p
            class="text-[14.5px] leading-[1.75] text-neutrals-black flex-1"
            dangerouslySetInnerHTML=${{ __html: prose(cardContent.back) }}
          ></p>
          <div class="mt-6 text-[11px] text-neutrals-greyDark">
            click to flip back
          </div>
        </div>
      </div>
    </div>
  </div>`;
}
