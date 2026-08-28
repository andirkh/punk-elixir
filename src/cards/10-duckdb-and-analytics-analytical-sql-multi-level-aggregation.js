export default {
  front:
    "A dashboard needs revenue by country, by country+month, by month alone, and a grand total. That is four GROUP BY queries and four scans. How do you do it in one?",
  back: "`GROUPING SETS` — and its shorthands `ROLLUP` (hierarchical: totals at each level) and `CUBE` (every combination). One scan produces every aggregation level, with NULL marking 'this level is aggregated away'. Use the `GROUPING()` function to tell a real NULL from a subtotal marker. This is the core technique of analytical SQL and works in DuckDB and Postgres alike.",
  philosophy: {
    lead: "Analytical queries are usually the same aggregate at several levels of detail — and SQL can compute them all in one pass.",
    body: [
      "The naive approach runs one query per level and UNIONs them, scanning the data four times. GROUPING SETS tells the engine your intent, so it builds all the hash tables in a single pass over the input. On five million rows the difference is one scan versus four, and the code goes from forty lines of UNION ALL to one clause.",
      "ROLLUP is the right shorthand for hierarchies you drill down: `ROLLUP(country, month, day)` gives you day detail, month subtotals, country subtotals and a grand total, which is exactly the shape of a collapsible report. CUBE gives every subset instead, which is what you want when the user can pivot on any dimension in any order — it produces 2^n levels, so use it deliberately.",
      "The NULL ambiguity is the practical trap. A subtotal row has NULL in the columns that were aggregated away — but a real NULL in your data looks identical. `GROUPING(col)` returns 1 when the NULL is a subtotal marker and 0 when it is a real value, so wrap your labels in a CASE on it. Skip this and your report will show a mysterious blank row that users will report as a bug.",
      "Combine this with the conditional aggregation from card 62 and you can build an entire dashboard — every metric, every level — from one query over one scan. That is the practical payoff of an OLAP engine, and it is why analytics people care so much about SQL fluency.",
    ],
    diagram: `flowchart TB
  sets["FOUR QUESTIONS, ONE SCAN<br/>GROUP BY GROUPING SETS ((country, month), (country), (month), ())<br/>                          detail        per country  per month  grand total"]:::hot
  sets --> shapes
  subgraph shapes["the two shorthands"]
    direction LR
    ro["ROLLUP(country, month, day) — hierarchical, n+1 levels<br/>⇒ (country,month,day) · (country,month) · (country) · ()<br/>the shape of a DRILL-DOWN report ✓"]:::ok
    cu["CUBE(country, kind) — every combination, 2ⁿ levels<br/>⇒ (country,kind) · (country) · (kind) · ()<br/>the shape of a PIVOT TABLE"]:::ok
  end
  shapes --> res["RESULT — NULL means 'aggregated away at this level'<br/><br/>country ¦ month ¦ cents  ¦ grouping(month)<br/>GB      ¦ 1     ¦ 120000 ¦ 0   ← detail<br/>GB      ¦ 2     ¦ 138000 ¦ 0<br/>GB      ¦ NULL  ¦ 258000 ¦ 1   ← the subtotal for GB<br/>US      ¦ 1     ¦ 90000  ¦ 0<br/>US      ¦ NULL  ¦ 90000  ¦ 1<br/>NULL    ¦ NULL  ¦ 348000 ¦ 1   ← the grand total"]:::code
  res --> amb["⚠ a REAL NULL in your data looks EXACTLY like a subtotal marker<br/>✓ CASE WHEN GROUPING(month) = 1 THEN 'ALL MONTHS'<br/>       ELSE COALESCE(month::VARCHAR, '(unknown)') END"]:::bad
  amb --> win["naive: 4 queries × 5M rows = 4 scans<br/>sets:  1 query  × 5M rows = 1 scan   ⇒ ~4x faster, and a tenth of the code"]:::ok`,
    takeaway:
      "GROUPING SETS computes every aggregation level in one scan; use GROUPING() to distinguish subtotal NULLs from real ones.",
  },
  codeSamples: [
    {
      title: "The naive version, for contrast",
      note: "Four scans, forty lines. Do not ship this.",
      code: `.timer on

SELECT country, month(created_at) AS m, sum(amount_cents) AS cents
FROM events GROUP BY country, month(created_at)
UNION ALL
SELECT country, NULL, sum(amount_cents) FROM events GROUP BY country
UNION ALL
SELECT NULL, month(created_at), sum(amount_cents) FROM events GROUP BY month(created_at)
UNION ALL
SELECT NULL, NULL, sum(amount_cents) FROM events
ORDER BY country NULLS LAST, m NULLS LAST;`,
    },
    {
      title: "GROUPING SETS — one scan",
      note: "Same answer, one pass.",
      code: `.timer on

SELECT
  country,
  month(created_at) AS m,
  count(*)          AS n,
  sum(amount_cents) AS cents
FROM events
GROUP BY GROUPING SETS ((country, month(created_at)), (country), (month(created_at)), ())
ORDER BY country NULLS LAST, m NULLS LAST;`,
    },
    {
      title: "ROLLUP, CUBE and readable labels",
      note: "GROUPING() removes the NULL ambiguity.",
      code: `-- hierarchical drill-down
SELECT
  CASE WHEN GROUPING(country) = 1 THEN 'ALL COUNTRIES' ELSE country END AS country,
  CASE WHEN GROUPING(kind)    = 1 THEN 'ALL KINDS'     ELSE kind    END AS kind,
  count(*)          AS n,
  sum(amount_cents) AS cents,
  GROUPING(country) + GROUPING(kind) AS level      -- 0 = detail, 2 = grand total
FROM events
GROUP BY ROLLUP (country, kind)
ORDER BY level, country, kind;

-- every combination (a pivot table)
SELECT
  COALESCE(country, 'ALL') AS country,
  COALESCE(kind, 'ALL')    AS kind,
  sum(amount_cents)        AS cents
FROM events
GROUP BY CUBE (country, kind)
ORDER BY country, kind;`,
    },
    {
      title: "A whole dashboard in one query",
      note: "Multi-level + conditional aggregation (card 62).",
      code: `SELECT
  CASE WHEN GROUPING(country) = 1 THEN 'ALL' ELSE country END       AS country,
  CASE WHEN GROUPING(m) = 1 THEN 'ALL' ELSE m::VARCHAR END          AS month,
  count(*)                                                          AS events,
  count(DISTINCT user_id)                                           AS users,
  sum(amount_cents)                                                 AS gross_cents,
  sum(CASE WHEN kind = 'purchase' THEN amount_cents ELSE 0 END)     AS purchase_cents,
  round(100.0 * sum(CASE WHEN kind = 'purchase' THEN 1 ELSE 0 END)
        / nullif(count(*), 0), 2)                                   AS purchase_rate,
  round(avg(amount_cents), 0)                                       AS avg_cents,
  max(amount_cents)                                                 AS max_cents
FROM (SELECT *, month(created_at) AS m FROM events)
GROUP BY ROLLUP (country, m)
ORDER BY GROUPING(country), country, GROUPING(m), month;

-- from Elixir:
-- Shop.Analytics.query(sql) |> then(fn {:ok, rows} -> rows end)`,
    },
  ],
};
