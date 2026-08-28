/* ------------------------------------------------------------------
   The state of the app, as signals.

   Three panels, a drawer, a zoom overlay and the keyboard all touch the
   same handful of facts. Passing them down as props meant every panel
   re-rendered whenever any of them moved, and the App component turned
   into a switchboard. As signals each fact stands on its own: a
   component that reads state.currentCard.value re-renders when the card
   moves and at no other time, and any component can act without being
   handed a callback first.

   Card *content* is not part of that state until it arrives. The deck
   knows every card's module, title and position from the start; its
   prose, diagram and snippets are fetched by loadCardContent() the first
   time the card is opened, and state.currentCardContent is null in the
   meantime.
   ------------------------------------------------------------------ */

import { signal, computed, effect } from "@preact/signals";
import { CARDS } from "./deck.js";
import {
  loadSavedState,
  saveState,
  restoreMasteredSlugs,
} from "./lib/storage.js";

/** @typedef {import('./types.js').Card} Card */
/** @typedef {import('./types.js').CardContent} CardContent */
/** @template T @typedef {import('./types.js').Signal<T>} Signal */

/** Panel weights before anything is dragged: philosophy, flashcard, code. */
const DEFAULT_PANEL_WIDTHS = [1.1, 0.92, 1.02];

/** Below this viewport width the three panels become three tabs. */
const WIDE_LAYOUT_MIN_VIEWPORT_WIDTH = 1024;

/** Smallest share of the row a panel can be dragged down to. */
const MIN_PANEL_WIDTH = 0.3;

/** How many panels the layout has, and therefore how many tabs and gutters. */
const PANEL_COUNT = 3;

const savedState = loadSavedState();

const restoredPanelWidths =
  Array.isArray(savedState.widths) && savedState.widths.length === PANEL_COUNT
    ? savedState.widths
    : DEFAULT_PANEL_WIDTHS.slice();

const restoredCollapsedPanels =
  Array.isArray(savedState.collapsed) &&
  savedState.collapsed.length === PANEL_COUNT
    ? savedState.collapsed
    : [false, false, false];

/** Card content that has arrived, by slug. Replaced, never mutated. */
const cardContentBySlug = signal(
  /** @type {Map<string, CardContent>} */ (new Map()),
);

/** Imports in flight, so two panels asking at once make one request. */
const contentRequestsInFlight = new Map();

/**
 * @typedef  {object} Store
 * @property {Signal<number>}            currentCardIndex     Position of the card on screen.
 * @property {Signal<boolean>}           isAnswerShowing      Is the flashcard showing its answer?
 * @property {Signal<Set<string>>}       masteredSlugs        Slugs marked mastered.
 * @property {Signal<boolean>}           isDeckDrawerOpen     Curriculum drawer.
 * @property {Signal<boolean>}           isDiagramZoomOpen    Diagram overlay.
 * @property {Signal<number>}            diagramZoomPercent   Diagram scale in the overlay, in %.
 * @property {Signal<number[]>}          panelWidths          Flex weight per panel.
 * @property {Signal<boolean[]>}         collapsedPanels      Collapse flag per panel.
 * @property {Signal<number>}            activeTabIndex       Panel shown on a narrow screen.
 * @property {Signal<boolean>}           isWideLayout         Is there room for all three panels?
 * @property {Signal<number>}            draggingGutterIndex  Gutter being dragged, or -1.
 * @property {Signal<Card>}              currentCard          The card at `currentCardIndex`, straight from the deck.
 * @property {Signal<CardContent|null>}  currentCardContent   Its content, once the import has landed.
 * @property {Signal<number>}            openPanelCount       How many panels are not collapsed.
 */

/** Everything the app knows, restored from whatever the last session saved. @type {Store} */
export const state = {
  currentCardIndex: signal(clampToDeck(savedState.idx || 0)),
  isAnswerShowing: signal(false),
  masteredSlugs: signal(restoreMasteredSlugs(savedState)),
  isDeckDrawerOpen: signal(false),
  isDiagramZoomOpen: signal(false),
  diagramZoomPercent: signal(100),
  panelWidths: signal(restoredPanelWidths),
  collapsedPanels: signal(restoredCollapsedPanels),
  activeTabIndex: signal(
    typeof savedState.tab === "number" ? savedState.tab : 1,
  ),
  isWideLayout: signal(window.innerWidth >= WIDE_LAYOUT_MIN_VIEWPORT_WIDTH),
  draggingGutterIndex: signal(-1),

  currentCard: computed(() => CARDS[state.currentCardIndex.value]),
  currentCardContent: computed(
    () => cardContentBySlug.value.get(state.currentCard.value.slug) || null,
  ),
  openPanelCount: computed(
    () =>
      state.collapsedPanels.value.filter((isCollapsed) => !isCollapsed).length,
  ),
};

