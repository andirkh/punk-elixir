/* The gap a card leaves while its file is on the way.

   Card files are a few kilobytes and the deck prefetches the neighbours
   of whatever you are reading, so this is usually a flicker or nothing
   at all — but it is the honest thing to show, and it holds the panel's
   shape so nothing jumps when the text lands. */

import { html } from "../html.js";

/**
 * @param {{ what: string, className?: string }} props
 * @param {string} props.what Named in the message: "loading the essay…".
 */
export function Loading({ what, className = "min-h-[200px]" }) {
  return html` <div
    class="${className} grid place-items-center rounded-2xl border border-dashed border-neutrals-hawkesBlue bg-neutrals-greybg"
  >
    <span class="text-footnote text-neutrals-grey animate-pulse"
      >loading ${what}…</span
    >
  </div>`;
}
