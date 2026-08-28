/* ------------------------------------------------------------------
   Shapes, for the editor's benefit.

   Nothing here reaches the browser as behaviour — it is all JSDoc, so
   the types live with the code without a compiler standing between the
   source you write and the source you serve. Other modules pull them in
   with `@typedef {import('./types.js').Card} Card`.
   ------------------------------------------------------------------ */

/**
 * One runnable snippet shown in the "Try it in iex" panel.
 * @typedef  {object} CodeSample
 * @property {string} title  Heading above the snippet.
 * @property {string} [note] One line of context under the heading.
 * @property {string} code   The snippet itself; highlighted, never executed.
 */

/**
 * The essay half of a card: why the thing works the way it does.
 * @typedef  {object} Philosophy
 * @property {string}   lead     Pull quote at the top.
 * @property {string[]} body     Paragraphs, prose-marked (`code`, **bold**, *em*).
 * @property {string}   diagram  A mermaid definition — see lib/mermaid.js.
 * @property {string}   takeaway The one sentence to keep.
 */

/**
 * What a file in src/cards/ default-exports: the card itself, and
 * nothing about where it sits. Its module and title live in deck.js,
 * which is what lets the deck be read without fetching the cards.
 * @typedef  {object} CardContent
 * @property {string}       front       The question.
 * @property {string}       back        The answer.
 * @property {Philosophy}   philosophy
 * @property {CodeSample[]} codeSamples
 */

/**
 * A card as the deck knows it before its content is fetched: where it
 * sits, what it is called, and how to go and get it.
 * @typedef  {object} Card
 * @property {string} moduleTitle  Module heading, e.g. "6 · Concurrency".
 * @property {string} title        Unique within the deck; the slug derives from it.
 * @property {string} slug         Identity — what mastery is saved under.
 * @property {number} position     Place in the deck, counting from 1.
 * @property {() => Promise<{ default: CardContent }>} loadContent
 */

/**
 * A preact signal, as far as this app is concerned.
 * @template T
 * @typedef {{ value: T }} Signal
 */

export {};