/**
 * Starts the two things the store does on its own: remembering where you
 * were, and noticing when the window stops being wide enough for three
 * panels. Called once, by main.js.
 */
export function startStore() {
  /* The saved keys are deliberately the ones older versions wrote, so a
     reader who comes back keeps their place and their progress. */
  effect(() =>
    saveState({
      idx: state.currentCardIndex.value,
      known: Array.from(state.masteredSlugs.value),
      widths: state.panelWidths.value,
      collapsed: state.collapsedPanels.value,
      tab: state.activeTabIndex.value,
    }),
  );

  /* Fetch the card being read, then quietly fetch the two it is between,
     so a held-down arrow key never waits on the network. */
  effect(() => {
    const cardIndex = state.currentCardIndex.value;
    loadCardContent(CARDS[cardIndex]).then(
      () => {
        prefetchCardContent(CARDS[cardIndex + 1]);
        prefetchCardContent(CARDS[cardIndex - 1]);
      },
      () => {},
    );
  });

  window.addEventListener("resize", () => {
    state.isWideLayout.value =
      window.innerWidth >= WIDE_LAYOUT_MIN_VIEWPORT_WIDTH;
  });
}

/* ---- fetching a card ---- */

/**
 * Imports one card's file, at most once. Reads through peek() rather
 * than .value: this is called from inside an effect, and subscribing to
 * the very map it fills would make that effect chase its own tail.
 * @param {Card} card
 * @returns {Promise<CardContent>}
 */
export function loadCardContent(card) {
  const alreadyLoaded = cardContentBySlug.peek().get(card.slug);
  if (alreadyLoaded) return Promise.resolve(alreadyLoaded);

  let requestInFlight = contentRequestsInFlight.get(card.slug);
  if (!requestInFlight) {
    requestInFlight = card.loadContent().then(
      (cardModule) => {
        contentRequestsInFlight.delete(card.slug);
        const nextContentBySlug = new Map(cardContentBySlug.peek());
        nextContentBySlug.set(card.slug, cardModule.default);
        cardContentBySlug.value = nextContentBySlug;
        return cardModule.default;
      },
      (error) => {
        contentRequestsInFlight.delete(card.slug);
        console.error(`PunkElixir: could not load "${card.title}"`, error);
        throw error;
      },
    );
    contentRequestsInFlight.set(card.slug, requestInFlight);
  }
  return requestInFlight;
}

/** Loads a card we merely expect to need. A miss here is not an error. @param {Card} [card] */
function prefetchCardContent(card) {
  if (card) loadCardContent(card).catch(() => {});
}

/* ---- moving through the deck ---- */

/** @param {number} cardIndex @returns {number} The same index, inside the deck. */
function clampToDeck(cardIndex) {
  return Math.max(0, Math.min(CARDS.length - 1, cardIndex));
}

/**
 * Shows the card at `cardIndex`, clamped to the deck, and puts away
 * anything the previous card had open.
 * @param {number} cardIndex
 */
export function showCard(cardIndex) {
  const nextCardIndex = clampToDeck(cardIndex);
  if (nextCardIndex === state.currentCardIndex.value) return;
  state.currentCardIndex.value = nextCardIndex;
  state.isAnswerShowing.value = false;
  state.isDiagramZoomOpen.value = false;
}

/** @param {number} cardsToMove Negative goes back through the deck. */
export function moveThroughDeck(cardsToMove) {
  showCard(state.currentCardIndex.value + cardsToMove);
}

export function flipCard() {
  state.isAnswerShowing.value = !state.isAnswerShowing.value;
}

/* ---- mastery ---- */

/** @param {Card} card @returns {boolean} */
export function isMastered(card) {
  return state.masteredSlugs.value.has(card.slug);
}

/** Marks the card on screen mastered, or takes the mark off. */
export function toggleMastered() {
  const nextMasteredSlugs = new Set(state.masteredSlugs.value); // signals compare by identity
  const slug = state.currentCard.value.slug;
  if (nextMasteredSlugs.has(slug)) nextMasteredSlugs.delete(slug);
  else nextMasteredSlugs.add(slug);
  state.masteredSlugs.value = nextMasteredSlugs;
}

/* ---- the drawer and the diagram overlay ---- */

/** @param {boolean} isOpen */
export function setDeckDrawerOpen(isOpen) {
  state.isDeckDrawerOpen.value = isOpen;
}

/** Opens the overlay at a size that fits the dialog. */
export function openDiagramZoom() {
  state.diagramZoomPercent.value = 100;
  state.isDiagramZoomOpen.value = true;
}

