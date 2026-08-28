export default {
  front:
    "Name the one SQL mistake that has cost the industry the most money, and the one line of code that prevents it.",
  back: "**SQL injection** — building a query by concatenating user input into a string. The fix is one rule: never interpolate; always bind parameters (`?` in SQLite, `$1` in Postgres, `^value` in Ecto). The database then receives the query structure and the data separately, so no input can ever become syntax. Every other trap in this card is a variation on 'the query ran successfully and did the wrong thing'.",
  philosophy: {
    lead: "SQL's danger is not that it errors. It is that so many mistakes succeed, quickly, and return a plausible answer.",
    body: [
      "Injection is first because it is total. A single concatenated string can leak your users table, drop your database, or — via a UNION — turn a search endpoint into a data export. And it is entirely preventable by a mechanical rule with no judgement required: user data goes in a bind parameter, never in the SQL text. Note carefully what parameters cannot do: they bind *values*, not identifiers. A dynamic table or column name must be validated against an allowlist you wrote.",
      "The second family is destructive: missing WHERE (card 58), and its cousin — a WHERE whose condition is accidentally always true, usually via an OR. `WHERE user_id = ? OR 1=1` is the injected form; `WHERE status='a' OR status='b' AND user_id=?` is the honest-mistake form, where AND binds tighter than OR and the first branch matches every row. Parenthesise your ORs.",
      "The third family is silently-wrong results: join fan-out multiplying sums (card 61), `NOT IN` with NULL returning nothing (card 60), aggregates skipping NULLs, and integer division truncating (`1/2 = 0`). These produce numbers, not errors, so they end up on dashboards and in invoices.",
      "The fourth is operational: unbounded queries that return ten million rows into your BEAM process's memory, `SELECT *` in a hot path, deep OFFSET pagination, DDL that locks a table during a deploy, and long transactions that hold a connection while waiting on an HTTP call. None of these are bugs in the SQL; they are bugs in how it meets a running system.",
    ],
    diagram: `flowchart TB
  subgraph inj["⚠ 1. INJECTION — the only one that is a SECURITY hole"]
    direction TB
    i1["✗ 'SELECT * FROM users WHERE email = ' &lt;&gt; email<br/>email = x' OR '1'='1        ⇒ returns every user<br/>email = x'; DROP TABLE users; --<br/>email = x' UNION SELECT password_hash,1,1,1 FROM users --"]:::bad
    i2["✓ query(conn, 'SELECT * FROM users WHERE email = ?', [email])<br/>structure and data travel SEPARATELY. Input can never become syntax."]:::ok
    i3["⚠ parameters bind VALUES, not identifiers<br/>'SELECT * FROM ' &lt;&gt; table   ← still injectable ⇒ allowlist it yourself"]:::warn
    i1 --> i2 --> i3
  end
  i3 --> des["⚠ 2. DESTRUCTIVE<br/>DELETE FROM orders            no WHERE = every row — card 58<br/>UPDATE users SET admin = 1    instant, no undo<br/>WHERE a = ? OR 1 = 1          a condition that is always true<br/>WHERE s='a' OR s='b' AND uid=?   AND binds TIGHTER than OR<br/>                                 ⇒ every row where s='a'<br/>✓ parenthesise: WHERE (s='a' OR s='b') AND uid=?"]:::bad
  des --> wrong["⚠ 3. SILENTLY WRONG — a number, not an error<br/>sum() across a one-to-many join → inflated totals — card 61<br/>NOT IN (… NULL …)               → zero rows — card 60<br/>sum() of no rows                → NULL, not 0<br/>SELECT 1/2                      → 0, integer division<br/>ORDER BY omitted                → the order is undefined<br/>LIKE 'a%' vs '%a'               → one uses the index, one cannot"]:::warn
  wrong --> ops["⚠ 4. OPERATIONAL<br/>SELECT * FROM events            10M rows into your BEAM heap 💥<br/>LIMIT 20 OFFSET 500000          builds and discards 500k rows<br/>long transaction + HTTP call    holds a pool connection — card 79<br/>DDL during deploy               locks the table under live traffic<br/>no statement timeout            one bad query saturates the pool"]:::warn
  ops --> five["THE FIVE RULES<br/>1. bind every value, allowlist every identifier<br/>2. write WHERE before the verb · BEGIN before you experiment<br/>3. LIMIT every exploratory query<br/>4. read EXPLAIN before shipping a query on a big table<br/>5. aggregate the many-side separately when joining one-to-many"]:::ok`,
    takeaway:
      "Bind values, parenthesise ORs, LIMIT everything exploratory, and remember most SQL bugs succeed instead of failing.",
  },
  codeSamples: [
    {
      title: "Watch injection work",
      note: "Safe to run locally on the practice database. This is why the rule exists.",
      code: `-- imagine your code does:  "SELECT * FROM users WHERE email = '" <> input <> "'"

-- normal input
SELECT * FROM users WHERE email = 'ada@x.dev';

-- input:  x' OR '1'='1
SELECT * FROM users WHERE email = 'x' OR '1'='1';
-- every user 😱

-- input:  x' UNION SELECT id, email, name, country, created_at FROM users --
SELECT id, email, name, country, created_at FROM users WHERE email = 'x'
UNION SELECT id, email, name, country, created_at FROM users;
-- an arbitrary table exfiltrated through a search box

-- input:  x'; DROP TABLE order_items; --
-- one statement becomes two.`,
    },
    {
      title: "The safe version, and the identifier caveat",
      note: "",
      code: `conn = SqlLab.DB.open()

email = "x' OR '1'='1"

# ✓ bound: the whole string is treated as one value, matches nothing
SqlLab.DB.query(conn, "SELECT * FROM users WHERE email = ?", [email])
# []

# ✗ NEVER, under any deadline:
# SqlLab.DB.query(conn, "SELECT * FROM users WHERE email = '#{email}'")

# ⚠ parameters cannot bind identifiers. Allowlist them yourself:
defmodule SqlLab.Sort do
  @allowed %{"date" => "placed_at", "total" => "total_cents", "id" => "id"}
  @dirs %{"asc" => "ASC", "desc" => "DESC"}

  def order_by(col, dir) do
    column = Map.get(@allowed, col, "id")          # never the raw input
    direction = Map.get(@dirs, dir, "DESC")
    "ORDER BY " <> column <> " " <> direction
  end
end

SqlLab.Sort.order_by("total", "asc")
SqlLab.Sort.order_by("; DROP TABLE users --", "asc")   # "ORDER BY id DESC" ✓`,
    },
    {
      title: "Silently wrong answers",
      note: "Every one of these runs without error.",
      code: `-- integer division truncates
SELECT 1/2 AS int_div, 1.0/2 AS real_div, CAST(1 AS REAL)/2 AS cast_div;

-- operator precedence: AND binds tighter than OR
SELECT count(*) FROM orders WHERE status='paid' OR status='pending' AND user_id=99;
SELECT count(*) FROM orders WHERE (status='paid' OR status='pending') AND user_id=99;
-- different numbers, both "valid"

-- fan-out inflation (card 61)
SELECT sum(o.total_cents) AS inflated FROM orders o JOIN order_items i ON i.order_id=o.id;
SELECT sum(total_cents)   AS correct  FROM orders;

-- empty aggregate is NULL, not 0
SELECT sum(total_cents) AS null_total FROM orders WHERE status='nope';
SELECT COALESCE(sum(total_cents),0) AS zero_total FROM orders WHERE status='nope';

-- no ORDER BY: this order is not guaranteed, even if it looks stable
SELECT id FROM orders LIMIT 3;`,
    },
    {
      title: "Operational guardrails",
      note: "Wrap the database so the dangerous thing is hard to do.",
      code: `defmodule SqlLab.Safe do
  @max_rows 10_000

  @doc "Refuses unbounded exploratory queries and caps the result size."
  def query(conn, sql, params \\\\ []) do
    unless String.match?(sql, ~r/\\blimit\\b/i) do
      raise ArgumentError, "every ad-hoc query needs a LIMIT: #{sql}"
    end

    rows = SqlLab.DB.query(conn, sql, params)

    if length(rows) > @max_rows do
      raise "query returned #{length(rows)} rows (max #{@max_rows}) — stream it instead"
    end

    rows
  end

  @doc "Stream a big result instead of loading it into the heap."
  def stream(conn, sql, params \\\\ [], batch \\\\ 1_000) do
    Stream.resource(
      fn ->
        {:ok, stmt} = Exqlite.Sqlite3.prepare(conn, sql)
        :ok = Exqlite.Sqlite3.bind(stmt, params)
        stmt
      end,
      fn stmt ->
        case Exqlite.Sqlite3.multi_step(conn, stmt, batch) do
          {:rows, rows} -> {rows, stmt}
          {:done, rows} -> {rows, :halt}
          :done -> {:halt, stmt}
        end
      end,
      fn
        :halt -> :ok
        stmt -> Exqlite.Sqlite3.release(conn, stmt)
      end
    )
  end
end

conn = SqlLab.DB.open()
SqlLab.Safe.query(conn, "SELECT id, kind FROM events LIMIT 5")
# SqlLab.Safe.query(conn, "SELECT * FROM events")   # raises ✓

SqlLab.Safe.stream(conn, "SELECT id FROM events") |> Stream.take(5) |> Enum.to_list()`,
    },
  ],
};
