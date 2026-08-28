/* Panel 3 — the card's snippets, ready to paste into iex. */

import { html } from "../html.js";
import { state } from "../store.js";
import { CodeBlock } from "./CodeBlock.js";
import { Loading } from "./Loading.js";

export function CodeSamples() {
  const card = state.currentCard.value;
  const cardContent = state.currentCardContent.value;

  if (!cardContent)
    return html`<div class="p-4"><${Loading} what="the snippets" /></div>`;

  return html` <div class="p-4 fade-in" key=${card.slug}>
    ${cardContent.codeSamples.map(
        (codeSample, sampleIndex) =>
          html` <${CodeBlock}
            codeSample=${codeSample}
            key=${card.slug + "-" + sampleIndex}
          />`,
      )}
  </div>`;
}
