/* ------------------------------------------------------------------
   A very small Elixir/SQL/JS highlighter, and prose markup.

   One regex, nine capture groups, every token painted with a design
   system colour (see .t-* in styles.css). It is not a parser and does
   not pretend to be: it only has to make a 20-line sample readable.
   ------------------------------------------------------------------ */

/** Escapes HTML so a snippet can be painted with innerHTML. @param {unknown} value @returns {string} */
const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Builds the token regex for one comment syntax. The capture groups are
 * in the same order as TOKEN_CLASS_BY_GROUP below — change one and you
 * must change the other.
 * @param {string} lineCommentPattern Alternation matching a line comment.
 * @returns {RegExp}
 */
function buildTokenPattern(lineCommentPattern) {
  return new RegExp(
    [
      "(" + lineCommentPattern + ")", // 1 comment
      '("""[\\s\\S]*?"""|"(?:\\\\.|[^"\\\\])*"|~[a-zA-Z]\\([^)]*\\)|~[a-zA-Z]"[^"]*"|\'(?:[^\'\\n])*\')', // 2 string
      "(~r\\/[^\\/\\n]*\\/[a-z]*)", // 3 regex sigil
      '(:"[^"]*"|:[a-zA-Z_][a-zA-Z0-9_]*[?!]?|\\b[a-zA-Z_][a-zA-Z0-9_]*:(?=\\s))', // 4 atom / key
      "(@[a-z_][a-zA-Z0-9_]*)", // 5 attribute
      "\\b(def|defp|defmodule|defstruct|defprotocol|defimpl|defexception|defguard|defmacro|defdelegate|defoverridable|do|end|fn|case|cond|if|else|unless|when|and|or|not|in|with|for|receive|after|try|rescue|catch|throw|raise|import|alias|require|use|quote|unquote|true|false|nil|self|spawn|spawn_link|send|schema|embedded_schema|field|has_many|has_one|belongs_to|many_to_many|timestamps|plug|pipeline|scope|resources|forward|from|where|select|select_merge|order_by|limit|offset|join|preload|group_by|having|const|let|var|function|return|import|export|new|await|async)\\b", // 6 keyword
      "\\b([A-Z][A-Za-z0-9_]*)", // 7 module / SQL keyword
      "\\b(\\d[\\d_]*(?:\\.\\d+)?)\\b", // 8 number
      "(\\|&gt;|-&gt;|&lt;-|=&gt;|\\\\\\\\|::|&lt;&lt;|&gt;&gt;)", // 9 operator
    ].join("|"),
    "g",
  );
}

const ELIXIR_TOKEN_PATTERN = buildTokenPattern("#[^\\n]*"); // Elixir: # comments
const SQL_TOKEN_PATTERN = buildTokenPattern("--[^\\n]*|#[^\\n]*"); // SQL: -- comments too

/** The CSS class each capture group paints its token with, group 1 first. */
const TOKEN_CLASS_BY_GROUP = [
  "t-com",
  "t-str",
  "t-str",
  "t-atm",
  "t-kw",
  "t-kw",
  "t-mod",
  "t-num",
  "t-op",
];

const TOKEN_GROUP_COUNT = TOKEN_CLASS_BY_GROUP.length;

/* Elixir uses -- as list subtraction, so only treat it as a comment
   in samples that actually look like SQL. */
const LOOKS_LIKE_SQL =
  /(^|\n)\s*(--|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|CREATE\b|DROP\b|ALTER\b|WITH\b|PRAGMA\b|COPY\b|ATTACH\b|EXPLAIN\b|VACUUM\b|BEGIN\b|COMMIT\b|SET\b|\.(timer|headers|mode|schema|tables|quit|read|dump))/i;

/**
 * Escaped, span-wrapped HTML for a snippet.
 * @param {string} code
 * @returns {string}
 */
export function highlight(code) {
  const tokenPattern = LOOKS_LIKE_SQL.test(code)
    ? SQL_TOKEN_PATTERN
    : ELIXIR_TOKEN_PATTERN;
  tokenPattern.lastIndex = 0;

  return escapeHtml(code).replace(
    tokenPattern,
    (wholeMatch, ...captureGroups) => {
      for (let groupIndex = 0; groupIndex < TOKEN_GROUP_COUNT; groupIndex++) {
        const capturedToken = captureGroups[groupIndex];
        if (capturedToken !== undefined) {
          return `<span class="${TOKEN_CLASS_BY_GROUP[groupIndex]}">${capturedToken}</span>`;
        }
      }
      return wholeMatch;
    },
  );
}

/**
 * markdown-lite for prose: **bold**, `code`, *em*.
 * @param {string} text
 * @returns {string}
 */
export function prose(text) {
  return escapeHtml(text)
    .replace(
      /`([^`]+)`/g,
      '<code class="px-1 py-0.5 rounded bg-secondary-500 text-azure-700 font-mono text-[0.85em]">$1</code>',
    )
    .replace(
      /\*\*([^*]+)\*\*/g,
      '<strong class="text-punkPrimary-600 font-semibold">$1</strong>',
    )
    .replace(
      /(^|[\s(])\*([^*\n]+)\*/g,
      '$1<em class="text-azure-700 font-medium not-italic">$2</em>',
    );
}
