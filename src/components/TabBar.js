/* Narrow screens get one panel at a time, chosen here. */

import { html } from "../html.js";
import { state, setActiveTab } from "../store.js";

/** Title and tint of each panel, in order. Shared with App. */
export const PANEL_TABS = [
  { label: "Philosophy", tint: "text-azure-700" },
  { label: "Flashcard", tint: "text-punkPrimary-500" },
  { label: "Code", tint: "text-alert-succeedBg" },
];

/** The Code tab is the only one that carries a count. */
const CODE_TAB_INDEX = 2;

export function TabBar() {
  const activeTabIndex = state.activeTabIndex.value;
  const cardContent = state.currentCardContent.value;
  const codeSampleCount = cardContent ? cardContent.codeSamples.length : 0;

  return html` <nav class="shrink-0 flex gap-1.5 px-3 pt-3">
    ${PANEL_TABS.map(
        (tab, tabIndex) =>
          html` <button
            onClick=${() => setActiveTab(tabIndex)}
            class="flex-1 min-w-0 px-1 py-2 rounded-xl border text-[10.5px] font-bold uppercase tracking-[0.12em] truncate transition
                       ${
                         tabIndex === activeTabIndex
                           ? "bg-neutrals-white border-neutrals-greyTableBorder shadow-cardInfo " +
                             tab.tint
                           : "bg-transparent border-transparent text-neutrals-grey"
                       }"
          >
            ${tab.label}
            ${
            tabIndex === CODE_TAB_INDEX && codeSampleCount
              ? html`<span class="ml-1 font-normal opacity-60"
                  >${codeSampleCount}</span
                >`
              : null
          }
          </button>`,
      )}
  </nav>`;
}
