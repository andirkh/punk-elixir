/* One snippet, with a copy button. */

import { useState } from "preact/hooks";
import { html } from "../html.js";
import { highlight } from "../lib/highlight.js";
import { copyText } from "../lib/clipboard.js";

/** How long the button says "copied" before going back to "copy". */
const COPIED_LABEL_DURATION_MS = 1400;

/**
 * @param {{ codeSample: import('../types.js').CodeSample }} props
 */
export function CodeBlock({ codeSample }) {
  const [hasJustCopied, setHasJustCopied] = useState(false);

  const copySnippet = () => {
    copyText(codeSample.code);
    setHasJustCopied(true);
    setTimeout(() => setHasJustCopied(false), COPIED_LABEL_DURATION_MS);
  };

  return html` <div
    class="rounded-xl border border-neutrals-greyTableBorder bg-neutrals-white overflow-hidden mb-4 shadow-cardInfo"
  >
    <div
      class="flex items-start justify-between gap-3 px-3.5 py-2.5 border-b border-neutrals-greyTableBorder bg-neutrals-greybg"
    >
      <div class="min-w-0">
        <div class="text-footnote font-semibold text-primary-500 truncate">
          ${codeSample.title}
        </div>
        ${codeSample.note ? html`<div class="text-[11px] text-neutrals-greyDark mt-0.5 leading-snug">${codeSample.note}</div>` : null}
      </div>
      <button
        onClick=${copySnippet}
        class="shrink-0 text-[10.5px] uppercase tracking-wider px-2.5 py-1 rounded-md border transition
                 ${
                   hasJustCopied
                     ? "border-alert-succeedBg text-alert-succeedBg bg-alert-succeedBgLight"
                     : "border-neutrals-hawkesBlue text-neutrals-greyDark hover:text-punkPrimary-500 hover:border-punkPrimary-400"
                 }"
      >
        ${hasJustCopied ? "copied" : "copy"}
      </button>
    </div>
    <pre
      class="code px-3.5 py-3 bg-neutrals-white"
      dangerouslySetInnerHTML=${{ __html: highlight(codeSample.code) }}
    ></pre>
  </div>`;
}
