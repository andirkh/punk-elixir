export default {
  front:
    "You need a Postgres feature Ecto has no macro for — a window function, `ILIKE`, a jsonb operator, `tsvector` search. What are your options?",
  back: "`fragment/1` embeds raw SQL inside an Ecto query while keeping `?` placeholders parameterised and safe. For a whole statement, `Repo.query/3` with `$1` parameters returns a `%Postgrex.Result{}`. Both are first-class options — Ecto never tries to hide SQL from you, and reaching for raw SQL for a reporting query is normal, not a defeat.",
  philosophy: {
    lead: "Ecto covers the common 95% with macros and gives you an honest door to the other 5% without abandoning safety.",
    body: [
      'The rule with `fragment` is: interpolate VALUES with `?` (which become bound parameters), never build the fragment string itself from user input. `fragment("? ILIKE ?", u.email, ^pattern)` is safe. Building the string with `#{}` from a request parameter is a SQL injection, exactly as it would be anywhere else. This is the one place in Ecto where you can get it wrong, so it is worth stating plainly.',
      "`Repo.query/3` is the full escape hatch, returning columns and rows as plain data. It skips schemas entirely, which is often correct for analytics and reports — you do not need a struct to compute a daily revenue chart. You can also load results into schemas with `Repo.load/2` when you do.",
      "A practical middle ground worth knowing: `select_merge` plus `fragment` lets you add a computed column (a rank, a distance, a jsonb extraction) onto an otherwise normal Ecto query, so you get schema structs plus your extra field.",
    ],
    diagram: `flowchart TB
  l1["LEVEL 1 — a fragment INSIDE a normal Ecto query · composability is kept<br/>where(u, fragment('? ILIKE ?', u.email, ^('%' &lt;&gt; term &lt;&gt; '%')))<br/>select_merge(o, %{rank: fragment('row_number() OVER (ORDER BY ? DESC)', o.total_cents)})<br/>where(o, fragment('?-&gt;&gt;? = ?', o.metadata, 'source', ^'web'))     jsonb<br/>where(p, fragment('to_tsvector(?, ?) @@ plainto_tsquery(?)', 'english', p.body, ^q))"]:::code
  l1 --> l2["LEVEL 2 — a whole statement<br/>Repo.query!('SELECT date_trunc(?, inserted_at) d, sum(total_cents)<br/>             FROM orders WHERE user_id = $1<br/>             GROUP BY 1 ORDER BY 1', [user_id])<br/>⇒ %Postgrex.Result{columns: ['d','sum'], rows: [[~U[...], 12500], …]}"]:::code
  l2 --> s1
  subgraph safety["SAFE vs UNSAFE"]
    direction TB
    s1["✓ fragment('? ILIKE ?', u.email, ^pattern)   ← ? is a PARAMETER"]:::ok
    s2["✓ Repo.query(sql, [user_id])                 ← $1 is a PARAMETER"]:::ok
    s3["✗ fragment(user_input)                       ← INJECTION"]:::bad
    s4["✗ Repo.query('… WHERE id = ' &lt;&gt; user_input)  ← INJECTION"]:::bad
    s1 ~~~ s2 ~~~ s3 ~~~ s4
  end
  s4 --> rule["the STRUCTURE may be built by you.<br/>the VALUES never are."]:::hot
  rule --> extra["Repo.load(Order, {columns, row}) — turn raw rows into structs<br/>type(^value, :integer) — tell Ecto the type of a parameter"]:::warn`,
    takeaway:
      "fragment for a piece, Repo.query for a whole statement. Values are always parameters, never interpolated.",
  },
  codeSamples: [
    {
      title: "Fragments inside a query",
      note: "",
      code: `import Ecto.Query
alias Shop.{Repo, Orders.Order, Accounts.User}

term = "ada"

# case-insensitive search
from(u in User, where: fragment("? ILIKE ?", u.email, ^("%" <> term <> "%")))
|> Repo.all()

# jsonb access
from(o in Order, where: fragment("?->>'source' = ?", o.metadata, ^"web"))
|> Repo.all()

# a window function added onto a normal query
from(o in Order,
  select_merge: %{rank: fragment("row_number() OVER (ORDER BY ? DESC)", o.total_cents)}
)
|> limit(10)
|> Repo.all()

# date truncation + grouping
from(o in Order,
  group_by: fragment("date_trunc('day', ?)", o.inserted_at),
  select: %{
    day: fragment("date_trunc('day', ?)", o.inserted_at),
    revenue: sum(o.total_cents),
    orders: count(o.id)
  },
  order_by: fragment("date_trunc('day', ?)", o.inserted_at)
)
|> Repo.all()`,
    },
    {
      title: "Whole raw statements",
      note: "Perfect for reports where schemas add nothing.",
      code: `alias Shop.Repo

sql = """
SELECT
  date_trunc('day', o.inserted_at) AS day,
  count(*)                          AS orders,
  sum(o.total_cents)                AS revenue_cents,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY o.total_cents) AS median
FROM orders o
WHERE o.user_id = $1
  AND o.inserted_at >= $2
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30
"""

%Postgrex.Result{columns: cols, rows: rows} =
  Repo.query!(sql, [1, DateTime.add(DateTime.utc_now(), -30, :day)])

Enum.map(rows, fn row -> cols |> Enum.zip(row) |> Map.new() end)`,
    },
    {
      title: "Load raw rows into schemas",
      note: "When you do want structs back.",
      code: `alias Shop.Repo
alias Shop.Orders.Order

%Postgrex.Result{columns: cols, rows: rows} =
  Repo.query!("SELECT id, user_id, status, total_cents, currency, metadata, tags, placed_at, inserted_at, updated_at FROM orders LIMIT 5")

Enum.map(rows, fn row -> Repo.load(Order, {cols, row}) end)`,
    },
    {
      title: "Full-text search, end to end",
      note: "Migration + query. A real feature in ~15 lines.",
      code: `# migration:
# execute "CREATE INDEX products_search_idx ON products
#          USING GIN (to_tsvector('english', name || ' ' || description))",
#         "DROP INDEX products_search_idx"

import Ecto.Query

def search(term) do
  from(p in "products",
    where: fragment(
      "to_tsvector('english', ? || ' ' || ?) @@ plainto_tsquery('english', ?)",
      p.name, p.description, ^term
    ),
    order_by: [
      desc: fragment(
        "ts_rank(to_tsvector('english', ? || ' ' || ?), plainto_tsquery('english', ?))",
        p.name, p.description, ^term
      )
    ],
    select: %{id: p.id, name: p.name},
    limit: 20
  )
  |> Shop.Repo.all()
end`,
    },
  ],
};
