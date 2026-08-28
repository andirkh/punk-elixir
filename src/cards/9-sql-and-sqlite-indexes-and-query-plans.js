export default {
  front:
    "Adding an index made your query 500x faster. Adding a second one made writes 30% slower and the query no faster. What is an index actually?",
  back: "A **B-tree**: a sorted, separately-stored copy of one or more columns plus a pointer back to the row. Sorted order turns a full scan (O(n)) into a descent (O(log n)) — but every INSERT, UPDATE and DELETE must also maintain every index, so each one is a tax on writes and disk. `EXPLAIN QUERY PLAN` tells you which index the planner chose; guessing does not.",
  philosophy: {
    lead: "An index is a trade: you pay on every write and in disk space to make certain reads dramatically cheaper.",
    body: [
      "Because an index is *sorted*, its usefulness depends entirely on whether your query's shape matches that sort order. This is the concept of **sargability** — a predicate is index-usable if the indexed column appears bare on one side of a comparison. Wrap it in a function and the index is dead: `WHERE lower(email) = 'a@b.c'` cannot use an index on `email`, because the index stores the original values, not the lowercased ones. The fixes are to index the expression itself or to store a normalised column. The same applies to leading wildcards: `LIKE '%ada'` cannot use a B-tree because you do not know the prefix.",
      "For composite indexes, order matters and follows the **leftmost prefix** rule: an index on `(user_id, placed_at)` serves queries filtering on `user_id`, or on `user_id` and `placed_at` — but not one filtering on `placed_at` alone. Think of it as a phone book sorted by surname then first name: useless for finding everyone named 'Ada'.",
      "The best case is a **covering index** — one that contains every column the query needs, so the engine answers entirely from the index and never touches the table. That is where the biggest wins come from, and it is a concrete reason to stop writing `SELECT *`.",
      "Everything here transfers to Postgres, where the command is `EXPLAIN ANALYZE` and there are more index types. The habit to build now is simply: never add an index because it feels right. Run the plan first, add the index, run the plan again, and confirm it changed.",
    ],
    diagram: `flowchart TB
  subgraph two["the table and its index"]
    direction LR
    tbl["TABLE (heap)<br/>rowid 1 ¦ ada@x.dev   ¦ Ada<br/>rowid 2 ¦ grace@x.dev ¦ Grace<br/>rowid 3 ¦ alan@x.dev  ¦ Alan<br/>rowid 4 ¦ kaz@x.dev   ¦ Kaz"]:::code
    idx["INDEX ON (email) — a SORTED copy + the rowid<br/>ada@x.dev   → 1<br/>alan@x.dev  → 3<br/>grace@x.dev → 2<br/>kaz@x.dev   → 4<br/><br/>a B-tree: O(log n) descent, not a scan"]:::ok
  end
  two --> tax["READS  — O(n) scan becomes an O(log n) seek ✓ a huge win<br/>WRITES — every INSERT/UPDATE/DELETE must update EVERY index ✗ the tax<br/>DISK   — an index is a real copy of those columns ✗ the tax"]:::warn
  tax --> sarg["SARGABLE? — can the planner use the index?<br/>✓ WHERE email = ?                bare column, equality<br/>✓ WHERE placed_at &gt;= ? AND &lt; ?   a range on a bare column<br/>✓ WHERE name LIKE 'ada%'         a known prefix<br/>✗ WHERE lower(email) = ?         a function kills it — index the expression<br/>✗ WHERE name LIKE '%ada'         leading wildcard — you need FTS<br/>✗ WHERE total_cents + 1 &gt; ?      arithmetic on the column<br/>✗ WHERE CAST(id AS TEXT) = ?     an implicit type change"]:::hot
  sarg --> comp["COMPOSITE INDEX = the LEFTMOST PREFIX rule · INDEX (user_id, placed_at)<br/>✓ WHERE user_id = ?<br/>✓ WHERE user_id = ? AND placed_at &gt; ?<br/>✓ WHERE user_id = ? ORDER BY placed_at<br/>✗ WHERE placed_at &gt; ?   alone — the index cannot help"]:::warn
  comp --> cov["COVERING INDEX — answer without touching the table<br/>INDEX (user_id, placed_at, total_cents)<br/>SELECT total_cents FROM orders WHERE user_id = ? ⇒ an index-only scan ✓✓"]:::ok
  cov --> plan["READ THE PLAN, ALWAYS<br/>EXPLAIN QUERY PLAN SELECT ...<br/>  SCAN t                   ← a full scan<br/>  SEARCH t USING INDEX ... ← good<br/>ANALYZE — refresh planner statistics after big data changes"]:::code`,
    takeaway:
      "Indexes are sorted copies: fast reads, taxed writes. Keep predicates sargable, respect the leftmost prefix, and always read the plan.",
  },
  codeSamples: [
    {
      title: "Scan vs search, measured",
      note: "Run on the 200k-row events table.",
      code: `.timer on
DROP INDEX IF EXISTS events_user_idx;

EXPLAIN QUERY PLAN SELECT * FROM events WHERE user_id = 1234;
-- SCAN events            ← reads all 200k rows
SELECT count(*) FROM events WHERE user_id = 1234;

CREATE INDEX events_user_idx ON events(user_id);
ANALYZE;

EXPLAIN QUERY PLAN SELECT * FROM events WHERE user_id = 1234;
-- SEARCH events USING INDEX events_user_idx (user_id=?)   ✓
SELECT count(*) FROM events WHERE user_id = 1234;`,
    },
    {
      title: "Kill an index by accident",
      note: "Four ways to make the planner ignore your index.",
      code: `CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'ada@x.dev';
-- SEARCH users USING COVERING INDEX users_email_idx  ✓

EXPLAIN QUERY PLAN SELECT * FROM users WHERE lower(email) = 'ada@x.dev';
-- SCAN users   ✗ the function hid the column

EXPLAIN QUERY PLAN SELECT * FROM users WHERE email LIKE '%@x.dev';
-- SCAN users   ✗ leading wildcard

-- fix 1: index the expression you actually query
CREATE INDEX users_email_lower_idx ON users(lower(email));
EXPLAIN QUERY PLAN SELECT * FROM users WHERE lower(email) = 'ada@x.dev';  -- ✓

-- fix 2: for substring search, use full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(name, email);
INSERT INTO users_fts SELECT name, email FROM users;
SELECT * FROM users_fts WHERE users_fts MATCH 'ada';`,
    },
    {
      title: "Composite and covering indexes",
      note: "The leftmost prefix rule, demonstrated.",
      code: `CREATE INDEX events_user_time_idx ON events(user_id, created_at);

EXPLAIN QUERY PLAN
SELECT * FROM events WHERE user_id = 42 AND created_at > '2026-01-01';   -- ✓ uses it

EXPLAIN QUERY PLAN
SELECT * FROM events WHERE user_id = 42 ORDER BY created_at;             -- ✓ no sort needed

EXPLAIN QUERY PLAN
SELECT * FROM events WHERE created_at > '2026-01-01';                    -- ✗ SCAN

-- covering index: everything the query needs lives in the index
CREATE INDEX events_cover_idx ON events(user_id, created_at, amount_cents);

EXPLAIN QUERY PLAN
SELECT created_at, amount_cents FROM events WHERE user_id = 42;
-- SEARCH events USING COVERING INDEX ...   ← never reads the table ✓✓

-- and this is why SELECT * hurts:
EXPLAIN QUERY PLAN SELECT * FROM events WHERE user_id = 42;
-- must visit the table for payload/kind`,
    },
    {
      title: "Which indexes do you have, and are they used?",
      note: "",
      code: `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL;

PRAGMA index_list('events');
PRAGMA index_info('events_user_time_idx');

-- partial index: index only the rows you actually query
CREATE INDEX orders_pending_idx ON orders(user_id) WHERE status = 'pending';
EXPLAIN QUERY PLAN SELECT * FROM orders WHERE status='pending' AND user_id=1;

-- unique index doubles as a constraint
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users(email);

-- housekeeping
ANALYZE;              -- refresh statistics so the planner chooses well
PRAGMA optimize;      -- run before closing a long-lived connection`,
    },
  ],
};
