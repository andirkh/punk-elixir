/* The frame around each of the three columns: a title bar, and a rail to
   collapse into when the reader wants the room. */

import { html } from "../html.js";
import { state, togglePanelCollapsed } from "../store.js";

/**
 * @param {object}   props
 * @param {string}   props.title
 * @param {string}   props.tint         Tailwind text colour for the title.
 * @param {string}   [props.badge]      Small note on the right of the bar.
 * @param {number}   props.panelIndex   Which panel this is; drives collapse.
 * @param {unknown}  props.children
 */
export function Panel({ title, tint, badge, panelIndex, children }) {
  const isCollapsed =
    state.isWideLayout.value && state.collapsedPanels.value[panelIndex];
  const canCollapse =
    state.isWideLayout.value && state.openPanelCount.value > 1;
  const toggleThisPanel = () => togglePanelCollapsed(panelIndex);

  if (isCollapsed) {
    return html` <section
      class="flex flex-col items-center min-h-0 h-full w-full border border-neutrals-greyTableBorder rounded-2xl bg-neutrals-white overflow-hidden shadow-cardInfo"
    >
      <button
        onClick=${toggleThisPanel}
        title="expand panel"
        class="w-full shrink-0 py-2.5 border-b border-neutrals-greyTableBorder bg-secondary-300
                       text-neutrals-greyDark hover:text-punkPrimary-500 text-caption leading-none"
      >
        +
      </button>
      <button
        onClick=${toggleThisPanel}
        class="flex-1 min-h-0 w-full flex items-center justify-center cursor-pointer"
      >
        <span
          class="vtext text-[11px] font-bold uppercase tracking-[0.18em] ${tint} whitespace-nowrap"
          >${title}</span
        >
      </button>
    </section>`;
  }

  return html` <section
    class="flex flex-col min-h-0 h-full w-full border border-neutrals-greyTableBorder rounded-2xl bg-neutrals-white overflow-hidden shadow-cardInfo"
  >
    <header
      class="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-neutrals-greyTableBorder bg-secondary-300"
    >
      <h2
        class="text-[11px] font-bold uppercase tracking-[0.18em] ${tint} truncate"
      >
        ${title}
      </h2>
      <div class="flex items-center gap-2 shrink-0">
        ${badge ? html`<span class="text-[10px] text-neutrals-grey">${badge}</span>` : null}
        ${
          canCollapse
            ? html` <button
                onClick=${toggleThisPanel}
                title="collapse panel"
                class="w-5 h-5 grid place-items-center rounded border border-neutrals-hawkesBlue bg-neutrals-white
                           text-neutrals-greyDark hover:text-punkPrimary-500 hover:border-punkPrimary-400 text-[13px] leading-none"
              >
                −
              </button>`
            : null
        }
      </div>
    </header>
    <div class="flex-1 min-h-0 overflow-y-auto">${children}</div>
  </section>`;
}
