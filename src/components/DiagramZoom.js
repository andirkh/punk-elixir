/* The diagram, filling the screen. `zoom` rather than `transform` so the
   scroll container grows with the picture instead of clipping it. */

import { html } from "../html.js";
import { state, zoomDiagramBy, closeDiagramZoom } from "../store.js";
import { Mermaid } from "./Mermaid.js";

/** One press of + or − moves the diagram this many percentage points. */
const ZOOM_STEP_PERCENT = 25;

export function DiagramZoom() {
  const card = state.currentCard.value;
  const cardContent = state.currentCardContent.value;
  if (!cardContent) return null;

  return html` <div
    class="fixed inset-0 z-50 bg-primary-500/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-6"
    onClick=${closeDiagramZoom}
  >
    <div
      class="w-full sm:w-auto max-w-[98vw] max-h-[94vh] flex flex-col rounded-2xl border border-neutrals-greyTableBorder bg-neutrals-white p-3 sm:p-6 shadow-cardShadow"
      onClick=${(clickEvent) => clickEvent.stopPropagation()}
    >
      <div class="flex items-center justify-between mb-3 gap-3 shrink-0">
        <div
          class="text-[11px] uppercase tracking-[0.18em] text-punkPrimary-500 truncate"
        >
          ${card.position}. ${card.title}
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <button
            onClick=${() => zoomDiagramBy(-ZOOM_STEP_PERCENT)}
            title="zoom out"
            class="w-7 h-7 grid place-items-center rounded-lg border border-neutrals-hawkesBlue text-neutrals-greyDark hover:text-punkPrimary-500 hover:border-punkPrimary-400 text-[13px] leading-none"
          >
            −
          </button>
          <button
            onClick=${() => zoomDiagramBy(ZOOM_STEP_PERCENT)}
            title="zoom in"
            class="w-7 h-7 grid place-items-center rounded-lg border border-neutrals-hawkesBlue text-neutrals-greyDark hover:text-punkPrimary-500 hover:border-punkPrimary-400 text-[13px] leading-none"
          >
            +
          </button>
          <button
            onClick=${closeDiagramZoom}
            title="close"
            class="w-7 h-7 grid place-items-center rounded-lg border border-neutrals-hawkesBlue text-neutrals-grey hover:text-primary-500 text-base leading-none"
          >
            ✕
          </button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-auto">
        <div
          class="diagram-zoom"
          style=${{ zoom: state.diagramZoomPercent.value / 100 }}
        >
          <${Mermaid}
            diagramDefinition=${cardContent.philosophy.diagram}
            className="mermaid-grow"
          />
        </div>
      </div>
    </div>
  </div>`;
}
