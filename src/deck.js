/* ------------------------------------------------------------------
   The curriculum — every module, and every card in it, in the order
   they are meant to be read. This list is the whole table of contents.

   Nothing here loads a card. Each title becomes an entry with a
   loadContent() that imports its file the first time that card is
   opened, so the deck costs one small module at start instead of
   ninety-nine.

   A card's file is found from its title: 'Why Elixir: the BEAM', in
   module '1 · The Ground', lives in

       cards/1-the-ground-why-elixir-the-beam.js

   so a card is added, removed or moved by touching a file and a line
   here. Nothing carries a number that has to be kept in step, and the
   slug — identity, and what mastery is saved under — comes from the
   title alone, so a card keeps its progress when it moves.
   ------------------------------------------------------------------ */

/** @typedef {import('./types.js').Card} Card */

/** @type {{ moduleTitle: string, cardTitles: string[] }[]} */
export const SYLLABUS = [
  {
    moduleTitle: "1 · The Ground",
    cardTitles: [
      "Why Elixir: the BEAM",
      "iex — your laboratory",
      "Immutability & rebinding",
      "Basic types & the atom",
      "Strings are binaries",
      "Lists vs tuples",
    ],
  },

  {
    moduleTitle: "2 · Pattern Matching",
    cardTitles: [
      "= is a match, not an assignment",
      "Destructuring nested data",
      "The pin operator ^",
      "Maps — the workhorse",
      "Keyword lists & options",
      "Matching in function heads",
    ],
  },

  {
    moduleTitle: "3 · Functions & Flow",
    cardTitles: [
      "Modules & named functions",
      "Anonymous functions & capture",
      "Guards",
      "The pipe operator |>",
      "Enum — the standard vocabulary",
      "Stream — laziness",
      "Comprehensions (for)",
      "Recursion instead of loops",
    ],
  },

  {
    moduleTitle: "4 · Shape & Contracts",
    cardTitles: [
      "case, cond, if",
      "with — the happy path",
      "Errors as data vs exceptions",
      "Structs",
      "Protocols",
      "Behaviours",
    ],
  },

  {
    moduleTitle: "5 · Project & Tooling",
    cardTitles: [
      "Mix — projects and dependencies",
      "Config: compile-time vs runtime",
      "ExUnit and doctests",
      "Docs, typespecs and static tools",
    ],
  },

  {
    moduleTitle: "6 · Concurrency",
    cardTitles: [
      "Processes and spawn",
      "send, receive and the mailbox",
      "State without mutation",
      "Links, monitors and exit signals",
      "Let it crash",
      "Task — concurrency for one job",
      "Agent — state without ceremony",
      "Naming processes & Registry",
    ],
  },

  {
    moduleTitle: "7 · OTP",
    cardTitles: [
      "GenServer — the loop, industrialised",
      "call vs cast — and backpressure",
      "handle_info, timers and periodic work",
      "Designing state (and avoiding bottlenecks)",
      "Supervisor & restart strategies",
      "child_spec and designing the tree",
      "DynamicSupervisor — a process per entity",
      "Application — the root of the tree",
      "ETS — shared memory, done safely",
    ],
  },

  {
    moduleTitle: "8 · Web Layer",
    cardTitles: [
      "Plug — conn is the universe",
      "Phoenix anatomy",
      "Router and pipelines",
      "Controllers and JSON responses",
      "Contexts — the domain boundary",
      "Phoenix.PubSub",
    ],
  },

  {
    moduleTitle: "9 · SQL & SQLite",
    cardTitles: [
      "Why SQL — the relational model",
      "OLTP vs OLAP",
      "SQLite from Elixir",
      "Tables, types and type affinity",
      "INSERT, UPDATE, DELETE",
      "SELECT — projection, filter, order, page",
      "NULL and three-valued logic",
      "JOINs — combining tables",
      "GROUP BY and aggregates",
      "Subqueries and CTEs",
      "Window functions",
      "Indexes and query plans",
      "Transactions and ACID",
      "Constraints and schema design",
      "Dangerous SQL — the trap catalogue",
      "SQLite in a real Elixir service",
    ],
  },

  {
    moduleTitle: "10 · DuckDB & Analytics",
    cardTitles: [
      "Why DuckDB",
      "Rows vs columns, physically",
      "DuckDB from Elixir",
      "Querying files directly",
      "Analytical SQL: multi-level aggregation",
      "Window frames, QUALIFY and time series",
      "DuckDB's SQL ergonomics",
      "Attaching Postgres and SQLite",
      "Analytics pipelines and their traps",
    ],
  },

  {
    moduleTitle: "11 · Postgres & Ecto",
    cardTitles: [
      "Repo — the Postgres connection",
      "Migrations",
      "Schemas",
      "Changesets",
      "Ecto.Query",
      "Associations, preload and joins",
      "Transactions and Ecto.Multi",
      "Raw SQL and fragments",
      "Query performance in production",
    ],
  },

  {
    moduleTitle: "12 · Realtime & Production",
    cardTitles: [
      "WebSockets: Socket and Channel",
      "handle_in, push and broadcast",
      "Presence — who is online",
      "Authentication and authorisation",
      "Background jobs",
      "Caching and rate limiting",
      "Telemetry and observability",
      "Releases and deployment",
      "Distribution and clustering",
      "Testing the whole stack",
      "The failure modes that actually bite",
      "Capstone — assembling the service",
    ],
  },
];

/**
 * Title → filename-safe identity. Kept deliberately dull: the same title
 * must always produce the same slug, across sessions and machines.
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The deck, flattened into reading order. @type {Card[]} */
export const CARDS = SYLLABUS.flatMap(({ moduleTitle, cardTitles }) =>
  cardTitles.map((title) => {
    const slug = slugify(title);
    const contentPath = `./cards/${slugify(moduleTitle)}-${slug}.js`;
    return { moduleTitle, title, slug, loadContent: () => import(contentPath) };
  }),
).map((cardWithoutPosition, deckIndex) => ({
  ...cardWithoutPosition,
  position: deckIndex + 1,
}));

/** @type {Map<string, Card>} */
export const CARD_BY_SLUG = new Map(CARDS.map((card) => [card.slug, card]));

if (CARD_BY_SLUG.size !== CARDS.length) {
  console.warn(
    "PunkElixir: two cards share a slug — they will share mastery too.",
  );
}
