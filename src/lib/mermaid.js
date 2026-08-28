/* ------------------------------------------------------------------
   Mermaid, wearing the design system — and fetched only if a diagram is
   actually asked for.

   The renderer is by far the heaviest thing this page can pull, and a
   reader on the flashcard tab may never see a diagram at all. So it is
   not imported at the top of a module: mermaidReady() imports it the
   first time a <Mermaid /> mounts, configures it once, and hands the
   same instance to everything after.
   ------------------------------------------------------------------ */

/* These rules must live in themeCSS, not in the page stylesheet: mermaid
   measures every label to size its box, so styling applied afterwards would
   leave the text clipped or floating. */
const MERMAID_CSS = `
  .nodeLabel, .nodeLabel p {
    text-align: left !important;
    white-space: pre !important;      /* keeps code indentation, never re-wraps */
    line-height: 1.55 !important;
  }
  .cluster-label .nodeLabel, .cluster-label .nodeLabel p {
    text-align: center !important;
    white-space: nowrap !important;   /* a wrapped group title overlaps its first node */
    font-weight: 600;
    color: #01588D;
  }
  g.code .nodeLabel, g.code .nodeLabel p {
    font-family: 'JetBrains Mono', SFMono-Regular, Menlo, monospace !important;
    font-size: 0.92em;
  }
  .edgeLabel, .edgeLabel p { font-size: 0.86em; }
`;

/** Everything the theme decides, applied at initialize(). */
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "loose",
  theme: "base",
  themeCSS: MERMAID_CSS,
  fontFamily: "'Noto Sans','Noto Sans JP',system-ui,sans-serif",
  /* wrappingWidth high enough that only our own <br/> breaks the lines —
     mermaid's default of 200 would re-wrap and destroy code indentation. */
  flowchart: {
    htmlLabels: true,
    curve: "basis",
    nodeSpacing: 24,
    rankSpacing: 34,
    padding: 12,
    wrappingWidth: 1200,
    useMaxWidth: false,
  },
  sequence: {
    useMaxWidth: false,
    wrap: true,
    width: 190,
    actorFontFamily: "'Noto Sans',sans-serif",
    noteFontFamily: "'Noto Sans',sans-serif",
    messageFontFamily: "'Noto Sans',sans-serif",
  },
  themeVariables: {
    background: "#FFFFFF",
    primaryColor: "#EDF6FF" /* secondary.400        */,
    primaryBorderColor: "#A8BFDB" /* secondary.600        */,
    primaryTextColor: "#102A43" /* primary.500          */,
    lineColor: "#748FB7" /* secondary.700        */,
    textColor: "#102A43",
    mainBkg: "#EDF6FF",
    nodeBorder: "#A8BFDB",
    clusterBkg: "#FAFDFF" /* secondary.100        */,
    clusterBorder: "#D5DDEA" /* neutrals.hawkesBlue  */,
    titleColor: "#01588D" /* azure.700            */,
    edgeLabelBackground: "#FFFFFF",
    fontSize: "13px",
    /* sequence diagram */
    actorBkg: "#EFF0FF" /* punkPrimary.100       */,
    actorBorder: "#878EFF" /* punkPrimary.300       */,
    actorTextColor: "#102A43",
    actorLineColor: "#A8BFDB",
    signalColor: "#102A43",
    signalTextColor: "#102A43",
    labelBoxBkg: "#E7F3FF",
    labelBoxBorderColor: "#A8BFDB",
    labelTextColor: "#102A43",
    noteBkgColor: "#FCF4D8" /* neutrals.lightYellow */,
    noteBorderColor: "#DB7600" /* alert.warningIcon    */,
    noteTextColor: "#102A43",
  },
};

/** The one import of mermaid, kept so it happens at most once. @type {Promise<any>|null} */
let mermaidModulePromise = null;

/**
 * The configured renderer. First call fetches and themes it; every call
 * after gets the same promise.
 * @returns {Promise<any>}
 */
export function mermaidReady() {
  return (mermaidModulePromise ||= import("mermaid").then(
    ({ default: mermaid }) => {
      mermaid.initialize(MERMAID_CONFIG);
      return mermaid;
    },
  ));
}

/* one shared palette of node classes, appended to every flowchart so the
   individual definitions stay readable. */
const SHARED_CLASS_DEFINITIONS = [
  "",
  "classDef ok fill:#DEF2D5,stroke:#298000,color:#102A43",
  "classDef bad fill:#FEE1DD,stroke:#CE3504,color:#102A43",
  "classDef warn fill:#FCF4D8,stroke:#DB7600,color:#102A43",
  "classDef hot fill:#EFF0FF,stroke:#312DFF,color:#102A43",
  "classDef muted fill:#F8F9FB,stroke:#CAD0DD,color:#69697A",
  "classDef code fill:#EDF6FF,stroke:#A8BFDB,color:#102A43",
  "",
].join("\n");

/**
 * Appends the shared classDef palette to a flowchart, so each card
 * definition can stay about its own boxes.
 * @param {string} diagramDefinition
 * @returns {string}
 */
export const withSharedClasses = (diagramDefinition) =>
  /^\s*flowchart/.test(diagramDefinition)
    ? diagramDefinition + SHARED_CLASS_DEFINITIONS
    : diagramDefinition;

/* mermaid always emits width="100%" plus a max-width style, which shrinks a
   wide diagram until its labels are unreadable. Pin the SVG to the natural
   size in its viewBox instead and let the container scroll — the zoom overlay
   re-scales it with a CSS override. */
/**
 * @param {string} svgMarkup Rendered mermaid SVG.
 * @returns {string} The same SVG, sized from its viewBox.
 */
export function sizeFromViewBox(svgMarkup) {
  const viewBoxMatch = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svgMarkup);
  if (!viewBoxMatch) return svgMarkup;

  const naturalWidth = Math.ceil(+viewBoxMatch[1]);
  const naturalHeight = Math.ceil(+viewBoxMatch[2]);
  return svgMarkup
    .replace(/ width="100%"/, ' width="' + naturalWidth + '"')
    .replace(/ style="max-width:[^"]*"/, ' height="' + naturalHeight + '"');
}
