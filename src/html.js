/* ------------------------------------------------------------------
   The tagged template every component renders with.

   htm is JSX's grammar without JSX's compiler: bound to preact's h once,
   here, it turns `html`<${App} />`` into the same virtual DOM a build
   step would have produced — except the browser did it, from the source
   you can read with View Source.
   ------------------------------------------------------------------ */

import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);