export function closeDiagramZoom() {
  state.isDiagramZoomOpen.value = false;
}

/** @param {number} percentagePoints */
export function zoomDiagramBy(percentagePoints) {
  const zoomed = state.diagramZoomPercent.value + percentagePoints;
  state.diagramZoomPercent.value = Math.max(50, Math.min(500, zoomed));
}

/* ---- the panel layout ---- */

/** @param {number} tabIndex */
export function setActiveTab(tabIndex) {
  state.activeTabIndex.value = tabIndex;
}

/**
 * Collapses or expands one panel. Collapsing the last open panel would
 * leave nothing to read, so that one is refused.
 * @param {number} panelIndex
 */
export function togglePanelCollapsed(panelIndex) {
  const nextCollapsedPanels = state.collapsedPanels.value.slice();
  nextCollapsedPanels[panelIndex] = !nextCollapsedPanels[panelIndex];
  if (nextCollapsedPanels.every(Boolean)) return;
  state.collapsedPanels.value = nextCollapsedPanels;
}

/**
 * Drags the gutter at `gutterIndex`, trading width between the panels
 * either side of it. The row is the gutter's parent, so no ref has to be
 * threaded down from App.
 * @param {number} gutterIndex
 * @param {MouseEvent} mouseDownEvent
 */
export function startGutterDrag(gutterIndex, mouseDownEvent) {
  mouseDownEvent.preventDefault();
  const panelRow = /** @type {HTMLElement} */ (mouseDownEvent.currentTarget)
    .parentElement;
  if (!panelRow) return;

  const rowWidthInPixels = panelRow.getBoundingClientRect().width;
  const pointerStartX = mouseDownEvent.clientX;
  const widthsAtDragStart = state.panelWidths.value.slice();
  const totalWeight = widthsAtDragStart.reduce(
    (sum, weight) => sum + weight,
    0,
  );
  const neighbourWeight =
    widthsAtDragStart[gutterIndex] + widthsAtDragStart[gutterIndex + 1];

  state.draggingGutterIndex.value = gutterIndex;
  document.body.classList.add("resizing");

  /** @param {MouseEvent} mouseMoveEvent */
  const onMouseMove = (mouseMoveEvent) => {
    const pointerTravel = mouseMoveEvent.clientX - pointerStartX;
    const weightMoved =
      (pointerTravel / Math.max(rowWidthInPixels, 1)) * totalWeight;

    let leftWeight = widthsAtDragStart[gutterIndex] + weightMoved;
    let rightWeight = widthsAtDragStart[gutterIndex + 1] - weightMoved;
    if (leftWeight < MIN_PANEL_WIDTH) {
      leftWeight = MIN_PANEL_WIDTH;
      rightWeight = neighbourWeight - MIN_PANEL_WIDTH;
    }
    if (rightWeight < MIN_PANEL_WIDTH) {
      rightWeight = MIN_PANEL_WIDTH;
      leftWeight = neighbourWeight - MIN_PANEL_WIDTH;
    }

    const nextPanelWidths = state.panelWidths.value.slice();
    nextPanelWidths[gutterIndex] = leftWeight;
    nextPanelWidths[gutterIndex + 1] = rightWeight;
    state.panelWidths.value = nextPanelWidths;
  };

  const onMouseUp = () => {
    state.draggingGutterIndex.value = -1;
    document.body.classList.remove("resizing");
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}

/**
 * Splits the two panels either side of a gutter evenly.
 * @param {number} gutterIndex
 */
export function resetGutterPair(gutterIndex) {
  const nextPanelWidths = state.panelWidths.value.slice();
  const halfOfPair =
    (nextPanelWidths[gutterIndex] + nextPanelWidths[gutterIndex + 1]) / 2;
  nextPanelWidths[gutterIndex] = halfOfPair;
  nextPanelWidths[gutterIndex + 1] = halfOfPair;
  state.panelWidths.value = nextPanelWidths;
}

export function resetPanelLayout() {
  state.panelWidths.value = DEFAULT_PANEL_WIDTHS.slice();
  state.collapsedPanels.value = [false, false, false];
}

/**
 * The flex style for one panel wrapper: a fixed rail when collapsed, its
 * share of the row when open, and full height when the panels are tabs.
 * @param {number} panelIndex
 * @returns {Record<string, string|number>}
 */
export function panelStyle(panelIndex) {
  if (!state.isWideLayout.value) return { flex: "1 1 0", minHeight: 0 };
  if (state.collapsedPanels.value[panelIndex]) return { flex: "0 0 46px" };
  return { flex: state.panelWidths.value[panelIndex] + " 1 0%" };
}
