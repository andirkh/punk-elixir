export default {
  front:
    "Your live data is in Postgres. You want DuckDB's speed without building an export pipeline first. What is the shortest path?",
  back: "`ATTACH 'postgres://...' AS pg (TYPE POSTGRES)` — DuckDB reads your live Postgres tables directly, pushing filters and projections down to the server, and you can join them against Parquet files and local tables in one query. The same works for SQLite. It is the fastest way to get analytics off your OLTP path without an ETL job, but it still reads through the production server, so it is not free.",
  philosophy: {
    lead: "Attaching turns DuckDB into a query engine over whatever you already have, which removes the usual excuse for running reports on the production database.",
    body: [
      "The mechanism is worth understanding so you know when it helps. DuckDB pushes down the columns and simple filters it can, so a `WHERE created_at >= …` is executed by Postgres and only matching rows cross the connection. But the heavy work — grouping, window functions, joins across sources — happens in DuckDB's vectorised engine. So you are still asking Postgres to scan, but you are not asking it to sort ten million rows or compute a cube.",
      "That is the honest limitation: reads still consume Postgres CPU, buffer cache and a connection. For a nightly report it is perfect. For a dashboard refreshing every ten seconds it recreates the problem from card 55, and you should materialise instead — `CREATE TABLE ... AS SELECT ... FROM pg.orders` copies once into DuckDB, or export to Parquet (card 73) and query the files. Read from a replica if you have one.",
      "The genuinely powerful move is joining across sources in a single query: live Postgres rows joined to a year of archived Parquet joined to a CSV someone emailed you. There is no staging table, no import script and no schema declaration — which is a real change in how quickly you can answer a question.",
      "Treat the attachment as read-only in your head, even though writes are possible. Analytics engines writing to your transactional database is a category of accident you do not want; keep the arrow pointing one way.",
    ],
    diagram: `flowchart TB
  subgraph att["ATTACH — one engine, many sources"]
    direction TB
    a1["ATTACH 'dbname=shop host=localhost' AS pg (TYPE POSTGRES, READ_ONLY)"]:::code
    a2["ATTACH 'app.db' AS lite (TYPE SQLITE)"]:::code
    a3["plus 'archive/**/*.parquet' · 'notes.csv' · local DuckDB tables"]:::code
    a4["SELECT … FROM pg.orders o<br/>JOIN 'archive/**/*.parquet' a USING (user_id)<br/>JOIN lite.settings s USING (user_id)<br/>GROUP BY ALL      ← ONE query, THREE storage engines"]:::hot
    a1 ~~~ a2 ~~~ a3 ~~~ a4
  end
  a4 --> work
  subgraph work["who does what"]
    direction LR
    pd["PUSHED DOWN to the source<br/>column projection<br/>simple WHERE filters<br/>LIMIT, sometimes"]:::ok
    dd["DUCKDB DOES ITSELF<br/>GROUP BY and aggregation<br/>window functions<br/>joins ACROSS sources<br/>sorting, cubes, rollups"]:::hot
  end
  work --> cost["⚠ IT STILL READS THROUGH POSTGRES<br/>it consumes its CPU, its buffer cache and a connection — card 79<br/>✓ a nightly report · ✓ an ad-hoc investigation · ✓ a read replica<br/>✗ a dashboard polling every 10s ⇒ you have rebuilt the card-55 outage"]:::bad
  cost --> s1
  subgraph strat["THE THREE STRATEGIES, IN ORDER OF ISOLATION"]
    direction TB
    s1["1. ATTACH live — zero setup, reads production        ← ad-hoc"]:::warn
    s2["2. MATERIALISE once — CREATE TABLE x AS SELECT * FROM pg.x<br/>   one scan, then production is free                  ← dashboards"]:::ok
    s3["3. EXPORT to Parquet — a scheduled job, card 73<br/>   production is never touched again                  ← production"]:::ok
    s1 --> s2 --> s3
  end
  s3 --> arrow["keep the arrow ONE-WAY: analytics READS, it never writes back."]:::hot`,
    takeaway:
      "ATTACH queries live Postgres/SQLite from DuckDB and joins them to files. Materialise or export once the query repeats.",
  },
  codeSamples: [
    {
      title: "Attach Postgres and SQLite",
      note: "Run in the duckdb CLI or through Shop.Analytics.",
      code: `INSTALL postgres; LOAD postgres;
INSTALL sqlite;   LOAD sqlite;

ATTACH 'dbname=shop_dev host=localhost user=postgres password=postgres'
  AS pg (TYPE POSTGRES, READ_ONLY);

ATTACH 'app.db' AS lite (TYPE SQLITE, READ_ONLY);

SHOW DATABASES;
SHOW ALL TABLES;

DESCRIBE pg.orders;
SELECT count(*) FROM pg.orders;
SELECT count(*) FROM lite.users;`,
    },
    {
      title: "Analytics on live Postgres, computed in DuckDB",
      note: "Postgres scans; DuckDB does the heavy lifting.",
      code: `.timer on

SELECT
  u.country,
  date_trunc('month', o.inserted_at)          AS month,
  count(*)                                    AS orders,
  count(DISTINCT o.user_id)                   AS customers,
  sum(o.total_cents)                          AS gross_cents,
  sum(o.total_cents) FILTER (WHERE o.status = 'paid') AS paid_cents
FROM pg.orders o
JOIN pg.users u ON u.id = o.user_id
WHERE o.inserted_at >= DATE '2025-01-01'      -- pushed down to Postgres
GROUP BY ALL
ORDER BY month, country;

-- see what was pushed down
EXPLAIN SELECT country, count(*) FROM pg.users WHERE country = 'GB' GROUP BY 1;`,
    },
    {
      title: "Join across three storage engines",
      note: "Live rows + archived Parquet + a stray CSV.",
      code: `-- one query, three sources, no staging tables
SELECT
  live.country,
  count(*)                              AS live_orders,
  sum(live.total_cents)                 AS live_cents,
  any_value(arch.archived_orders)       AS archived_orders,
  any_value(notes.note)                 AS note
FROM pg.orders live_o
JOIN pg.users live ON live.id = live_o.user_id
LEFT JOIN (
  SELECT country, count(*) AS archived_orders
  FROM 'archive/**/*.parquet'
  GROUP BY country
) arch USING (country)
LEFT JOIN read_csv_auto('country_notes.csv') notes USING (country)
GROUP BY ALL
ORDER BY live_cents DESC;`,
    },
    {
      title: "Materialise, then stop touching production",
      note: "The pattern for a dashboard that refreshes often.",
      code: `-- one scan of Postgres, then everything is local and fast
CREATE OR REPLACE TABLE orders_snapshot AS
  SELECT o.*, u.country
  FROM pg.orders o JOIN pg.users u ON u.id = o.user_id
  WHERE o.inserted_at >= DATE '2025-01-01';

CREATE OR REPLACE TABLE users_snapshot AS SELECT * FROM pg.users;

DETACH pg;      -- production is now completely uninvolved ✓

-- refresh it on a schedule from Elixir (Oban, card 92):
defmodule Shop.Workers.RefreshAnalytics do
  use Oban.Worker, queue: :analytics, max_attempts: 3

  @impl Oban.Worker
  def perform(_job) do
    {:ok, _} = Shop.Analytics.query("INSTALL postgres; LOAD postgres;")
    {:ok, _} = Shop.Analytics.query(
      "ATTACH IF NOT EXISTS '#{System.fetch_env!("DATABASE_URL")}' AS pg (TYPE POSTGRES, READ_ONLY)")

    {:ok, _} = Shop.Analytics.query("""
      CREATE OR REPLACE TABLE orders_snapshot AS
      SELECT o.*, u.country FROM pg.orders o JOIN pg.users u ON u.id = o.user_id
    """)

    {:ok, _} = Shop.Analytics.query("DETACH pg")
    :ok
  end
end`,
    },
  ],
};
