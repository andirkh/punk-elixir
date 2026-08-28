/* One diagram, rendered by mermaid into SVG. */

import { useState, useEffect } from "preact/hooks";
import { html } from "../html.js";
import {
  mermaidReady,
  withSharedClasses,
  sizeFromViewBox,
} from "../lib/mermaid.js";

/* mermaid needs a DOM id per render, unique for the life of the page. */
let renderedDiagramCount = 0;

/**
 * Renders a mermaid definition, fetching the renderer on first use.
 * Falls back to showing the source if a definition ever fails, so a bad
 * diagram can never blank a card.
 * @param {{ diagramDefinition: string, className?: string }} props
 */
export function Mermaid({ diagramDefinition, className }) {
  const [svgMarkup, setSvgMarkup] = useState("");
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    let isStillMounted = true;
    setSvgMarkup("");
    setHasFailed(false);

    mermaidReady()
      .then((mermaid) =>
        mermaid.render(
          "mmd-" + ++renderedDiagramCount,
          withSharedClasses(diagramDefinition),
        ),
      )
      .then((renderResult) => {
        if (isStillMounted) setSvgMarkup(sizeFromViewBox(renderResult.svg));
      })
      .catch((renderError) => {
        if (!isStillMounted) return;
        console.error("mermaid:", renderError);
        setHasFailed(true);
      });

    return () => {
      isStillMounted = false;
    };
  }, [diagramDefinition]);

  if (hasFailed)
    return html`<pre class="mermaid-src">${diagramDefinition}</pre>`;
  if (!svgMarkup) return html`<div class="mermaid-loading">drawing…</div>`;
  return html`<div
    class=${className}
    dangerouslySetInnerHTML=${{ __html: svgMarkup }}
  ></div>`;
}
