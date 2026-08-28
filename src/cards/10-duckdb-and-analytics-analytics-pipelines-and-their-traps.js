export default {
  front:
    "Your nightly report worked for six months, then the container was OOM-killed with no Elixir stack trace. What almost certainly happened?",
  back: "DuckDB allocated memory **outside the BEAM heap** and grew past what the container allowed. `:erlang.memory/0` never showed it, the BEAM's GC could not reclaim it, and there was no Elixir exception to catch — the kernel simply killed the process. Set `memory_limit` and `temp_directory` explicitly so DuckDB spills to disk instead of dying, and cap how many analytical queries can run at once.",
  philosophy: {
    lead: "Analytics traps are operational, not syntactic: they are about a long-running, memory-hungry native engine sharing a node with your web layer.",
    body: [
      "Start with memory, because it is invisible from Elixir. DuckDB manages its own buffer pool and spills to a temp directory when it exceeds `memory_limit` — but the default limit is a fraction of system RAM, which in a container often means a fraction of the *host's* RAM, not your cgroup's. Set both the limit and the temp directory explicitly, and set the limit below your container's ceiling.",
      "Then CPU. DuckDB uses every core by default. On a node also serving HTTP, that means one report can starve your request handlers of CPU — the BEAM's schedulers are still fair to each other, but they are competing with native threads. Set `threads` to a fraction of the machine and keep analytics concurrency at one or two (card 72).",
      "Then result size. It is easy to write a query that returns ten million rows, and `fetch_all` will faithfully materialise every one of them as Elixir terms on your process heap — which is a far more expensive representation than DuckDB's columnar batches. Analytics queries should return aggregates. If you genuinely need bulk rows, write them to Parquet or CSV from inside DuckDB and stream the file, rather than passing them through the BEAM.",
      "Finally, correctness at scale. Every trap from card 68 still applies, and two are worse here: join fan-out silently inflates numbers that end up on a dashboard nobody double-checks, and floating-point sums over millions of rows accumulate real error — use exact integer cents or DECIMAL for money. A wrong report is worse than a slow one, because nobody notices.",
    ],
    diagram: `flowchart TB
  t1["⚠ 1. MEMORY LIVES OUTSIDE THE BEAM<br/>:erlang.memory() never shows DuckDB's buffer pool<br/>the BEAM GC cannot reclaim it<br/>a container OOM-kill gives no Elixir stack trace, just SIGKILL 💀<br/>✓ SET memory_limit = '2GB'            below your cgroup limit<br/>✓ SET temp_directory = '/tmp/duckdb'  so it SPILLS instead of dying<br/>✓ SET max_temp_directory_size = '10GB'"]:::bad
  t1 --> t2["⚠ 2. CPU — DuckDB takes EVERY core by default<br/>one report ⇒ 8 native threads ⇒ your web handlers starve<br/>✓ SET threads = 4, and cap analytics concurrency at 1–2 — card 72"]:::bad
  t2 --> t3["⚠ 3. RESULT SIZE — the BEAM is a bad place for 10M rows<br/>fetch_all(res) on 10M rows ⇒ 10M Elixir terms on one process heap 💥<br/>✓ return AGGREGATES — tens of rows — always<br/>✓ for bulk output: COPY (…) TO 'out.parquet' and stream the FILE"]:::bad
  t3 --> t4["⚠ 4. LONG NATIVE CALLS — card 72<br/>a NIF on a normal scheduler freezes it. Dirty schedulers help,<br/>but the pool is finite ⇒ bound your concurrency, set caller timeouts."]:::bad
  t4 --> t5["⚠ 5. SILENTLY WRONG NUMBERS — card 68, but on a dashboard<br/>join fan-out inflating sums · float drift over millions of rows<br/>✓ integer cents or DECIMAL(18,2) for money, never DOUBLE<br/>✓ assert invariants — totals must reconcile against the OLTP source"]:::bad
  t5 --> pipe
  subgraph pipe["THE PIPELINE THAT HOLDS UP"]
    direction TB
    p1["Postgres<br/>OLTP, untouched"]:::ok -->|export via Oban, off-peak| p2["Parquet<br/>cheap, archivable"]:::ok --> p3["DuckDB<br/>bounded memory + cores"]:::hot -->|aggregates| p4["Phoenix<br/>tens of rows over the wire"]:::ok
  end`,
    takeaway:
      "Set memory_limit, temp_directory and threads; cap concurrency; return aggregates, not rows; use integer money.",
  },
  codeSamples: [
    {
      title: "Configure the engine defensively",
      note: "Do this in init/1, every time.",
      code: `defmodule Shop.Analytics.Config do
  @doc "Settings that stop DuckDB from taking down the node."
  def apply!(conn) do
    for sql <- [
      # stay well under the container limit; spill instead of dying
      "SET memory_limit = '2GB'",
      "SET temp_directory = '/tmp/duckdb_spill'",
      "SET max_temp_directory_size = '10GB'",

      # leave cores for the web layer
      "SET threads = 4",

      # fail fast instead of hanging forever
      "SET enable_progress_bar = false",

      # make float mistakes visible early
      "SET errors_as_json = false"
    ] do
      {:ok, _} = Duckdbex.query(conn, sql)
    end

    :ok
  end

  def settings(conn) do
    {:ok, res} = Duckdbex.query(conn, """
      SELECT name, value FROM duckdb_settings()
      WHERE name IN ('memory_limit','threads','temp_directory','max_temp_directory_size')
    """)
    Duckdbex.fetch_all(res)
  end
end

File.mkdir_p!("/tmp/duckdb_spill")
{:ok, db} = Duckdbex.open("analytics.duckdb")
{:ok, conn} = Duckdbex.connection(db)
Shop.Analytics.Config.apply!(conn)
Shop.Analytics.Config.settings(conn)`,
    },
    {
      title: "Never fetch bulk rows through the BEAM",
      note: "Two ways to be wrong, one way to be right.",
      code: `# ✗ this materialises 5,000,000 Elixir tuples on ONE process heap
# {:ok, res} = Shop.Analytics.query("SELECT * FROM events")
# rows = Duckdbex.fetch_all(res)     # 💥 gigabytes, then a crash

# ✓ 1. return aggregates — tens of rows
Shop.Analytics.query("""
  SELECT country, count(*) AS n, sum(amount_cents) AS cents
  FROM events GROUP BY ALL
""")

# ✓ 2. for bulk output, let DuckDB write the file and stream it
Shop.Analytics.query("""
  COPY (SELECT id, user_id, amount_cents FROM events WHERE kind = 'purchase')
  TO '/tmp/purchases.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")

# then stream the file to the client without loading it (card 5's iolists)
"/tmp/purchases.parquet" |> File.stream!([], 64_000) |> Enum.take(1) |> hd() |> byte_size()

# ✓ 3. or page the query itself
Shop.Analytics.query(
  "SELECT id, amount_cents FROM events ORDER BY id LIMIT $1 OFFSET $2", [1000, 0])`,
    },
    {
      title: "Guard rails around the analytics server",
      note: "Timeouts, concurrency cap, and a memory check.",
      code: `defmodule Shop.Analytics.Guard do
  require Logger

  @max_concurrent 2
  @timeout 30_000

  def run(sql, params \\\\ []) do
    case :counters.get(counter(), 1) do
      n when n >= @max_concurrent ->
        {:error, :analytics_busy}      # shed load rather than pile up

      _ ->
        :counters.add(counter(), 1, 1)
        try do
          task = Task.Supervisor.async_nolink(Shop.TaskSupervisor, fn ->
            Shop.Analytics.query(sql, params)
          end)

          case Task.yield(task, @timeout) || Task.shutdown(task, :brutal_kill) do
            {:ok, result} -> result
            {:exit, reason} -> {:error, {:crashed, reason}}
            nil ->
              Logger.warning("analytics query exceeded #{@timeout}ms, killed")
              {:error, :timeout}
          end
        after
          :counters.sub(counter(), 1, 1)
        end
    end
  end

  defp counter do
    case :persistent_term.get({__MODULE__, :counter}, nil) do
      nil ->
        c = :counters.new(1, [:atomics])
        :persistent_term.put({__MODULE__, :counter}, c)
        c
      c -> c
    end
  end
end

Shop.Analytics.Guard.run("SELECT country, count(*) FROM events GROUP BY ALL")`,
    },
    {
      title: "Numbers that are actually correct",
      note: "Money, fan-out and reconciliation.",
      code: `-- ✗ floats drift over millions of rows
SELECT sum(amount_cents::DOUBLE / 100) AS dollars_float FROM events;

-- ✓ exact: integer cents, formatted only at the edge
SELECT sum(amount_cents) AS cents,
       printf('$%.2f', sum(amount_cents) / 100.0) AS display
FROM events;

-- ✓ or DECIMAL when you must have fractional units
SELECT sum(amount_cents::DECIMAL(18,2)) / 100 AS dollars_exact FROM events;

-- fan-out check (card 61): does the join change the parent count?
SELECT
  (SELECT count(*) FROM events)                                   AS base_rows,
  (SELECT count(*) FROM events e JOIN prices p
     ON e.created_at >= p.effective_from)                         AS joined_rows;
-- if joined_rows > base_rows, every sum over that join is inflated ⚠

-- reconcile the report against the source of truth, in CI or a nightly check
SELECT
  (SELECT sum(total_cents) FROM pg.orders WHERE status='paid')     AS oltp_cents,
  (SELECT sum(total_cents) FROM orders_snapshot WHERE status='paid') AS olap_cents,
  (SELECT sum(total_cents) FROM pg.orders WHERE status='paid')
  - (SELECT sum(total_cents) FROM orders_snapshot WHERE status='paid') AS drift;
-- drift must be 0. Alert if it is not — a wrong report is worse than a slow one.`,
    },
  ],
};
