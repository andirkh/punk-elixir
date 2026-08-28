export default {
  front:
    "SQLite is 'just a file'. Name three production services where it is the correct choice, and the one property that rules it out.",
  back: "Correct for: single-node apps where the data fits on one machine (an enormous range), read-heavy services (the whole database can sit in page cache), and edge/embedded deployments where a database server is impossible. Ruled out by: **you need more than one machine writing**. SQLite allows exactly one writer per database file, so horizontal write scaling is simply not on the menu.",
  philosophy: {
    lead: "SQLite is not a toy database. It is the most deployed database on earth, and the honest question is only whether your write path fits on one machine.",
    body: [
      "The reason it is fast in an Elixir service is that there is no network. A Postgres query costs a round trip — typically 0.2 to 1ms before the query even runs. A SQLite query is a function call into a C library in your own process, so it is measured in microseconds. For an app doing many small reads per request, that difference dominates everything else, and it is why single-node Elixir + SQLite deployments feel so quick.",
      "The architecture that fits the BEAM is now obvious from module 7: reads can happen from any process concurrently in WAL mode, and writes go through a single supervised writer (card 42's advice about serialising a decision). If you use `ecto_sqlite3`, its pool does this for you; if you use exqlite directly, a GenServer that owns the write connection is the right shape, with `busy_timeout` set so contention waits instead of erroring.",
      "Operationally there are three things to get right. Set the PRAGMAs on every connection — WAL, foreign_keys, busy_timeout, synchronous=NORMAL — because they are per-connection, not stored in the file. Back up with the online backup API or `VACUUM INTO`, never by copying the file while it is being written. And put the database file on real local disk, not on NFS or a network volume, where its locking assumptions break.",
      "Then know when to leave. Multiple writer nodes, very large datasets, rich concurrent write workloads, or a need for the features in module 11 — that is when Postgres earns its operational cost. Everything you have learned about SQL transfers unchanged; only the engine changes.",
    ],
    diagram: `flowchart TB
  subgraph fit["is SQLite the right choice?"]
    direction LR
    yes0["✓ one node — a huge range<br/>✓ read-heavy workloads<br/>✓ the data fits on one disk<br/>✓ edge / embedded / CLI / desktop<br/>✓ tests — fast and disposable<br/>✓ analytics staging (or DuckDB)"]:::ok
    no0["✗ several nodes must WRITE<br/>✗ heavy concurrent write throughput<br/>✗ a dataset beyond a single machine<br/>✗ you need pg extensions, LISTEN,<br/>   logical replication, rich types<br/>✗ managed HA is a hard requirement"]:::bad
  end
  fit --> lat["LATENCY — why in-process matters<br/>Postgres — app ──0.2–1ms network──&gt; server ──query──&gt; back<br/>SQLite   — app ── a function call ──&gt; libsqlite3 · ~5–50µs<br/>50 small reads per request: ~25ms vs ~1ms"]:::hot
  lat --> arch
  subgraph arch["THE BEAM-SHAPED ARCHITECTURE — inside your node"]
    direction LR
    rp["many request processes<br/>READ"]:::ok --> wal["WAL: concurrent readers ✓"]:::ok
    wp["request processes<br/>WRITE"]:::warn --> single["a SINGLE writer GenServer<br/>serialised, supervised — card 42"]:::hot
  end
  arch --> prag["PRAGMAS ON EVERY CONNECTION — they are per-connection, not in the file<br/>journal_mode = WAL · foreign_keys = ON · busy_timeout = 5000<br/>synchronous = NORMAL · cache_size = -64000 (64MB) · temp_store = MEMORY"]:::code
  prag --> back["BACKUPS<br/>✓ VACUUM INTO 'backup.db'   safe while running<br/>✗ cp learn.db backup.db     corrupt if it is mid-write<br/>⚠ never put the file on NFS or network storage — its locking breaks"]:::warn`,
    takeaway:
      "One writer per file is the only real limit. In-process reads are microseconds, which is why single-node Elixir + SQLite is fast.",
  },
  codeSamples: [
    {
      title: "A supervised connection + single writer",
      note: "Readers go direct; writes serialise through one process.",
      code: `defmodule SqlLab.Repo do
  @moduledoc "Concurrent readers, one supervised writer."
  use GenServer
  alias Exqlite.Sqlite3

  @path "app.db"

  # ---------- reads: run in the CALLER, fully concurrent ----------
  def query(sql, params \\\\ []) do
    conn = reader()
    SqlLab.DB.query(conn, sql, params)
  end

  defp reader do
    case Process.get(:sqlite_reader) do
      nil ->
        conn = SqlLab.DB.open(@path)
        Process.put(:sqlite_reader, conn)
        conn
      conn -> conn
    end
  end

  # ---------- writes: serialised through this GenServer ----------
  def write(sql, params \\\\ []), do: GenServer.call(__MODULE__, {:write, sql, params}, 15_000)
  def transaction(fun), do: GenServer.call(__MODULE__, {:tx, fun}, 30_000)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    conn = SqlLab.DB.open(@path)
    :ok = Sqlite3.execute(conn, "PRAGMA synchronous = NORMAL")
    :ok = Sqlite3.execute(conn, "PRAGMA cache_size = -64000")
    :ok = Sqlite3.execute(conn, "PRAGMA temp_store = MEMORY")
    {:ok, %{conn: conn}}
  end

  @impl true
  def handle_call({:write, sql, params}, _from, %{conn: conn} = s) do
    {:reply, SqlLab.DB.exec(conn, sql, params), s}
  end

  def handle_call({:tx, fun}, _from, %{conn: conn} = s) do
    {:reply, SqlLab.Tx.transaction(conn, fun), s}
  end
end

# in application.ex children:  SqlLab.Repo`,
    },
    {
      title: "With Ecto instead of raw exqlite",
      note: "Everything from module 11 works — only the adapter changes.",
      code: `# mix.exs:  {:ecto_sql, "~> 3.11"}, {:ecto_sqlite3, "~> 0.15"}

defmodule SqlLab.EctoRepo do
  use Ecto.Repo, otp_app: :sqllab, adapter: Ecto.Adapters.SQLite3
end

# config/config.exs
config :sqllab, SqlLab.EctoRepo,
  database: "app.db",
  journal_mode: :wal,
  synchronous: :normal,
  busy_timeout: 5_000,
  cache_size: -64_000,
  pool_size: 5           # ecto_sqlite3 serialises writes for you

# then everything in module 11 applies unchanged:
#   mix ecto.create / ecto.migrate
#   Repo.all(from o in Order, where: o.status == ^"paid")
#   changesets, Multi, preload — all identical`,
    },
    {
      title: "Backups and maintenance",
      note: "Safe while the database is being written.",
      code: `-- online backup: consistent snapshot without stopping writes
VACUUM INTO '/tmp/backup-2026-08-28.db';

-- reclaim space and defragment (locks the db; run in a maintenance window)
VACUUM;

-- health
PRAGMA integrity_check;
PRAGMA foreign_key_check;
PRAGMA wal_checkpoint(TRUNCATE);     -- fold the WAL back into the main file

-- how big is everything?
SELECT page_count * page_size / 1024 / 1024 AS mb FROM pragma_page_count(), pragma_page_size();

SELECT name,
       (SELECT count(*) FROM pragma_table_info(m.name)) AS columns
FROM sqlite_master m WHERE type='table' ORDER BY name;`,
    },
    {
      title: "Benchmark it yourself",
      note: "The in-process advantage is not subtle.",
      code: `conn = SqlLab.DB.open("learn.db")

# 10_000 point lookups
{micros, _} = :timer.tc(fn ->
  Enum.each(1..10_000, fn i ->
    SqlLab.DB.query(conn, "SELECT id, kind FROM events WHERE id = ?", [rem(i, 200_000) + 1])
  end)
end)

IO.puts("10k indexed lookups: #{div(micros, 1000)} ms  (#{Float.round(micros / 10_000, 1)} µs each)")

# the same 10k queries against Postgres over TCP would spend
# 10_000 × ~0.3ms = ~3 seconds purely on network round trips.`,
    },
  ],
};
