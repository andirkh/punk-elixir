export default {
  front:
    "What is `Shop.Repo` actually, at runtime, and why is it in your supervision tree?",
  back: "It is a **supervised connection pool** (DBConnection + Postgrex) that owns N TCP connections to Postgres. `Repo.all/1`, `Repo.insert/1` etc. check out a connection, run the query, and check it back in. It sits in your children list before anything that queries, and its `pool_size` is one of the most important numbers in your deployment.",
  philosophy: {
    lead: "Ecto is not an ORM. It is a query builder plus a changeset library plus a connection pool, and each of those three parts is independently useful.",
    body: [
      "Everything you learned in module 9 still applies: Postgres is an OLTP row store, so the same relational model, the same execution order, the same joins, the same NULL semantics and the same index reasoning carry over unchanged. What Postgres adds over SQLite is a server — many concurrent writers, real type enforcement, MVCC, replication, richer types and extensions — at the cost of a network hop and something to operate. And what Ecto adds over raw SQL is composable query values, changesets at the trust boundary, and a supervised pool.",
      "The absence of an object graph is deliberate. There is no lazy loading, no identity map, no hidden N+1 queries fired by a getter — if data is not loaded, you get an `Ecto.Association.NotLoaded` struct and a clear error. Every query is explicit and visible, which is exactly what you want when a database is your bottleneck.",
      "The pool is where Elixir's concurrency meets a decidedly non-concurrent resource. You may have 100,000 processes but only, say, 10 database connections. Requests queue for a connection with a `queue_target`/`queue_interval` policy, and when the pool is saturated you get `DBConnection.ConnectionError` rather than an unbounded queue. Sizing it is a real decision: too small and you serialise your app; too large and you exhaust Postgres's own `max_connections` (each Postgres connection is an OS process).",
      "A useful rule: `pool_size` per node times the number of nodes must stay comfortably under Postgres `max_connections`. Start around 10 and measure. If you truly need more concurrency, put PgBouncer in front rather than raising the pool.",
    ],
    diagram: `flowchart TB
  many["100,000 Elixir processes"]:::muted --> pool
  subgraph pool["Shop.Repo — pool_size: 10"]
    direction LR
    c1["conn"]:::hot
    c2["conn"]:::hot
    c3["conn"]:::hot
    c4["conn … 10 of them"]:::hot
  end
  pool --> queue["if all are busy, callers QUEUE<br/>queue_target: 50ms · queue_interval: 1000ms<br/>then: DBConnection.ConnectionError"]:::warn
  pool --> pg["PostgreSQL<br/>max_connections, default 100<br/>each connection is one OS process"]:::ok
  pg --> sizing["THE SIZING RULE<br/>nodes × pool_size &lt; postgres max_connections<br/>need more? ⇒ PgBouncer, not a bigger pool."]:::hot
  sizing --> notorm["NOT AN ORM — no lazy loading, no identity map, no surprise queries<br/>order.items ⇒ #Ecto.Association.NotLoaded&lt;:items&gt; until you preload"]:::warn
  notorm --> api["THE API SURFACE YOU WILL USE<br/>Repo.all / one / one! / get / get! / get_by      reads<br/>Repo.insert / update / delete and their bangs    writes<br/>Repo.insert_all / update_all / delete_all        bulk, no changesets<br/>Repo.transaction/1 · Repo.preload/2 · Repo.aggregate/3 · Repo.stream/1"]:::code`,
    takeaway:
      "Repo is a supervised pool. Queries are explicit; pool_size is a deployment decision.",
  },
  codeSamples: [
    {
      title: "Set it up",
      note: "Add ecto_sql + postgrex, then these files.",
      code: `# mix.exs deps:
#   {:ecto_sql, "~> 3.11"}, {:postgrex, ">= 0.0.0"}

# lib/shop/repo.ex
defmodule Shop.Repo do
  use Ecto.Repo,
    otp_app: :shop,
    adapter: Ecto.Adapters.Postgres
end

# config/dev.exs
config :shop, Shop.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "shop_dev",
  pool_size: 10,
  show_sensitive_data_on_connection_error: true

# config/config.exs
config :shop, ecto_repos: [Shop.Repo]

# lib/shop/application.ex children:  [Shop.Repo, ...]   ← FIRST

# terminal:
mix ecto.create
mix ecto.migrate`,
    },
    {
      title: "Production pool config",
      note: "config/runtime.exs — card 28 applied.",
      code: `import Config

if config_env() == :prod do
  config :shop, Shop.Repo,
    url: System.fetch_env!("DATABASE_URL"),
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    queue_target: 50,        # aim to hand out a conn within 50ms
    queue_interval: 1_000,   # if the average exceeds that for 1s, start erroring
    timeout: 15_000,         # per-query timeout
    ssl: true,
    socket_options: [:inet6]
end`,
    },
    {
      title: "Talk to the database from iex",
      note: "iex -S mix, no schemas needed yet.",
      code: `Shop.Repo.query!("SELECT 1 AS one")
Shop.Repo.query!("SELECT now(), version()")

%Postgrex.Result{rows: rows, columns: cols} =
  Shop.Repo.query!("SELECT $1::int + $2::int AS sum", [40, 2])
{cols, rows}

# pool health
Shop.Repo.config()[:pool_size]
Process.whereis(Shop.Repo) |> Process.info(:message_queue_len)`,
    },
    {
      title: "See the pool saturate",
      note: "11 slow queries against a pool of 10.",
      code: `# each pg_sleep holds a connection for 1 second
tasks =
  for i <- 1..20 do
    Task.async(fn ->
      t0 = System.monotonic_time(:millisecond)
      Shop.Repo.query!("SELECT pg_sleep(1)", [], timeout: 30_000)
      {i, System.monotonic_time(:millisecond) - t0}
    end)
  end

Task.await_many(tasks, 60_000)
# the first ~10 finish in ~1000ms, the rest in ~2000ms:
# they QUEUED for a connection. That is your real concurrency limit.`,
    },
  ],
};
