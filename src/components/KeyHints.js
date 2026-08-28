/* The shortcuts, printed from the same list that binds them. */

import { html } from "../html.js";
import { KEY_HINTS } from "../keys.js";

const KBD_CLASS =
  "px-1 rounded bg-neutrals-solitude border border-neutrals-hawkesBlue";

export function KeyHints() {
  return html` <div
    class="hidden lg:block text-[11px] text-neutrals-grey leading-relaxed"
  >
    <span class="text-neutrals-greyDark">keys:</span>
    ${KEY_HINTS.map(
      (hint, hintIndex) =>
        html` ${hintIndex ? html`<span> · </span>` : null}
          ${hint.keys.map((keyLabel) => html`<kbd class=${KBD_CLASS}>${keyLabel}</kbd> `)}
          <span>${hint.action}</span>`,
    )}
  </div>`;
}
