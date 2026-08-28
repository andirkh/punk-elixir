/* The draggable seam between two panels. Inert when either neighbour is
   collapsed — there is nothing to trade width with. */

import { html } from "../html.js";
import { state, startGutterDrag, resetGutterPair } from "../store.js";

/**
 * @param {{ gutterIndex: number }} props The gutter sits between panel
 *   `gutterIndex` and the one after it.
 */
export function Gutter({ gutterIndex }) {
  const collapsedPanels = state.collapsedPanels.value;
  const isDraggable =
    !collapsedPanels[gutterIndex] && !collapsedPanels[gutterIndex + 1];
  const isBeingDragged = state.draggingGutterIndex.value === gutterIndex;

  return html` <div
    class="gutter ${isDraggable ? "" : "gutter-static"} ${isBeingDragged ? "dragging" : ""}"
    title=${isDraggable ? "drag to resize · double-click to reset" : ""}
    onMouseDown=${isDraggable ? (mouseDownEvent) => startGutterDrag(gutterIndex, mouseDownEvent) : null}
    onDblClick=${isDraggable ? () => resetGutterPair(gutterIndex) : null}
  >
    <i></i>
  </div>`;
}
