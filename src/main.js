/* ------------------------------------------------------------------
   The entry point, and the only script index.html names.

   Everything below it is reached by `import` — the browser walks the
   graph itself, fetches each module once, and runs them in order. There
   is no bundler, no transpiler and no load-order list to keep in step:
   the imports at the top of each file are the load order.

   What is deliberately *not* imported here is the deck's contents. Only
   the table of contents arrives at start; a card's prose, diagram and
   snippets are imported when the card is opened, and mermaid when the
   first diagram is drawn.
   ------------------------------------------------------------------ */

import { render } from "preact";
import { html } from "./html.js";
import { startStore } from "./store.js";
import { bindKeys } from "./keys.js";
import { App } from "./components/App.js";

startStore();
bindKeys();

render(html`<${App} />`, document.getElementById("root"));
