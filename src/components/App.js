/* ------------------------------------------------------------------
   The layout, and nothing else.

   Three panels side by side when there is room, one tab at a time when
   there is not. What goes inside each panel is that panel's business —
   App only decides where things sit, so it re-renders when the shape of
   the page changes rather than every time a card is flipped.
   ------------------------------------------------------------------ */

import { html } from "../html.js";
import { state, panelStyle } from "../store.js";
import { Header } from "./Header.js";
import { TabBar, PANEL_TABS } from "./TabBar.js";
import { Panel } from "./Panel.js";
import { Gutter } from "./Gutter.js";
import { Philosophy } from "./Philosophy.js";
import { StudyPanel } from "./StudyPanel.js";
import { CodeSamples } from "./CodeSamples.js";
import { DiagramZoom } from "./DiagramZoom.js";
import { Drawer } from "./Drawer.js";

const PHILOSOPHY_PANEL = 0;
const FLASHCARD_PANEL = 1;
const CODE_PANEL = 2;

export function App() {
  const isWideLayout = state.isWideLayout.value;
  const activeTabIndex = state.activeTabIndex.value;
  const card = state.currentCard.value;
  const cardContent = state.currentCardContent.value;
  const codeSampleCount = cardContent ? cardContent.codeSamples.length : 0;

  /** A panel is on screen if all three fit, or if it is the chosen tab. */
  const isPanelVisible = (panelIndex) =>
    isWideLayout || activeTabIndex === panelIndex;

  return html` <div class="h-full flex flex-col">
    <${Header} />

    ${!isWideLayout ? html`<${TabBar} />` : null}

    <main class="panels flex-1 min-h-0 p-3">
      ${
        isPanelVisible(PHILOSOPHY_PANEL)
          ? html` <div
              class="min-h-0 min-w-0"
              style=${panelStyle(PHILOSOPHY_PANEL)}
            >
              <${Panel}
                panelIndex=${PHILOSOPHY_PANEL}
                title="Philosophy"
                tint=${PANEL_TABS[PHILOSOPHY_PANEL].tint}
                badge="why it works this way"
              >
                <${Philosophy} />
              <//>
            </div>`
          : null
      }
      ${isWideLayout ? html`<${Gutter} gutterIndex=${0} />` : null}
      ${
        isPanelVisible(FLASHCARD_PANEL)
          ? html` <div
              class="min-h-0 min-w-0"
              style=${panelStyle(FLASHCARD_PANEL)}
            >
              <${Panel}
                panelIndex=${FLASHCARD_PANEL}
                title="Flashcard"
                tint=${PANEL_TABS[FLASHCARD_PANEL].tint}
                badge=${"card " + card.position}
              >
                <${StudyPanel} />
              <//>
            </div>`
          : null
      }
      ${isWideLayout ? html`<${Gutter} gutterIndex=${1} />` : null}
      ${
        isPanelVisible(CODE_PANEL)
          ? html` <div class="min-h-0 min-w-0" style=${panelStyle(CODE_PANEL)}>
              <${Panel}
                panelIndex=${CODE_PANEL}
                title="Try it in iex"
                tint=${PANEL_TABS[CODE_PANEL].tint}
                badge=${codeSampleCount ? codeSampleCount + " sample" + (codeSampleCount > 1 ? "s" : "") : ""}
              >
                <${CodeSamples} />
              <//>
            </div>`
          : null
      }
    </main>

    ${state.isDiagramZoomOpen.value ? html`<${DiagramZoom} />` : null}
    <${Drawer} />
  </div>`;
}
