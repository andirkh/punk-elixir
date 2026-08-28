export default {
  front:
    "Card 55 said row stores are wrong for analytics. SQLite is a row store that lives in your process. What is the OLAP equivalent?",
  back: "**DuckDB** — an embedded, in-process **column store** with a vectorised, parallel execution engine. Same deployment model as SQLite (a library and a file, no server), opposite storage model and opposite tuning. It reads CSV and Parquet directly, uses every core by default, and routinely runs aggregations over tens of millions of rows in under a second on a laptop.",
  philosophy: {
    lead: "DuckDB is SQLite's shape applied to the other half of card 55: analytics you can embed rather than a warehouse you must operate.",
    body: [
      "The historical alternative for analytics was a cluster — Spark, Redshift, BigQuery — with its own deployment, its own cost model and a minimum latency measured in seconds. DuckDB observed that a modern laptop has 8+ cores, tens of gigabytes of RAM and NVMe storage, and that the overwhelming majority of analytical questions are asked over datasets that fit comfortably in that. If your data is under a few hundred gigabytes, a single process can answer faster than a cluster can schedule the job.",
      "Three engineering choices produce the speed. **Columnar storage** means a query reads only the columns it names. **Vectorised execution** processes batches of ~2048 values at a time through tight loops the CPU can pipeline and SIMD, instead of one row at a time through a virtual machine. **Automatic parallelism** splits a scan across every core with no configuration.",
      "For an Elixir backend the practical shape is: keep Postgres or SQLite for the transactional path, and use DuckDB for the reporting path — reading Parquet exports, or attached directly to your OLTP database (card 77). Your dashboard stops competing with your API for the same connection pool and the same page cache, which is the outage described back in card 55.",
      "What it is not: a transactional database. Its single-writer, analytics-tuned design means you should not point your API's writes at it. Use each engine for the shape it was built for — that is the entire lesson of this module.",
    ],
    diagram: `flowchart TB
  subgraph quad["THE FOUR-QUADRANT MAP"]
    direction LR
    q1["EMBEDDED + OLTP<br/>a library and a file<br/><br/>SQLite — module 9"]:::ok
    q2["EMBEDDED + OLAP<br/>a library and a file<br/><br/>DuckDB — this module"]:::hot
    q3["SERVER + OLTP<br/>a process and a port<br/><br/>Postgres, MySQL — module 11"]:::ok
    q4["SERVER + OLAP<br/>a process and a port<br/><br/>ClickHouse, Snowflake, BigQuery, Redshift"]:::muted
  end
  quad --> same["SAME DEPLOYMENT MODEL AS SQLITE — no server, no port, no user<br/>one file, or purely in memory · a library inside your BEAM node<br/><br/>OPPOSITE ENGINE — columnar storage · vectorised execution (~2048 values)<br/>parallel across all cores by default"]:::hot
  same --> bench["SELECT country, sum(amount) FROM events GROUP BY country   -- 50M rows<br/>SQLite ~30 s    scans every column of every row, on 1 core<br/>DuckDB ~0.2 s   reads 2 columns, on 8 cores, with SIMD"]:::ok
  bench --> files["AND IT READS FILES DIRECTLY — no import step<br/>SELECT * FROM 'events.parquet'<br/>SELECT * FROM 'data/*.csv'<br/>SELECT * FROM read_json_auto('logs.json')"]:::code
  files --> use
  subgraph use["where it belongs"]
    direction LR
    u1["USE IT FOR<br/>✓ dashboards and reports<br/>✓ ad-hoc analysis over exports<br/>✓ ETL and data cleaning<br/>✓ taking analytics OFF your production OLTP database ← the point"]:::ok
    u2["DO NOT USE IT FOR<br/>✗ your API's write path<br/>✗ high-concurrency OLTP<br/>✗ many writers"]:::bad
  end`,
    takeaway:
      "DuckDB is an embedded column store: SQLite's deployment model with an analytics engine. Keep it off the write path.",
  },
  codeSamples: [
    {
      title: "Install and open it",
      note: "Terminal. Homebrew on macOS.",
      code: `brew install duckdb

duckdb analytics.duckdb

-- inside the duckdb prompt:
SELECT version();
.tables
.mode box
.timer on

-- an in-memory database is just:  duckdb
-- (no file, nothing persisted — perfect for scratch analysis)`,
    },
    {
      title: "Generate 5 million rows and feel the difference",
      note: "This takes a couple of seconds; the query after it is the point.",
      code: `-- inside duckdb
CREATE TABLE events AS
SELECT
  i                                                   AS id,
  (i % 50000) + 1                                     AS user_id,
  ['GB','US','JP','DE','BR'][(i % 5) + 1]             AS country,
  ['view','click','purchase'][(i % 3) + 1]            AS kind,
  ((i * 37) % 20000)::BIGINT                          AS amount_cents,
  DATE '2024-01-01' + INTERVAL ((i % 900)) DAY        AS created_at,
  repeat('x', 200)                                    AS payload
FROM range(5000000) t(i);

SELECT count(*) FROM events;

.timer on
SELECT country, count(*) AS n, sum(amount_cents) AS cents
FROM events GROUP BY country ORDER BY cents DESC;
-- 5,000,000 rows aggregated in well under a second`,
    },
    {
      title: "The same query on both engines",
      note: "Run the SQLite half in sqlite3, the DuckDB half in duckdb.",
      code: `-- ---- SQLite (row store), on the 200k table from card 55 ----
.timer on
SELECT country, count(*), sum(amount_cents) FROM events GROUP BY country;
-- note the time, then multiply by 25 to imagine 5M rows

-- ---- DuckDB (column store), on 5M rows ----
.timer on
SELECT country, count(*), sum(amount_cents) FROM events GROUP BY country;

-- DuckDB will also tell you what it did:
EXPLAIN ANALYZE
SELECT country, sum(amount_cents) FROM events GROUP BY country;
-- look for: PROJECTION (2 columns only), and parallel HASH_GROUP_BY`,
    },
    {
      title: "Prove the columnar claim",
      note: "Adding a fat column costs a row store; it costs a column store nothing.",
      code: `.timer on

-- reads 2 columns out of 7
SELECT country, sum(amount_cents) FROM events GROUP BY country;

-- reads 1 column
SELECT count(DISTINCT user_id) FROM events;

-- reads ALL columns, including the 200-byte payload — much slower
SELECT * FROM events LIMIT 10;
SELECT count(*) FROM (SELECT * FROM events) t;

-- the lesson: in a column store, the cost is the columns you NAME.
-- SELECT * is not laziness here, it is the most expensive thing you can write.`,
    },
  ],
};
