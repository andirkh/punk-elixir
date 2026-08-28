export default {
  front:
    "Write the query for 'paid orders over $50 for this user, newest first, 20 per page' — and explain why `^` appears.",
  back: "`from(o in Order, where: o.user_id == ^id and o.status == :paid and o.total_cents > 5000, order_by: [desc: o.inserted_at], limit: 20)`. The `^` (card 9) marks a value coming from Elixir; Ecto sends it as a **bound parameter** (`$1`), which is why Ecto queries are injection-safe by construction. Queries are composable data structures — you can build them in pieces and only hit the database when you call `Repo`.",
  philosophy: {
    lead: "An Ecto query is a value you build up, not a string you concatenate. That is what makes filtering, scoping and pagination composable.",
    body: [
      "Because a query is data, `list_orders` can start from a base query and pipe it through `filter_by_status`, `filter_by_date`, `paginate` — each a small function returning a query. You get dynamic filtering with no string building and no injection surface. Contrast with SQL string concatenation, where every optional filter is an `if` around a fragment of text.",
      "There are two syntaxes for the same thing. Keyword syntax (`from o in Order, where: ...`) reads like SQL and is nice for a whole query written at once. Macro/pipe syntax (`Order |> where([o], ...) |> order_by(...)`) composes, and is what you want inside context functions. Mixing them is normal.",
      "Two details to internalise early. Preloading is explicit — accessing an unloaded association gives you `NotLoaded`, never a surprise query, which is how Ecto structurally prevents lazy-loading N+1s. And `select` controls exactly which columns cross the wire; selecting whole schemas by default is fine until you are reading a million rows, at which point selecting a map of three fields is dramatically faster.",
    ],
    diagram: `flowchart TB
  subgraph two["TWO SYNTAXES, ONE %Ecto.Query{} STRUCT"]
    direction LR
    kw["from o in Order,<br/>  join: u in assoc(o, :user),<br/>  where: o.status == :paid,<br/>  where: o.total_cents &gt; ^min,<br/>  order_by: [desc: o.inserted_at],<br/>  limit: 20,<br/>  preload: [:items],<br/>  select: %{id: o.id, email: u.email}"]:::code
    pipeq["Order<br/>¦&gt; join(:inner, [o], u in assoc(o, :user))<br/>¦&gt; where([o], o.status == :paid)<br/>¦&gt; where([o], o.total_cents &gt; ^min)<br/>¦&gt; order_by([o], desc: o.inserted_at)<br/>¦&gt; limit(20)<br/>¦&gt; preload(:items)"]:::code
  end
  two --> pin["^value ⇒ a bound parameter $1 ⇒ SQL-injection safe BY CONSTRUCTION"]:::ok
  pin --> c0
  subgraph comp["COMPOSE — this is the whole point"]
    direction TB
    c0["def list(user, params) do<br/>  Order<br/>  ¦&gt; for_user(user)        each function takes a query<br/>  ¦&gt; with_status(params)   and returns a query<br/>  ¦&gt; newer_than(params)    and NOTHING hits the database<br/>  ¦&gt; paginate(params)<br/>  ¦&gt; Repo.all()            ← … until here<br/>end"]:::hot
    c0 ~~~ list
    list ~~~ for_user
    for_user ~~~ with_status
    with_status ~~~ newer_than
    newer_than ~~~ paginate
  end
  c0 --> api["Repo.all/1 · Repo.one/1 · Repo.exists?/1 · Repo.aggregate(q, :count)<br/>Repo.update_all(q, set: [...]) · Repo.delete_all(q) · Repo.stream/1<br/><br/>INSPECT THE SQL — Ecto.Adapters.SQL.to_sql(:all, Repo, query)"]:::warn`,
    takeaway:
      "Queries are composable data. ^ binds parameters. Nothing runs until a Repo call.",
  },
  codeSamples: [
    {
      title: "The query from the question, both ways",
      note: "",
      code: `import Ecto.Query
alias Shop.Orders.Order
alias Shop.Repo

user_id = 1

q1 =
  from o in Order,
    where: o.user_id == ^user_id,
    where: o.status == :paid,
    where: o.total_cents > 5_000,
    order_by: [desc: o.inserted_at],
    limit: 20

q2 =
  Order
  |> where([o], o.user_id == ^user_id)
  |> where([o], o.status == :paid)
  |> where([o], o.total_cents > 5_000)
  |> order_by([o], desc: o.inserted_at)
  |> limit(20)

# see the SQL before running anything:
Ecto.Adapters.SQL.to_sql(:all, Repo, q1)
Repo.all(q2)`,
    },
    {
      title: "Composable scopes — the context pattern",
      note: "Every optional filter is a function, not an if around a string.",
      code: `defmodule Shop.Orders.Queries do
  import Ecto.Query
  alias Shop.Orders.Order

  def base, do: from(o in Order, as: :order)

  def for_user(q, user_id), do: where(q, [order: o], o.user_id == ^user_id)

  def with_status(q, nil), do: q
  def with_status(q, status) when is_binary(status),
    do: where(q, [order: o], o.status == ^String.to_existing_atom(status))

  def min_total(q, nil), do: q
  def min_total(q, cents), do: where(q, [order: o], o.total_cents >= ^cents)

  def since(q, nil), do: q
  def since(q, %DateTime{} = dt), do: where(q, [order: o], o.inserted_at >= ^dt)

  def newest_first(q), do: order_by(q, [order: o], desc: o.inserted_at)

  def page(q, page, per_page) do
    q |> limit(^per_page) |> offset(^((page - 1) * per_page))
  end

  def summary(q) do
    select(q, [order: o], %{id: o.id, status: o.status, total: o.total_cents})
  end
end

alias Shop.Orders.Queries, as: Q

Q.base()
|> Q.for_user(1)
|> Q.with_status("paid")
|> Q.min_total(5_000)
|> Q.newest_first()
|> Q.page(1, 20)
|> Q.summary()
|> Shop.Repo.all()`,
    },
    {
      title: "Aggregates, grouping, existence",
      note: "",
      code: `import Ecto.Query
alias Shop.Orders.Order
alias Shop.Repo

Repo.aggregate(Order, :count)
Repo.aggregate(from(o in Order, where: o.status == :paid), :sum, :total_cents)
Repo.exists?(from o in Order, where: o.user_id == ^1)

from(o in Order,
  group_by: o.status,
  select: %{status: o.status, count: count(o.id), revenue: sum(o.total_cents)},
  order_by: [desc: count(o.id)]
)
|> Repo.all()

# distinct, having, subqueries
from(o in Order, distinct: o.user_id, select: o.user_id) |> Repo.all()

from(o in Order,
  group_by: o.user_id,
  having: sum(o.total_cents) > 10_000,
  select: {o.user_id, sum(o.total_cents)}
) |> Repo.all()

big_spenders = from(o in Order, group_by: o.user_id, having: sum(o.total_cents) > 10_000, select: o.user_id)
from(o in Order, where: o.user_id in subquery(big_spenders)) |> Repo.all()`,
    },
    {
      title: "Bulk operations and streaming",
      note: "No changesets, no structs — straight SQL power.",
      code: `import Ecto.Query
alias Shop.Orders.Order
alias Shop.Repo

# update many rows in one statement
from(o in Order, where: o.status == :pending and o.inserted_at < ago(30, "day"))
|> Repo.update_all(set: [status: :cancelled])

# increment without reading first
from(o in Order, where: o.id == ^1) |> Repo.update_all(inc: [total_cents: 500])

# bulk insert (fast; skips changesets, so validate first!)
now = DateTime.utc_now()

rows =
  for i <- 1..1_000 do
    %{user_id: 1, status: :pending, total_cents: i, currency: "USD",
      inserted_at: now, updated_at: now}
  end

Repo.insert_all(Order, rows, on_conflict: :nothing)

# stream a huge result set inside a transaction, constant memory
Repo.transaction(fn ->
  from(o in Order, select: o.id)
  |> Repo.stream(max_rows: 500)
  |> Stream.chunk_every(500)
  |> Enum.reduce(0, fn chunk, acc -> acc + length(chunk) end)
end)`,
    },
  ],
};
