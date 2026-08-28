export default {
  front:
    "Why does storing the same data column-by-column instead of row-by-row make an aggregation 50x faster? Give the three separate reasons.",
  back: "(1) **Less I/O** — a query naming 2 of 40 columns reads 2 arrays instead of 40, roughly 20x fewer bytes. (2) **Better compression** — a column holds one type with similar neighbouring values, so run-length, dictionary and bit-packing encodings give 5-10x, often letting the working set live in RAM. (3) **CPU efficiency** — a contiguous array of one type is processed in vectorised batches with SIMD instructions and no per-row interpretation overhead.",
  philosophy: {
    lead: "This is the one physical layout decision that determines everything else about a database engine.",
    body: [
      "Picture the bytes on disk. A row store writes `[id₁|name₁|country₁|…|payload₁][id₂|name₂|…]`. To sum one column you must read every byte of every row and skip past the parts you do not want — and disks and memory move data in blocks, so 'skipping' still costs the read. A column store writes `[id₁ id₂ id₃ …][country₁ country₂ …][amount₁ amount₂ …]`, so summing amounts touches exactly one contiguous array.",
      "Compression follows from the layout. In a row, adjacent bytes are an integer, then a string, then a timestamp — nothing in common. In a column, adjacent values are all country codes, and there are only five distinct ones, so a dictionary encoding stores tiny integers. Sorted or slowly-changing columns compress even harder with run-length encoding. Compression is not just a disk saving; less data means fewer cache misses, which is a CPU win.",
      "Vectorised execution is the third leg. Traditional engines walk a tree of operators one row at a time, which costs a function call and a branch per row per operator. DuckDB pushes a batch of ~2048 values through each operator, so the inner loop is a tight numeric loop over an array — exactly what SIMD units and CPU pipelines are built for. That is where the remaining order of magnitude comes from.",
      "The mirror image is why column stores are bad at OLTP: fetching one whole row means touching 40 separate arrays, and updating one row means rewriting compressed blocks. Which brings you back to the rule from card 55 — the shape of the question decides the engine.",
    ],
    diagram: `flowchart TB
  subgraph row0["ROW STORE — SQLite, Postgres · a ROW is contiguous"]
    direction LR
    r1["id₁ user₁ country₁ amt₁ pay₁ …"]:::code --- r2["id₂ user₂ country₂ amt₂ pay₂ …"]:::code
  end
  row0 --> rperf["SELECT * WHERE id = 42 → ONE contiguous read ✓ fast<br/>SELECT sum(amt)        → read every byte, skip 38 of 40 columns ✗ 20x waste"]:::warn
  subgraph col0["COLUMN STORE — DuckDB · a COLUMN is contiguous"]
    direction TB
    c1["id      ¦ 1  2  3  4  5  6 …"]:::code
    c2["user_id ¦ 7  3  9  1  4  2 …"]:::code
    c3["country ¦ GB US JP GB GB US … ← 5 distinct values ⇒ dictionary-encoded"]:::code
    c4["amount  ¦ 25 12 8  99 3  71 … ← bit-packed / RLE"]:::code
    c5["payload ¦ never touched by an aggregate query"]:::muted
    c1 ~~~ c2 ~~~ c3 ~~~ c4 ~~~ c5
  end
  rperf ~~~ c1
  c5 --> cperf["SELECT sum(amount)     → read ONE array, sequentially ✓✓<br/>SELECT * WHERE id = 42 → stitch 40 arrays back together ✗ slow"]:::ok
  cperf --> wins["THE THREE COMPOUNDING WINS<br/>1. I/O — 2 of 40 columns ⇒ ~20x less data<br/>2. COMPRESSION — one type, similar neighbours ⇒ ~5–10x smaller<br/>   dictionary (GB→0) · RLE (GB×1000 → 'GB, 1000') · bit-packing<br/>   ⇒ the working set fits in RAM and in CPU cache<br/>3. VECTORISATION — batches of ~2048 values, not one row<br/>   row-at-a-time: a function call and a branch per row per operator<br/>   vectorised: a tight loop over an array ⇒ SIMD, pipelined<br/><br/>20 × 5 × 5 ⇒ the 50–500x you actually observe"]:::hot
  wins --> why["⇒ and exactly why the same layout is TERRIBLE for OLTP<br/>one row = 40 array lookups · one update = rewriting compressed blocks"]:::bad`,
    takeaway:
      "Columnar wins by reading less, compressing better and vectorising the CPU — and loses at fetching or updating single rows.",
  },
  codeSamples: [
    {
      title: "Measure the I/O claim",
      note: "Same rows, different column counts.",
      code: `.timer on

-- 1 column
SELECT sum(amount_cents) FROM events;

-- 2 columns
SELECT country, sum(amount_cents) FROM events GROUP BY country;

-- 3 columns
SELECT country, kind, sum(amount_cents) FROM events GROUP BY country, kind;

-- all 7, including the 200-byte payload
SELECT count(*) FROM (SELECT * EXCLUDE (id) FROM events) t;

-- the time tracks the columns you named, not the rows in the table.`,
    },
    {
      title: "See the compression",
      note: "DuckDB reports per-column storage.",
      code: `-- write it to Parquet and compare sizes on disk
COPY events TO 'events.parquet' (FORMAT PARQUET);
COPY (SELECT * EXCLUDE (payload) FROM events) TO 'events_slim.parquet' (FORMAT PARQUET);

-- from a shell:  ls -lh events*.parquet
-- 5M rows with a 200-byte payload ≈ 1GB raw, but the slim file is a few MB

-- inspect what Parquet stored, per column
SELECT path_in_schema, compression, total_compressed_size, total_uncompressed_size,
       round(total_uncompressed_size::DOUBLE / total_compressed_size, 1) AS ratio
FROM parquet_metadata('events.parquet')
ORDER BY total_compressed_size DESC;
-- 'country' compresses enormously (5 distinct values); payload does not.`,
    },
    {
      title: "Read the plan",
      note: "Projection pushdown and parallelism, made visible.",
      code: `EXPLAIN
SELECT country, sum(amount_cents) FROM events WHERE kind = 'purchase' GROUP BY country;

EXPLAIN ANALYZE
SELECT country, sum(amount_cents) FROM events WHERE kind = 'purchase' GROUP BY country;

-- things to notice in the output:
--   PROJECTION lists only the columns actually needed  ← projection pushdown
--   FILTER appears below the aggregate                 ← predicate pushdown
--   the operators report a thread count                ← automatic parallelism

PRAGMA threads;              -- how many cores it will use
SET threads = 1;             -- force single-threaded and re-run to compare
EXPLAIN ANALYZE SELECT country, sum(amount_cents) FROM events GROUP BY country;
SET threads = 8;`,
    },
    {
      title: "The mirror image: point lookups",
      note: "Where a row store wins. Run both.",
      code: `-- DuckDB: fetching one whole row means stitching every column array
.timer on
SELECT * FROM events WHERE id = 4321;

-- SQLite with an index does this in microseconds (card 65).
-- This is not a flaw in either engine — it is the trade-off, visible.

-- DuckDB does have zone maps, so ranges on sorted columns are cheap:
SELECT count(*) FROM events WHERE created_at BETWEEN DATE '2024-06-01' AND DATE '2024-06-30';

-- but if your workload is "find one row by key, thousands of times a second",
-- that is OLTP, and it belongs in SQLite or Postgres. (card 55)`,
    },
  ],
};
