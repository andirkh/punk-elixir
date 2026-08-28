/* ------------------------------------------------------------------
   Progress, in localStorage.

   Everything here is best-effort: a private window with storage denied
   should cost you persistence, never the app.
   ------------------------------------------------------------------ */

import { CARDS } from "../deck.js";

const STORAGE_KEY = "PunkElixir.v2";

/**
 * The shape on disk. Its keys are short and a little cryptic because
 * they are a wire format older versions already wrote — renaming one
 * would silently throw away a reader's progress, so they stay put and
 * the store gives them proper names on the way in and out.
 * @typedef  {object} SavedState
 * @property {number}            [idx]       Card position last shown.
 * @property {(string|number)[]} [known]     Mastered cards — slugs now, numbers before.
 * @property {number[]}          [widths]    Panel flex weights.
 * @property {boolean[]}         [collapsed] Panel collapse flags.
 * @property {number}            [tab]       Active tab on narrow screens.
 */

/** @returns {SavedState} Whatever the last session left, or nothing. */
export function loadSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (storageError) {
    return {};
  }
}

/** @param {SavedState} stateToSave */
export function saveState(stateToSave) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  } catch (storageError) {
    /* storage denied or full — the session still works, it just forgets. */
  }
}

/**
 * Mastered cards, as a set of slugs.
 *
 * Decks saved before cards were files recorded mastery as card numbers;
 * read those through the current order once, then they are slugs forever.
 * @param {SavedState} savedState
 * @returns {Set<string>}
 */
export function restoreMasteredSlugs(savedState) {
  const slugs = (savedState.known || [])
    .map((slugOrLegacyCardNumber) =>
      typeof slugOrLegacyCardNumber === "number"
        ? (CARDS[slugOrLegacyCardNumber - 1] || {}).slug
        : slugOrLegacyCardNumber,
    )
    .filter(Boolean);
  return new Set(/** @type {string[]} */ (slugs));
}
