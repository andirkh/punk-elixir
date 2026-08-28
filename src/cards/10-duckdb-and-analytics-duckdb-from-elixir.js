export default {
  front:
    "`duckdbex` is a NIF, and analytical queries run for seconds. What does that combination do to the BEAM, and how do you avoid it?",
  back: "A NIF runs on a BEAM scheduler thread. A native call longer than ~1ms starves every other process on that scheduler; a multi-second query is catastrophic. duckdbex runs queries on **dirty schedulers**, which exist for exactly this, but you should still isolate analytics behind a `Task.Supervisor` or a dedicated GenServer with a bounded concurrency limit — so a slow report cannot consume the whole node.",
  philosophy: {
    lead: "This is the first time in the deck that something genuinely long-running executes inside the VM rather than inside a process you control.",
    body: [
      "Everything the BEAM promises — preemptive scheduling, fairness, isolation — rests on the VM being able to interrupt code. It cannot interrupt native code. A NIF is a hole in that guarantee: while it runs, its scheduler thread is unavailable, so with 8 schedulers, 8 concurrent long NIF calls freeze the entire node, including your health check and your supervisors.",
      "Dirty schedulers are the sanctioned answer. They are a separate pool of threads for exactly this kind of work, and duckdbex uses them, so a long query no longer blocks normal processes. But the pool is finite (defaulting to the number of cores), so unbounded concurrent analytics still queues, and DuckDB itself is already using every core for one query. Running eight reports at once does not make them faster — it makes all eight slower and starves your web requests of CPU.",
      "The shape that works is deliberately boring: one DuckDB connection owned by a supervised GenServer, queries dispatched with a concurrency cap of one or two, results materialised as small aggregates rather than raw rows, and a timeout on the caller side. `Task.Supervisor.async_nolink` with `Task.yield`/`shutdown` (card 36) gives you the cancellation story.",
      "Also note the memory boundary. DuckDB allocates outside the BEAM heap, so `:erlang.memory/0` will not show it and the BEAM's garbage collector cannot help. Set `memory_limit` explicitly, or a runaway query gets your container OOM-killed with no Elixir stack trace to explain it.",
    ],
    diagram: `flowchart TB
  subgraph nif["⚠ WHAT A NIF DOES TO THE SCHEDULER"]
    direction TB
    n1["a normal BEAM process → preempted every ~4000 reductions ✓ fair"]:::ok
    n2["a NIF call → runs to completion, it cannot be interrupted"]:::warn
    n3["under 1ms — fine<br/>seconds — that scheduler thread is FROZEN<br/>8 concurrent long NIFs on 8 schedulers ⇒ the whole node stalls 💀"]:::bad
    n1 --> n2 --> n3
  end
  n3 --> dirty["✓ DIRTY SCHEDULERS — a separate thread pool for long native work.<br/>duckdbex uses them, so your web requests keep being scheduled.<br/>But the pool is finite, and DuckDB already uses every core per query."]:::ok
  dirty --> s1
  subgraph shape["THE SHAPE THAT WORKS"]
    direction TB
    s1["many web request processes — they NEVER call DuckDB directly"]:::muted
    s2["Analytics GenServer — owns ONE duckdb connection<br/>max_concurrency 1–2 · memory_limit set explicitly<br/>returns small AGGREGATES, never raw rows"]:::hot
    s1 -->|"GenServer.call with a caller-side timeout"| s2
  end
  s2 --> mem["⚠ MEMORY LIVES OUTSIDE THE BEAM HEAP<br/>:erlang.memory() will NOT show it · the GC cannot reclaim it<br/>SET memory_limit = '2GB'   ← or the container OOM-kills you<br/>SET threads = 4            ← leave cores for the web layer"]:::bad
  mem --> api["{:ok, db}   = Duckdbex.open('analytics.duckdb')   # or open() for in-memory<br/>{:ok, conn} = Duckdbex.connection(db)<br/>{:ok, res}  = Duckdbex.query(conn, 'SELECT ...')<br/>rows        = Duckdbex.fetch_all(res)<br/>{:ok, stmt} = Duckdbex.prepare_statement(conn, '… WHERE country = $1')<br/>{:ok, res}  = Duckdbex.execute_statement(stmt, ['GB'])   ← bind, always"]:::code`,
    takeaway:
      "DuckDB queries are long native calls. Isolate them behind one supervised process, cap concurrency, set memory_limit.",
  },
  codeSamples: [
    {
      title: "First contact",
      note: 'Add {:duckdbex, "~> 0.3"} to deps, then iex -S mix.',
      code: `{:ok, db} = Duckdbex.open()                 # in-memory
{:ok, conn} = Duckdbex.connection(db)

{:ok, res} = Duckdbex.query(conn, "SELECT 42 AS answer, 'duck' AS bird")
Duckdbex.fetch_all(res)
Duckdbex.columns(res)

# a real file, and the settings that keep the node safe
{:ok, db} = Duckdbex.open("analytics.duckdb")
{:ok, conn} = Duckdbex.connection(db)
{:ok, _} = Duckdbex.query(conn, "SET memory_limit = '2GB'")
{:ok, _} = Duckdbex.query(conn, "SET threads = 4")

{:ok, res} = Duckdbex.query(conn, "SELECT count(*) FROM range(10000000)")
Duckdbex.fetch_all(res)`,
    },
    {
      title: "Bind parameters — same rule as card 68",
      note: "Prepared statements use $1, $2 (Postgres style).",
      code: `{:ok, _} = Duckdbex.query(conn, """
  CREATE OR REPLACE TABLE events AS
  SELECT i AS id,
         (i % 1000) + 1 AS user_id,
         ['GB','US','JP'][(i % 3) + 1] AS country,
         ((i * 37) % 20000)::BIGINT AS amount_cents,
         DATE '2025-01-01' + INTERVAL ((i % 365)) DAY AS created_at
  FROM range(1000000) t(i)
""")

{:ok, stmt} = Duckdbex.prepare_statement(conn, """
  SELECT country, count(*) AS n, sum(amount_cents) AS cents
  FROM events
  WHERE country = $1 AND created_at >= $2
  GROUP BY country
""")

{:ok, res} = Duckdbex.execute_statement(stmt, ["GB", ~D[2025-06-01]])
Duckdbex.fetch_all(res)

# ✗ never:  "... WHERE country = '" <> user_input <> "'"`,
    },
    {
      title: "The supervised analytics server",
      note: "One connection, bounded concurrency, hard timeouts.",
      code: `defmodule Shop.Analytics do
  @moduledoc "All DuckDB access goes through here. Never call the NIF directly."
  use GenServer
  require Logger

  @timeout 30_000

  # ---------- client ----------
  def start_link(opts), do: GenServer.start_link(__MODULE__, opts, name: __MODULE__)

  @doc "Runs an analytical query. Returns {:ok, rows} | {:error, reason}."
  def query(sql, params \\\\ []), do: GenServer.call(__MODULE__, {:query, sql, params}, @timeout)

  # ---------- server ----------
  @impl true
  def init(opts) do
    path = Keyword.get(opts, :path, "analytics.duckdb")
    {:ok, db} = Duckdbex.open(path)
    {:ok, conn} = Duckdbex.connection(db)

    # leave headroom for the web layer — do NOT let DuckDB take the machine
    {:ok, _} = Duckdbex.query(conn, "SET memory_limit = '#{Keyword.get(opts, :memory, "2GB")}'")
    {:ok, _} = Duckdbex.query(conn, "SET threads = #{Keyword.get(opts, :threads, 4)}")

    {:ok, %{db: db, conn: conn, queries: 0}}
  end

  @impl true
  def handle_call({:query, sql, params}, _from, state) do
    started = System.monotonic_time(:millisecond)

    reply =
      case run(state.conn, sql, params) do
        {:ok, res} -> {:ok, Duckdbex.fetch_all(res)}
        {:error, reason} -> {:error, reason}
      end

    ms = System.monotonic_time(:millisecond) - started
    if ms > 1_000, do: Logger.warning("slow analytics query #{ms}ms: #{String.slice(sql, 0, 120)}")

    {:reply, reply, %{state | queries: state.queries + 1}}
  end

  defp run(conn, sql, []), do: Duckdbex.query(conn, sql)
  defp run(conn, sql, params) do
    with {:ok, stmt} <- Duckdbex.prepare_statement(conn, sql) do
      Duckdbex.execute_statement(stmt, params)
    end
  end
end

# application.ex:  {Shop.Analytics, path: "analytics.duckdb", threads: 4, memory: "2GB"}

Shop.Analytics.query("SELECT country, sum(amount_cents) FROM events GROUP BY country")`,
    },
    {
      title: "Rows into maps, and cancellation",
      note: "Two small helpers you will want immediately.",
      code: `defmodule Shop.Analytics.Rows do
  @doc "Zips DuckDB columns and rows into a list of maps."
  def to_maps(res) do
    cols = Duckdbex.columns(res)
    Enum.map(Duckdbex.fetch_all(res), fn row -> cols |> Enum.zip(row) |> Map.new() end)
  end
end

# a report the caller can give up on (card 36)
task =
  Task.Supervisor.async_nolink(Shop.TaskSupervisor, fn ->
    Shop.Analytics.query("SELECT country, count(*) FROM events GROUP BY country")
  end)

case Task.yield(task, 5_000) || Task.shutdown(task, :brutal_kill) do
  {:ok, {:ok, rows}} -> {:ok, rows}
  {:ok, {:error, r}} -> {:error, r}
  {:exit, reason}    -> {:error, {:crashed, reason}}
  nil                -> {:error, :report_timed_out}
end`,
    },
  ],
};
