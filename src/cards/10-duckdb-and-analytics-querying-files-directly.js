export default {
  front:
    "You have 40 daily CSV exports in a folder. How many lines of code to run a SQL query across all of them?",
  back: "Zero, plus one query: `SELECT * FROM 'exports/*.csv'`. DuckDB treats files as tables. It sniffs CSV types and headers automatically, reads Parquet natively with **projection and predicate pushdown**, globs directories, and can read straight from S3 or HTTPS. There is no import step, no schema declaration and no ETL job — the file *is* the table.",
  philosophy: {
    lead: "Removing the import step changes what analysis feels like: you go from 'set up a pipeline' to 'ask the question'.",
    body: [
      "Parquet is the format worth understanding, because it is columnar on disk in the same way DuckDB is columnar in memory. A Parquet file stores each column separately, compressed, with per-row-group statistics — min, max and count for every chunk. That metadata is what enables **predicate pushdown**: when you filter on a date, DuckDB reads the statistics, skips every row group that cannot contain a match, and never touches those bytes. On a partitioned dataset, a query over one month can ignore 97% of the files entirely.",
      "This makes a very practical pattern available to an Elixir backend: export the tables you report on from Postgres to Parquet on a schedule (an Oban job, card 92), then point DuckDB at the files. Your dashboards get a column store, your production database never sees a reporting query, and the export is a plain file you can copy, version and archive.",
      "Hive partitioning is the convention that makes this scale: write files as `data/year=2026/month=08/day=28/events.parquet`, and DuckDB reads the directory names as columns. A filter on `year` and `month` becomes file pruning before any data is read.",
      "CSV is where the traps live. Auto-detection samples the first rows and can guess wrong — an ID column that is numeric for 10,000 rows and then contains a leading zero, a date format that flips day and month, a NULL spelled 'NA'. For anything recurring, pass explicit `columns` and `types` rather than trusting the sniffer.",
    ],
    diagram: `flowchart TB
  file0["THE FILE IS THE TABLE<br/>SELECT * FROM 'events.parquet'<br/>SELECT * FROM 'exports/*.csv'                -- glob<br/>SELECT * FROM 'data/**/*.parquet'            -- recursive glob<br/>SELECT * FROM read_json_auto('logs.ndjson')<br/>SELECT * FROM read_csv('f.csv', header=true, delim=';')<br/>SELECT * FROM 's3://bucket/events/*.parquet' -- httpfs extension"]:::code
  file0 --> pq
  subgraph pq["PARQUET = columnar on disk + per-row-group STATISTICS in the footer"]
    direction LR
    g1["row group 1<br/>min 2026-01<br/>max 2026-01"]:::muted
    g2["row group 2<br/>min 2026-02<br/>max 2026-02"]:::muted
    g3["row group 3<br/>min 2026-03<br/>max 2026-03"]:::ok
  end
  pq --> push["WHERE created_at &gt;= '2026-03-01'<br/>⇒ groups 1 and 2 are skipped WITHOUT BEING READ — predicate pushdown<br/>SELECT country, amount<br/>⇒ the other columns are never read — projection pushdown"]:::ok
  push --> hive["HIVE PARTITIONING — pruning at the FILE level<br/>data/year=2026/month=08/day=28/part-0.parquet<br/>SELECT * FROM 'data/**/*.parquet' WHERE year=2026 AND month=8<br/>⇒ year and month become COLUMNS, and 97% of the files are never opened"]:::hot
  hive --> pipe
  subgraph pipe["THE BACKEND PATTERN"]
    direction TB
    p1["Postgres<br/>OLTP, untouched by reports"]:::ok -->|a nightly Oban job| p2["Parquet files<br/>cheap, archivable"]:::ok --> p3["DuckDB"]:::hot --> p4["dashboards<br/>fast, isolated"]:::ok
  end
  pipe --> csv["⚠ CSV SNIFFING GUESSES. For anything recurring, declare columns and types.<br/>leading-zero IDs become integers · 03/04/2026 is ambiguous<br/>'NA' is not NULL unless you say so · a mid-file type change breaks it"]:::warn`,
    takeaway:
      "Files are tables. Parquet's column stats let DuckDB skip most of the data; declare CSV types instead of trusting the sniffer.",
  },
  codeSamples: [
    {
      title: "Write and read files",
      note: "Run in duckdb after building the events table.",
      code: `-- export in three formats
COPY events TO 'events.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);
COPY events TO 'events.csv'     (FORMAT CSV, HEADER);
COPY (SELECT * FROM events LIMIT 1000) TO 'sample.json' (FORMAT JSON);

-- now query them as if they were tables — no import
SELECT count(*) FROM 'events.parquet';
SELECT country, sum(amount_cents) FROM 'events.parquet' GROUP BY country;
SELECT * FROM 'events.csv' LIMIT 5;
SELECT * FROM read_json_auto('sample.json') LIMIT 5;

-- inspect a file without reading it
DESCRIBE SELECT * FROM 'events.parquet';
SELECT * FROM parquet_schema('events.parquet');
SELECT num_rows, num_row_groups FROM parquet_file_metadata('events.parquet');`,
    },
    {
      title: "Globs and Hive partitions",
      note: "The layout that makes big datasets cheap to query.",
      code: `-- write a partitioned dataset
COPY (
  SELECT *, year(created_at) AS year, month(created_at) AS month FROM events
) TO 'data' (FORMAT PARQUET, PARTITION_BY (year, month), OVERWRITE_OR_IGNORE);

-- directory names become columns
SELECT year, month, count(*) AS n
FROM 'data/**/*.parquet'
GROUP BY year, month ORDER BY year, month;

-- this filter prunes FILES, not rows
.timer on
SELECT count(*) FROM 'data/**/*.parquet' WHERE year = 2025 AND month = 6;

-- and this reads everything, for contrast
SELECT count(*) FROM 'data/**/*.parquet';

-- see which files a query would touch
SELECT DISTINCT filename FROM read_parquet('data/**/*.parquet', filename=true)
WHERE year = 2025 AND month = 6;`,
    },
    {
      title: "CSV traps and how to disarm them",
      note: "Run the bad version first so you see the failure mode.",
      code: `-- a CSV with the classic problems
COPY (SELECT * FROM (VALUES
  ('00123', '03/04/2026', 'NA',  '1.5'),
  ('00124', '15/04/2026', '42',  '2.5'),
  ('00125', '16/04/2026', '7',   'n/a')
) t(id, day, qty, price)) TO 'messy.csv' (FORMAT CSV, HEADER);

-- ✗ trusting the sniffer
SELECT * FROM 'messy.csv';
DESCRIBE SELECT * FROM 'messy.csv';     -- id may become INTEGER: 00123 → 123

-- ✓ declare everything that matters
SELECT * FROM read_csv('messy.csv',
  header = true,
  columns = {'id': 'VARCHAR', 'day': 'DATE', 'qty': 'INTEGER', 'price': 'DOUBLE'},
  dateformat = '%d/%m/%Y',
  nullstr = ['NA', 'n/a', ''],
  ignore_errors = false        -- fail loudly rather than silently drop rows
);

-- when a file is genuinely dirty, capture the rejects instead of guessing
SELECT * FROM read_csv('messy.csv', header=true, ignore_errors=true, store_rejects=true);
SELECT * FROM reject_errors;`,
    },
    {
      title: "The Postgres → Parquet → DuckDB pipeline",
      note: "A nightly Oban job (card 92) and the report that reads it.",
      code: `defmodule Shop.Workers.ExportAnalytics do
  use Oban.Worker, queue: :exports, max_attempts: 3

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"date" => date}}) do
    day = Date.from_iso8601!(date)
    dir = Path.join(["priv/analytics", "year=#{day.year}", "month=#{day.month}"])
    File.mkdir_p!(dir)
    path = Path.join(dir, "orders-#{Date.to_iso8601(day)}.parquet")

    # stream out of Postgres, hand DuckDB a temp CSV, write Parquet
    csv = Path.join(System.tmp_dir!(), "orders-#{Date.to_iso8601(day)}.csv")

    Shop.Repo.transaction(fn ->
      rows =
        Shop.Repo.query!(
          "SELECT id, user_id, status, total_cents, inserted_at FROM orders WHERE inserted_at::date = $1",
          [day]
        )

      body = Enum.map_join(rows.rows, "\\n", &Enum.join(&1, ","))
      File.write!(csv, Enum.join(rows.columns, ",") <> "\\n" <> body)
    end)

    {:ok, _} =
      Shop.Analytics.query(
        "COPY (SELECT * FROM read_csv_auto('#{csv}')) TO '#{path}' (FORMAT PARQUET, COMPRESSION ZSTD)"
      )

    File.rm(csv)
    :ok
  end
end

# the dashboard never touches Postgres:
Shop.Analytics.query("""
  SELECT year, month, status, count(*) AS orders, sum(total_cents) AS cents
  FROM 'priv/analytics/**/*.parquet'
  WHERE year = 2026
  GROUP BY year, month, status
  ORDER BY month
""")`,
    },
  ],
};
