export default {
  front:
    "SQLite has no server, no port and no user accounts. What IS it, and how do you talk to it from an Elixir process?",
  back: "SQLite is a **library**, not a server: the database is one file, and the engine runs inside YOUR process. From Elixir you use `exqlite`, a NIF binding — `Exqlite.Sqlite3.open/1`, `prepare/2`, `bind/2`, `step/2`. Because it is in-process there is no network round trip, and a query is a function call measured in microseconds.",
  philosophy: {
    lead: "Learning SQL against an in-process, single-file engine strips away everything that is not the language.",
    body: [
      "No connection strings, no auth, no docker compose, no waiting for a container. `learn.db` is a file you can copy, email, delete and recreate. That makes it the ideal place to be fearless: drop the table, reload the seed, try the dangerous query and see what it does.",
      "The Elixir binding matters for a reason beyond convenience. `exqlite` is a **NIF** — native code running inside the BEAM. That is the first time in this deck that something outside the VM's scheduler runs on your behalf, and it comes with a rule you must respect: a NIF that runs longer than about a millisecond blocks its scheduler thread and hurts every other process on the node. exqlite handles this with dirty schedulers, but the principle returns in card 78 with DuckDB, where queries are long by design.",
      "One structural fact to hold from the start: SQLite allows many concurrent readers but only **one writer at a time**, for the whole database file. In WAL mode readers do not block the writer and the writer does not block readers, which is what makes SQLite viable for a real service — but writes still serialise. That is a perfect fit for a supervised single-writer GenServer (card 42), and a bad fit for a write-heavy multi-node system.",
      "Prepared statements are the other habit to build now. You prepare a statement with `?` placeholders once, then bind values to it. That is both the fast path and the only injection-safe path, and it is the same mechanism as Ecto's `^` from card 9.",
    ],
    diagram: `flowchart TB
  subgraph cmp["two deployment models"]
    direction LR
    pg["POSTGRES — module 11<br/>your app ──TCP──&gt; a postgres SERVER<br/>a process per connection, its own data files<br/>a network round trip: ~0.2–1ms<br/>users, roles, ports, configuration"]:::hot
    lite["SQLITE — this module<br/>your app ── a FUNCTION CALL ──&gt; libsqlite3<br/>learn.db, one file<br/>~5–50µs<br/>zero configuration"]:::ok
  end
  cmp --> conc["CONCURRENCY MODEL — memorise this<br/>many READERS ✓ concurrent<br/>one WRITER ⚠ serialised for the WHOLE database file<br/>WAL mode ⇒ readers never block the writer and vice versa<br/>⇒ but still exactly ONE writer at a time"]:::warn
  conc --> api["FROM ELIXIR — exqlite, a NIF<br/>{:ok, conn} = Exqlite.Sqlite3.open('learn.db')<br/>{:ok, stmt} = Exqlite.Sqlite3.prepare(conn, 'SELECT * FROM users WHERE id = ?')<br/>:ok         = Exqlite.Sqlite3.bind(stmt, [42])   ← never interpolate<br/>{:row, row} = Exqlite.Sqlite3.step(conn, stmt)"]:::code
  api --> nif["⚠ a NIF runs INSIDE the BEAM. A long native call blocks a scheduler thread.<br/>Fine for microsecond OLTP queries — card 78 revisits this."]:::bad`,
    takeaway:
      "SQLite is a library and a file, running in your process. Many readers, one writer. Always bind parameters.",
  },
  codeSamples: [
    {
      title: "Add it to a project",
      note: "Terminal. exqlite is the raw driver; we stay raw on purpose.",
      code: `mix new sqllab --sup
cd sqllab

# mix.exs deps:
#   {:exqlite, "~> 0.23"}

mix deps.get
iex -S mix`,
    },
    {
      title: "Query from iex",
      note: "The full open / prepare / bind / step cycle.",
      code: `alias Exqlite.Sqlite3

{:ok, conn} = Sqlite3.open("learn.db")

# one-shot statements (DDL, inserts with no user input)
:ok = Sqlite3.execute(conn, "PRAGMA journal_mode = WAL")
:ok = Sqlite3.execute(conn, "PRAGMA foreign_keys = ON")

:ok = Sqlite3.execute(conn, """
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    country TEXT NOT NULL
  )
""")

# parameterised insert — the ONLY safe way
{:ok, stmt} = Sqlite3.prepare(conn, "INSERT INTO users (email, name, country) VALUES (?, ?, ?)")
:ok = Sqlite3.bind(stmt, ["ada@x.dev", "Ada", "GB"])
:done = Sqlite3.step(conn, stmt)
:ok = Sqlite3.release(conn, stmt)

Sqlite3.last_insert_rowid(conn)`,
    },
    {
      title: "A small wrapper worth writing",
      note: "Turns rows into maps and keeps binding honest.",
      code: `defmodule SqlLab.DB do
  alias Exqlite.Sqlite3

  def open(path \\\\ "learn.db") do
    {:ok, conn} = Sqlite3.open(path)
    :ok = Sqlite3.execute(conn, "PRAGMA journal_mode = WAL")
    :ok = Sqlite3.execute(conn, "PRAGMA foreign_keys = ON")
    :ok = Sqlite3.execute(conn, "PRAGMA busy_timeout = 5000")
    conn
  end

  @doc "Runs a parameterised query and returns a list of maps."
  def query(conn, sql, params \\\\ []) do
    {:ok, stmt} = Sqlite3.prepare(conn, sql)
    :ok = Sqlite3.bind(stmt, params)
    {:ok, cols} = Sqlite3.columns(conn, stmt)
    {:ok, rows} = Sqlite3.fetch_all(conn, stmt)
    :ok = Sqlite3.release(conn, stmt)
    Enum.map(rows, fn row -> cols |> Enum.zip(row) |> Map.new() end)
  end

  def exec(conn, sql, params \\\\ []) do
    {:ok, stmt} = Sqlite3.prepare(conn, sql)
    :ok = Sqlite3.bind(stmt, params)
    :done = Sqlite3.step(conn, stmt)
    :ok = Sqlite3.release(conn, stmt)
    {:ok, Sqlite3.changes(conn)}
  end
end

conn = SqlLab.DB.open()
SqlLab.DB.exec(conn, "INSERT INTO users (email, name, country) VALUES (?,?,?)",
               ["grace@x.dev", "Grace", "US"])
SqlLab.DB.query(conn, "SELECT * FROM users WHERE country = ?", ["US"])`,
    },
    {
      title: "Useful PRAGMAs and CLI dot-commands",
      note: "The knobs you actually touch.",
      code: `-- performance / correctness knobs (set on every connection)
PRAGMA journal_mode = WAL;      -- concurrent readers + one writer
PRAGMA foreign_keys = ON;       -- OFF BY DEFAULT — see card 67 ⚠
PRAGMA busy_timeout = 5000;     -- wait instead of failing on a locked db
PRAGMA synchronous = NORMAL;    -- safe with WAL, much faster than FULL

-- introspection
PRAGMA table_info(orders);
PRAGMA index_list(orders);
PRAGMA integrity_check;

-- CLI conveniences
.headers on
.mode box            -- also: .mode json / csv / markdown
.timer on
.schema orders
.dump users          -- SQL text of the table + its data
.read seed.sql       -- run a file`,
    },
  ],
};
