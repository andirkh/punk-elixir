export default {
  front:
    "You want every column of a 60-column table except two, with one of them rounded. In standard SQL that is 59 lines of typing. What does DuckDB give you?",
  back: "`SELECT * EXCLUDE (a, b) REPLACE (round(price, 2) AS price)`. DuckDB deliberately fixes SQL's ergonomic sharp edges: `EXCLUDE`/`REPLACE`/`COLUMNS(...)` for projections, trailing commas, `GROUP BY ALL`, `ORDER BY ALL`, `FILTER` on aggregates, list and struct types, `UNION BY NAME`, and reusable column aliases within the same SELECT.",
  philosophy: {
    lead: "DuckDB treats SQL's decades of accumulated friction as a design problem rather than a tradition to preserve.",
    body: [
      "The most useful of these is `GROUP BY ALL`. In standard SQL every non-aggregated SELECT column must be repeated in GROUP BY, which means a five-dimension query lists those five expressions twice, and adding a dimension means editing two places — a genuine source of bugs when someone edits one and not the other. `GROUP BY ALL` says 'group by everything that is not an aggregate', which is what you meant every time.",
      "Reusable aliases are the second quiet win. Standard SQL will not let you use a SELECT alias later in the same SELECT list, so you repeat the expression or wrap it in a subquery. DuckDB lets `SELECT a + b AS total, total * 0.2 AS tax` work, which turns a nested query into a readable sequence of steps.",
      "The nested types matter more than they look. `LIST` and `STRUCT` let one row hold an array or a record, so `list(sku ORDER BY qty DESC)` collects a group's values without a string hack, and `unnest` explodes them back into rows. That gives you array_agg-style aggregation, JSON-shaped output, and a clean way to move data to and from Elixir maps and lists.",
      "Two cautions. These extensions are not portable — a query using EXCLUDE or QUALIFY will not run on Postgres, so keep engine-specific syntax in your analytics layer and out of anything you might have to move. And `SELECT *` is still expensive in a column store even with EXCLUDE; name what you need when the table is wide.",
    ],
    diagram: `flowchart TB
  proj["PROJECTION<br/>SELECT * EXCLUDE (payload, internal_id)      drop columns<br/>SELECT * REPLACE (round(price,2) AS price)   transform in place<br/>SELECT COLUMNS('^amount_.*') FROM t          regex column selection<br/>SELECT max(COLUMNS(*)) FROM t                apply a function to all"]:::code
  proj --> grp["GROUPING<br/>GROUP BY ALL — group by every non-aggregate in the SELECT list ✓<br/>ORDER BY ALL — order by every column, left to right<br/>⇒ add a dimension in ONE place instead of two"]:::ok
  grp --> filt["AGGREGATE FILTER — cleaner than CASE WHEN (card 62)<br/>count(*) FILTER (WHERE kind = 'purchase')  AS purchases<br/>sum(amount) FILTER (WHERE country = 'GB')  AS gb_cents"]:::ok
  filt --> alias["ALIASES ARE REUSABLE IN THE SAME SELECT<br/>SELECT amount * qty AS gross,    ← standard SQL forbids this<br/>       gross * 0.2  AS tax,<br/>       gross + tax  AS total<br/>FROM items"]:::ok
  alias --> nested["NESTED TYPES — a row can hold a list or a record<br/>list(sku ORDER BY qty DESC)         ⇒ ['DESK-3','BOOK-1']<br/>struct_pack(sku := sku, qty := qty) ⇒ {'sku': …, 'qty': …}<br/>unnest(list_col)                    ⇒ explode back into rows<br/>histogram(amount_cents)             ⇒ a map of value → count"]:::code
  nested --> edges["OTHER SHARP EDGES REMOVED<br/>trailing commas allowed · FROM t SELECT … — FROM first<br/>UNION BY NAME — match columns by NAME, not position<br/>USING SAMPLE 1% · asof joins · PIVOT / UNPIVOT"]:::hot
  edges --> port["⚠ none of this is portable. Keep it in the analytics layer."]:::bad`,
    takeaway:
      "EXCLUDE/REPLACE, GROUP BY ALL, FILTER and reusable aliases remove real friction — at the cost of portability.",
  },
  codeSamples: [
    {
      title: "Projection shorthands",
      note: "",
      code: `-- every column except the fat one
SELECT * EXCLUDE (payload) FROM events LIMIT 5;

-- transform a column in place, keep the rest
SELECT * EXCLUDE (payload) REPLACE (amount_cents / 100.0 AS amount_cents)
FROM events LIMIT 5;

-- pick columns by regex
SELECT COLUMNS('.*_cents$') FROM events LIMIT 5;

-- apply an aggregate to every numeric column at once
SELECT max(COLUMNS(['id','user_id','amount_cents'])) FROM events;

-- describe before you select
DESCRIBE events;
SUMMARIZE events;      -- min/max/avg/nulls/approx distinct for every column`,
    },
    {
      title: "GROUP BY ALL, FILTER and reusable aliases",
      note: "The same dashboard as card 74, half the typing.",
      code: `SELECT
  country,
  kind,
  date_trunc('month', created_at)                        AS month,
  count(*)                                               AS events,
  count(DISTINCT user_id)                                AS users,
  sum(amount_cents)                                      AS gross_cents,
  sum(amount_cents) FILTER (WHERE amount_cents > 10000)  AS big_ticket_cents,
  count(*) FILTER (WHERE kind = 'purchase')              AS purchases,
  gross_cents / 100.0                                    AS gross_dollars,
  round(gross_dollars / nullif(users, 0), 2)             AS dollars_per_user
FROM events
GROUP BY ALL                    -- country, kind, month — inferred ✓
ORDER BY month, country, kind
LIMIT 20;`,
    },
    {
      title: "Lists and structs — group values without string hacks",
      note: "These map cleanly onto Elixir lists and maps.",
      code: `-- collect a group's values into a real list
SELECT
  country,
  count(*)                                          AS n,
  list(DISTINCT kind)                               AS kinds,
  list(amount_cents ORDER BY amount_cents DESC)[1:3] AS top3_amounts,
  histogram(kind)                                   AS kind_counts
FROM events
GROUP BY country;

-- structs: a record per row
SELECT
  user_id,
  struct_pack(
    total := sum(amount_cents),
    events := count(*),
    first := min(created_at)
  ) AS summary
FROM events GROUP BY user_id LIMIT 5;

-- explode a list back into rows
SELECT unnest(['a','b','c']) AS letter;

WITH per_country AS (
  SELECT country, list(DISTINCT kind) AS kinds FROM events GROUP BY country
)
SELECT country, unnest(kinds) AS kind FROM per_country;`,
    },
    {
      title: "PIVOT, sampling and asof joins",
      note: "Three more tools you will reach for.",
      code: `-- PIVOT: rows to columns, no CASE WHEN
PIVOT events ON kind USING sum(amount_cents) GROUP BY country;

-- UNPIVOT: columns back to rows
CREATE OR REPLACE TABLE wide AS
  PIVOT events ON kind USING sum(amount_cents) GROUP BY country;
UNPIVOT wide ON COLUMNS(* EXCLUDE (country)) INTO NAME kind VALUE cents;

-- sample instead of scanning, for exploration
SELECT country, count(*) FROM events USING SAMPLE 1% GROUP BY country;
SELECT * FROM events USING SAMPLE 10 ROWS;

-- ASOF JOIN: match each row to the most recent prior row in another table
CREATE OR REPLACE TABLE prices AS SELECT * FROM (VALUES
  (DATE '2025-01-01', 100), (DATE '2025-02-01', 120), (DATE '2025-03-01', 90)
) t(effective_from, price_cents);

SELECT e.id, e.created_at, p.effective_from, p.price_cents
FROM events e
ASOF JOIN prices p ON e.created_at >= p.effective_from
LIMIT 10;
-- exactly the "price in effect at the time" join, without a correlated subquery`,
    },
  ],
};
