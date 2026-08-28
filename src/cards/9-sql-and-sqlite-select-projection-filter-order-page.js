export default {
  front:
    "`SELECT *` works and is shorter. Name three concrete reasons it is a bad habit in application code.",
  back: "(1) It moves bytes you never use — the fat `payload` column crosses the wire on every row. (2) It breaks silently when the schema changes: a new column appears in your result, a dropped one vanishes, and positional code shifts. (3) It defeats **covering indexes**, because the engine must visit the table instead of answering from the index alone. Name your columns; the extra typing buys stability and speed.",
  philosophy: {
    lead: "SELECT is projection — choosing columns — and being deliberate about it is one of the cheapest performance wins in any system.",
    body: [
      "The clauses divide the work cleanly. WHERE filters rows before grouping, using comparison operators, `BETWEEN`, `IN`, `LIKE`, `IS NULL` and boolean connectives. ORDER BY imposes an order that otherwise does not exist — and this is worth saying plainly: **without ORDER BY, row order is undefined**. It may look stable in testing and change the day an index is added or the planner picks a different path. If order matters, say so.",
      "LIMIT/OFFSET is how most people paginate, and it is fine for page one. It degrades badly at depth because OFFSET 100000 makes the engine produce and discard 100,000 rows, and it can skip or duplicate rows when data changes between pages. Keyset pagination — remember the last row you saw and filter for rows after it — is O(log n) at any depth and stable under concurrent writes. Learn it now; card 87 applies the same idea in Ecto.",
      "Two smaller things that repay learning: `CASE` gives you branching inside a query, which is how you bucket, pivot and conditionally aggregate without leaving SQL; and string/date functions let you shape output at the database rather than in Elixir, which is usually cheaper because it happens once per row in C rather than once per row in a mapped list.",
      "Finally, `DISTINCT` is often a smell. When it appears because a JOIN duplicated your rows, you have not deduplicated a result — you have hidden a modelling mistake, and you paid for a sort to do it. Card 61 explains where those duplicates come from.",
    ],
    diagram: `flowchart TB
  shape["SELECT   &lt;projection&gt;   ← WHICH COLUMNS. Name them.<br/>FROM     &lt;source&gt;<br/>WHERE    &lt;row filter&gt;   ← runs BEFORE grouping · no aggregates here<br/>ORDER BY &lt;sort&gt;         ← without this, row order is UNDEFINED<br/>LIMIT n OFFSET m        ← see the pagination trap"]:::code
  shape --> vocab["FILTER VOCABULARY<br/>=  &lt;&gt;  &lt;  &gt;  &lt;=  &gt;=          age BETWEEN 18 AND 65<br/>IN ('paid','shipped') · NOT IN (…)   ⚠ NULL-hostile — card 60<br/>LIKE 'ada%'   % is any run, _ is one character<br/>IS NULL / IS NOT NULL   ⚠ never write = NULL<br/>AND / OR / NOT — parenthesise OR, precedence bites"]:::hot
  vocab --> page
  subgraph page["PAGINATION"]
    direction LR
    off["OFFSET<br/>LIMIT 20 OFFSET 100000<br/>⇒ builds and throws away 100k rows<br/>⇒ O(n), slower every page<br/>⇒ skips or duplicates if rows change"]:::bad
    key["KEYSET — a cursor<br/>WHERE (placed_at, id) &lt; (?, ?)<br/>ORDER BY placed_at DESC, id DESC<br/>LIMIT 20<br/>⇒ O(log n), stable ✓"]:::ok
  end
  page --> warns["⚠ SELECT * moves unused bytes, breaks on schema change,<br/>and defeats covering indexes — card 65<br/>⚠ DISTINCT usually means 'my JOIN duplicated rows'. Fix the join instead."]:::warn`,
    takeaway:
      "Name your columns, always ORDER BY when order matters, and paginate by keyset once the table is big.",
  },
  codeSamples: [
    {
      title: "Filtering vocabulary",
      note: "",
      code: `SELECT id, name, country FROM users WHERE country = 'GB';
SELECT id, name FROM users WHERE country IN ('GB','JP');
SELECT id, name FROM users WHERE name LIKE 'A%';
SELECT id, total_cents FROM orders WHERE total_cents BETWEEN 1000 AND 5000;
SELECT id FROM orders WHERE status <> 'pending';
SELECT id FROM orders WHERE placed_at >= date('now','-30 days');

-- precedence: these are DIFFERENT queries
SELECT * FROM orders WHERE status='paid' AND total_cents>1000 OR user_id=3;
SELECT * FROM orders WHERE status='paid' AND (total_cents>1000 OR user_id=3);`,
    },
    {
      title: "CASE — branching inside SQL",
      note: "Bucketing and conditional aggregation.",
      code: `SELECT
  id,
  total_cents,
  CASE
    WHEN total_cents >= 5000 THEN 'large'
    WHEN total_cents >= 1000 THEN 'medium'
    ELSE 'small'
  END AS bucket
FROM orders
ORDER BY total_cents DESC;

-- conditional aggregation: a pivot without a pivot feature
SELECT
  user_id,
  count(*)                                                   AS orders,
  sum(CASE WHEN status = 'paid'     THEN 1 ELSE 0 END)       AS paid,
  sum(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END)       AS pending,
  sum(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END) AS paid_cents
FROM orders
GROUP BY user_id;`,
    },
    {
      title: "Both paginations, measured",
      note: "Run against the 200k events table from card 55.",
      code: `.timer on

-- page 1: both are fast
SELECT id, kind, created_at FROM events ORDER BY id LIMIT 20 OFFSET 0;

-- page 5000 with OFFSET: builds and discards 100k rows
SELECT id, kind, created_at FROM events ORDER BY id LIMIT 20 OFFSET 100000;

-- the same page by keyset: jumps straight there
SELECT id, kind, created_at FROM events WHERE id > 100000 ORDER BY id LIMIT 20;

-- keyset on a non-unique sort key needs a tiebreaker column:
SELECT id, created_at FROM events
WHERE (created_at, id) < ('2026-01-01 00:00:00', 999999999)
ORDER BY created_at DESC, id DESC
LIMIT 20;`,
    },
    {
      title: "Keyset pagination from Elixir",
      note: "The cursor is just the last row you saw.",
      code: `defmodule SqlLab.Page do
  @sql """
  SELECT id, kind, amount_cents, created_at
  FROM events
  WHERE (?1 IS NULL) OR (created_at, id) < (?1, ?2)
  ORDER BY created_at DESC, id DESC
  LIMIT ?3
  """

  def page(conn, cursor \\\\ nil, limit \\\\ 20) do
    {at, id} = cursor || {nil, nil}
    rows = SqlLab.DB.query(conn, @sql, [at, id, limit + 1])
    {items, rest} = Enum.split(rows, limit)
    last = List.last(items)

    %{
      items: items,
      has_more?: rest != [],
      next_cursor: last && {last["created_at"], last["id"]}
    }
  end
end

conn = SqlLab.DB.open()
p1 = SqlLab.Page.page(conn)
p2 = SqlLab.Page.page(conn, p1.next_cursor)`,
    },
  ],
};
