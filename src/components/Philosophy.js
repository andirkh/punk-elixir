/* Panel 1 — why the thing works the way it does, ending in a picture and
   one sentence worth keeping. */

import { html } from "../html.js";
import { state, openDiagramZoom } from "../store.js";
import { prose } from "../lib/highlight.js";
import { Mermaid } from "./Mermaid.js";
import { Loading } from "./Loading.js";

export function Philosophy() {
  const card = state.currentCard.value;
  const cardContent = state.currentCardContent.value;

  if (!cardContent)
    return html`<div class="p-5"><${Loading} what="the essay" /></div>`;
  const philosophy = cardContent.philosophy;

  return html` <div class="p-5 fade-in" key=${card.slug}>
    <p
      class="text-[15px] leading-relaxed text-azure-700 font-semibold mb-5 border-l-[3px] border-azure-500 pl-3.5"
      dangerouslySetInnerHTML=${{ __html: prose(philosophy.lead) }}
    ></p>

    ${philosophy.body.map(
        (paragraph) =>
          html` <p
            class="text-[13.5px] leading-[1.75] text-neutrals-black mb-4"
            dangerouslySetInnerHTML=${{ __html: prose(paragraph) }}
          ></p>`,
      )}

    <div class="my-5">
      <div
        class="text-[10px] uppercase tracking-[0.18em] text-neutrals-grey mb-2"
      >
        the picture
      </div>
      <div class="diagram" title="tap to enlarge" onClick=${openDiagramZoom}>
        <${Mermaid}
          diagramDefinition=${philosophy.diagram}
          className="mermaid-fit"
        />
      </div>
      <div class="text-[10px] text-neutrals-grey mt-1.5">
        tap the diagram to enlarge
      </div>
    </div>

    <div
      class="rounded-xl border border-alert-warningIcon/30 bg-neutrals-lightYellow px-4 py-3"
    >
      <div
        class="text-[10px] uppercase tracking-[0.18em] text-alert-warningIcon mb-1.5"
      >
        take this with you
      </div>
      <div
        class="text-[13px] leading-relaxed text-neutrals-black"
        dangerouslySetInnerHTML=${{ __html: prose(philosophy.takeaway) }}
      ></div>
    </div>
  </div>`;
}
