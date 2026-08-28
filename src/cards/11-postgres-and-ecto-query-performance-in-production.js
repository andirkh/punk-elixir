export default {
  front:
    "An endpoint that was fast at 10k rows takes 4 seconds at 10 million. What are the four things you check, in order?",
  back: "(1) **Indexes** — run `EXPLAIN ANALYZE`; a sequential scan on a big table is your answer. (2) **N+1** — count the queries in your logs. (3) **Over-selecting** — are you loading whole rows and associations you never render? (4) **Pagination** — `OFFSET 100000` makes Postgres walk 100k rows; use keyset pagination. Ecto gives you the tools for all four; the discipline is measuring before guessing.",
  philosophy: {
    lead: "The BEAM makes your application concurrent; it does nothing for a missing index. Database work is where most Elixir services actually spend their time.",
    body: [
      "Measure first, always. `Ecto.Adapters.SQL.explain/4` runs EXPLAIN ANALYZE from Elixir, and Ecto's telemetry events give you real query timings per endpoint. Dev logs print every query with its duration, so an N+1 is visible as a wall of near-identical lines. Guessing at optimisations without this data wastes days.",
      "Keyset (cursor) pagination is the one non-obvious item on the list and worth adopting early. `OFFSET n` is O(n) because Postgres must count past the skipped rows; `WHERE (inserted_at, id) < (last_seen_at, last_seen_id) ORDER BY inserted_at DESC, id DESC LIMIT 20` is O(log n) with the right index and stays fast on page 5000. It also does not skip or duplicate rows when data changes between pages.",
      "Two more habits pay off constantly: index the columns you filter and sort on (composite indexes in the order you use them), and use `select` to fetch only the fields you render. Loading a 40-column row to display three fields is a hidden cost that multiplies across a result set.",
    ],
    diagram: `flowchart TB
  p1["1. INDEXES — run EXPLAIN ANALYZE first<br/>Seq Scan on orders (cost=… rows=10000000)   ← the smoking gun<br/>create index(:orders, [:user_id, :inserted_at])<br/>the composite column ORDER must match your WHERE + ORDER BY"]:::hot
  p1 --> p2["2. N+1 — the dev log shows the same query 100 times<br/>⇒ preload(:items) — card 84"]:::hot
  p2 --> p3["3. OVER-SELECTING<br/>Repo.all(Order) — 40 columns × 10k rows<br/>select: %{id: o.id, total: o.total_cents}   ← 2 columns ✓"]:::hot
  p3 --> p4
  subgraph p4["4. PAGINATION"]
    direction LR
    o1["OFFSET<br/>LIMIT 20 OFFSET 100000<br/>→ Postgres walks 100k rows<br/>→ O(n), slower every page<br/>→ duplicates or skips if data changes between pages"]:::bad
    o2["KEYSET — a cursor<br/>WHERE (inserted_at, id) &lt; (^last_at, ^last_id)<br/>ORDER BY inserted_at DESC, id DESC<br/>LIMIT 20<br/>→ O(log n), stable ✓"]:::ok
  end
  p4 --> meas["MEASURE IT<br/>Ecto.Adapters.SQL.explain(Repo, :all, query, analyze: true)<br/>config :shop, Shop.Repo, log: :debug        see every query and its timing<br/>:telemetry events [:shop, :repo, :query]    per-endpoint timings<br/>Repo.aggregate(q, :count)                   BEFORE you Repo.all a million rows"]:::code`,
    takeaway:
      "EXPLAIN before optimising. Index what you filter, preload what you render, and paginate by keyset.",
  },
  codeSamples: [
    {
      title: "EXPLAIN from iex",
      note: "The first thing to run when something is slow.",
      code: `import Ecto.Query
alias Shop.{Repo, Orders.Order}

q = from o in Order, where: o.user_id == ^1, order_by: [desc: o.inserted_at], limit: 20

IO.puts(Ecto.Adapters.SQL.explain(Repo, :all, q))
IO.puts(Ecto.Adapters.SQL.explain(Repo, :all, q, analyze: true, buffers: true))

# look for:  Seq Scan  (bad on big tables)
#            Index Scan / Index Only Scan  (good)
#            rows=  estimate vs actual  (badly off ⇒ run ANALYZE)`,
    },
    {
      title: "Keyset pagination",
      note: "Copy this; it stays fast at any depth.",
      code: `defmodule Shop.Pagination do
  import Ecto.Query

  @doc "Cursor pagination on (inserted_at, id) descending."
  def page(query, opts \\\\ []) do
    limit = Keyword.get(opts, :limit, 20)
    cursor = Keyword.get(opts, :after)

    query
    |> apply_cursor(cursor)
    |> order_by([o], desc: o.inserted_at, desc: o.id)
    |> limit(^(limit + 1))
    |> Shop.Repo.all()
    |> build_page(limit)
  end

  defp apply_cursor(query, nil), do: query
  defp apply_cursor(query, {at, id}) do
    where(query, [o], {o.inserted_at, o.id} < {type(^at, :utc_datetime_usec), ^id})
  end

  defp build_page(rows, limit) do
    {items, rest} = Enum.split(rows, limit)
    last = List.last(items)

    %{
      items: items,
      has_more?: rest != [],
      next_cursor: last && {last.inserted_at, last.id}
    }
  end
end

# usage:
# page1 = Shop.Pagination.page(Shop.Orders.Order, limit: 20)
# page2 = Shop.Pagination.page(Shop.Orders.Order, limit: 20, after: page1.next_cursor)

# and the index that makes it O(log n):
# create index(:orders, ["inserted_at DESC", "id DESC"])`,
    },
    {
      title: "Find and fix an N+1",
      note: "",
      code: `import Ecto.Query
alias Shop.{Repo, Orders.Order}

# turn on query logging for this session
Logger.configure(level: :debug)

# BAD — 1 + N queries
orders = Repo.all(from o in Order, limit: 50)
Enum.map(orders, fn o -> Repo.preload(o, :items).items |> length() end)

# GOOD — 2 queries
orders = Repo.all(from o in Order, limit: 50, preload: [:items])
Enum.map(orders, fn o -> length(o.items) end)

# BETTER when you only need counts — 1 query, no item rows at all
from(o in Order,
  left_join: i in assoc(o, :items),
  group_by: o.id,
  select: %{id: o.id, item_count: count(i.id)},
  limit: 50
) |> Repo.all()`,
    },
    {
      title: "Telemetry for query timings",
      note: "Attach once in application.ex and see your slowest queries.",
      code: `defmodule Shop.QueryLogger do
  require Logger

  def attach do
    :telemetry.attach(
      "slow-query-logger",
      [:shop, :repo, :query],
      &__MODULE__.handle/4,
      %{threshold_ms: 100}
    )
  end

  def handle(_event, measurements, metadata, %{threshold_ms: threshold}) do
    total_ms = System.convert_time_unit(measurements.total_time, :native, :millisecond)

    if total_ms >= threshold do
      Logger.warning("""
      SLOW QUERY #{total_ms}ms (queue #{div(measurements[:queue_time] || 0, 1_000_000)}ms)
      #{metadata.query}
      params: #{inspect(metadata.params)}
      """)
    end
  end
end

Shop.QueryLogger.attach()`,
    },
  ],
};
