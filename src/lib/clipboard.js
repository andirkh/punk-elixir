/* ------------------------------------------------------------------
   Copy to clipboard.

   The async Clipboard API needs a secure context — https, or localhost.
   Serve the deck over plain http from another machine and it is simply
   absent, which is what the execCommand path is still here for.
   ------------------------------------------------------------------ */

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard
      .writeText(text)
      .catch(() => copyViaHiddenTextarea(text));
  }
  return Promise.resolve(copyViaHiddenTextarea(text));
}

/**
 * The pre-Clipboard-API way: put the text in a textarea nobody can see,
 * select it, and let the browser's own copy command take it.
 * @param {string} text
 */
function copyViaHiddenTextarea(text) {
  const hiddenTextarea = document.createElement("textarea");
  hiddenTextarea.value = text;
  hiddenTextarea.style.position = "fixed";
  hiddenTextarea.style.opacity = "0";

  document.body.appendChild(hiddenTextarea);
  hiddenTextarea.select();
  try {
    document.execCommand("copy");
  } catch (copyError) {
    /* nothing more to try — the reader can still select the snippet. */
  }
  document.body.removeChild(hiddenTextarea);
}
