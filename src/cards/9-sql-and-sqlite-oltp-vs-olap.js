export default {
  front:
    "Two queries: 'insert this order and read that user's cart' versus 'revenue by country by month for three years'. Why can one database be excellent at one and terrible at the other?",
  back: "They are opposite workloads. **OLTP** (transactional) is many tiny concurrent reads/writes touching FEW rows but ALL their columns, and it demands correctness under concurrency. **OLAP** (analytical) is few huge queries touching MILLIONS of rows but only a FEW columns, and it demands raw scan throughput. Row storage wins the first, column storage wins the second. Postgres and SQLite are OLTP engines; DuckDB is an OLAP engine.",
  philosophy: {
    lead: "Almost every hard database decision you will ever make comes down to noticing which of these two shapes you are in.",
    body: [
      "An OLTP query is `SELECT * FROM orders WHERE id = 42`. It wants one row, all of its columns, right now, and it must not see another transaction's half-finished work. Storing a row's columns contiguously (row storage) makes this one disk read. B-tree indexes make finding it O(log n). Everything about Postgres and SQLite is tuned for this.",
      "An OLAP query is `SELECT country, sum(total_cents) FROM orders GROUP BY country`. It touches every row but only two columns out of forty. In row storage you must read all forty columns of every row to get two — reading maybe 20x more bytes than you need. In column storage each column is a separate contiguous array, so you read exactly two, they compress beautifully because neighbouring values are similar, and the CPU can process them in vectorised batches.",
      "The practical consequence for you: running your analytics dashboard against your production OLTP database is one of the most common and most damaging mistakes in backend work. That one report scans millions of rows, evicts the hot pages your transactional queries depend on from cache, holds connections from the pool (card 79), and turns a 5ms endpoint into a 500ms one. The fix is not a bigger server; it is a second engine shaped for the other job.",
      "This is why module 10 exists. You will keep SQLite/Postgres for the transactional path and hand analytics to DuckDB — often over the exact same data — and both will be fast at what they are for.",
    ],
    diagram: `flowchart TB
  subgraph two["two completely different jobs"]
    direction LR
    oltp["OLTP — online TRANSACTION processing<br/>'insert this order' · 'get user 42s cart'<br/>thousands of queries per second<br/>each touches 1–100 rows<br/>needs ALL columns of those rows<br/>correctness under concurrency — ACID<br/>⇒ ROW storage + B-tree indexes<br/>SQLite · Postgres · MySQL"]:::ok
    olap["OLAP — online ANALYTICAL processing<br/>'revenue by country by month' · 'top 10 SKUs of 2025'<br/>a few queries per minute<br/>each touches 10M+ rows<br/>needs 2–5 columns of ALL rows<br/>scan throughput<br/>⇒ COLUMN storage + vectorised execution<br/>DuckDB · ClickHouse · BigQuery"]:::hot
  end
  two --> row0
  subgraph layout["WHY STORAGE LAYOUT DECIDES THIS"]
    direction TB
    row0["ROW STORE — [id¦name¦country¦total¦…40 cols][id¦name¦…]<br/>SELECT * WHERE id=42 → one contiguous read ✓ fast<br/>SELECT sum(total)    → must read ALL 40 columns ✗ 20x waste"]:::code
    col0["COL STORE — each column is its own contiguous array<br/>total   [25][12][8][99]… → read ONLY this array ✓ fast<br/>country [GB][US][GB][JP]… → compresses ~10x, SIMD-friendly<br/>SELECT * WHERE id=42 → must stitch 40 arrays ✗ slow"]:::code
    row0 ~~~ col0
  end
  col0 --> outage["⚠ THE CLASSIC OUTAGE<br/>running the analytics dashboard against the production OLTP database.<br/>It scans millions of rows, evicts the hot cache, holds pool connections,<br/>and your 5ms API becomes 500ms."]:::bad`,
    takeaway:
      "Few rows / all columns / concurrent = OLTP row store. Many rows / few columns = OLAP column store. Do not mix them on one engine.",
  },
  codeSamples: [
    {
      title: "Feel the difference in one file",
      note: "Build 200k rows in SQLite, then run one query of each shape.",
      code: `-- in sqlite3 learn.db
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  country TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  payload TEXT NOT NULL,           -- a fat column, like real tables have
  created_at TEXT NOT NULL
);

-- generate 200k rows with a recursive CTE (card 63)
INSERT INTO events (user_id, country, kind, amount_cents, payload, created_at)
WITH RECURSIVE seq(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200000
)
SELECT
  (n % 5000) + 1,
  CASE n % 4 WHEN 0 THEN 'GB' WHEN 1 THEN 'US' WHEN 2 THEN 'JP' ELSE 'DE' END,
  CASE n % 3 WHEN 0 THEN 'view' WHEN 1 THEN 'click' ELSE 'purchase' END,
  (n * 37) % 20000,
  printf('%.200c', 'x'),           -- 200 bytes of ballast per row
  datetime('now', '-' || (n % 900) || ' days')
FROM seq;

SELECT count(*) FROM events;`,
    },
    {
      title: "The OLTP query",
      note: "Point lookup: one row, all columns.",
      code: `.timer on

CREATE INDEX IF NOT EXISTS events_user_idx ON events(user_id);

-- OLTP shape: tiny, indexed, all columns of a few rows
SELECT id, kind, amount_cents, created_at
FROM events WHERE user_id = 1234;

EXPLAIN QUERY PLAN
SELECT * FROM events WHERE user_id = 1234;
-- SEARCH events USING INDEX events_user_idx  ← O(log n) ✓`,
    },
    {
      title: "The OLAP query on a row store",
      note: "Same table, opposite shape. Watch the timer.",
      code: `.timer on

-- OLAP shape: every row, two columns, no index can help
SELECT country,
       count(*)          AS events,
       sum(amount_cents) AS cents
FROM events
GROUP BY country
ORDER BY cents DESC;

EXPLAIN QUERY PLAN
SELECT country, sum(amount_cents) FROM events GROUP BY country;
-- SCAN events  ← full scan; it must read the fat payload column too`,
    },
    {
      title: "Which shape is your query?",
      note: "A checklist worth internalising.",
      code: `-- ASK THESE FOUR QUESTIONS:
--
--   1. How many rows does it touch?      1..100 = OLTP   |  1M+ = OLAP
--   2. How many columns does it need?    most   = OLTP   |  few = OLAP
--   3. How often does it run?            1000/s = OLTP   |  1/min = OLAP
--   4. Does it write?                    yes    = OLTP   |  read-only = OLAP
--
-- MIXED SHAPES you will meet in real services:
--   "recent orders for this user"          OLTP  (index + limit)
--   "count of orders for this user"        OLTP-ish (index-only scan)
--   "daily revenue for the last 90 days"   OLAP  (pre-aggregate or DuckDB)
--   "export every order to CSV"            OLAP  (stream it, card 88+)
--   "admin dashboard, 12 charts"           OLAP  (do NOT point at prod)`,
    },
  ],
};
