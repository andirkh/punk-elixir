export default {
  front:
    "`SELECT country, name, count(*) FROM users GROUP BY country` runs fine in SQLite and is rejected by Postgres. Which is right, and what is `name` here?",
  back: "Postgres is right. Once you GROUP BY country, each result row IS a whole country — and a country has many names, so `name` is ambiguous. Postgres rejects the query; SQLite silently picks an arbitrary row's name. Every column in SELECT must either appear in GROUP BY or be wrapped in an aggregate. WHERE filters rows before grouping; **HAVING** filters groups after.",
  philosophy: {
    lead: "GROUP BY collapses many rows into one, and every column you select must survive that collapse.",
    body: [
      "Picture it physically: the engine sorts or hashes rows into buckets by the grouping key, then produces exactly one output row per bucket. A column that is constant within a bucket (the grouping key itself) can be shown directly. Anything else has many values, so you must say which one you want — `count`, `sum`, `min`, `max`, `avg`, `group_concat`. SQLite's tolerance here is a bug-compatibility quirk, not a feature; write queries that would pass in Postgres so they still work in module 11.",
      "HAVING exists because of the execution order from card 54. WHERE runs before grouping and therefore cannot see an aggregate; HAVING runs after and therefore can. The practical rule: filter individual rows in WHERE (it is cheaper, fewer rows to group) and filter computed group values in HAVING.",
      "The other thing worth internalising is what aggregates do with absent data. They skip NULLs, and `sum` of an empty set is NULL rather than 0 — which is how dashboards end up displaying blank instead of zero. Wrap totals in COALESCE at the edge. And `count(*)` versus `count(col)` versus `count(DISTINCT col)` are three different questions; pick deliberately.",
      "Conditional aggregation is the technique that makes SQL feel powerful: `sum(CASE WHEN status='paid' THEN total_cents ELSE 0 END)` computes a filtered total inside a single pass, so one query can produce a whole dashboard row instead of five separate queries. This is the beginning of analytical SQL, and module 10 takes it much further.",
    ],
    diagram: `flowchart TB
  subgraph buck["GROUP BY country — many rows collapse into ONE row per bucket"]
    direction LR
    rows["GB Ada<br/>GB Alan<br/>US Grace<br/>JP Kaz"]:::code --> res["country ¦ users ¦ names<br/>GB      ¦ 2     ¦ Ada,Alan<br/>US      ¦ 1     ¦ Grace<br/>JP      ¦ 1     ¦ Kaz"]:::ok
  end
  buck --> amb["'name' alone is AMBIGUOUS in bucket GB — Ada or Alan?<br/>⇒ you must aggregate it"]:::warn
  amb --> rule["THE RULE<br/>every SELECT column ∈ GROUP BY ∪ {aggregate expressions}<br/>⚠ SQLite silently allows a bare column and picks one arbitrarily.<br/>Postgres rejects it. Write Postgres-valid SQL from day one."]:::bad
  rule --> exec
  subgraph exec["WHERE vs HAVING — decided by the execution order"]
    direction TB
    e1["FROM"]:::muted --> e2["WHERE<br/>filters ROWS<br/>cheaper — do as much here as possible"]:::ok --> e3["GROUP BY"]:::muted --> e4["HAVING<br/>filters GROUPS<br/>can see aggregates"]:::ok --> e5["SELECT"]:::muted --> e6["ORDER BY"]:::muted
  end
  exec --> aggs["AGGREGATES<br/>count(*) — every row, NULLs included<br/>count(col) — non-NULL values only<br/>count(DISTINCT col) — unique non-NULL values<br/>sum / avg / min / max — skip NULLs · sum of nothing is NULL, not 0 ⚠<br/>group_concat(col, ', ') — string_agg in Postgres"]:::code
  aggs --> cond["CONDITIONAL AGGREGATION — a whole dashboard row in one pass<br/>sum(CASE WHEN status='paid' THEN total_cents ELSE 0 END) AS paid_cents"]:::hot`,
    takeaway:
      "One output row per group; every column must be grouped or aggregated. WHERE filters rows, HAVING filters groups.",
  },
  codeSamples: [
    {
      title: "The basic shapes",
      note: "",
      code: `SELECT country, count(*) AS users FROM users GROUP BY country ORDER BY users DESC;

SELECT status, count(*) AS n, sum(total_cents) AS cents, avg(total_cents) AS mean
FROM orders GROUP BY status;

SELECT country, group_concat(name, ', ') AS people
FROM users GROUP BY country;

-- three different counts
SELECT
  count(*)                  AS rows_,
  count(status)             AS non_null_status,
  count(DISTINCT status)    AS distinct_statuses,
  count(DISTINCT user_id)   AS customers
FROM orders;`,
    },
    {
      title: "WHERE vs HAVING",
      note: "Both filter; they filter different things.",
      code: `-- filter rows first (cheap), then group
SELECT user_id, sum(total_cents) AS cents
FROM orders
WHERE status = 'paid'                -- rows
GROUP BY user_id;

-- filter the computed groups
SELECT user_id, sum(total_cents) AS cents
FROM orders
WHERE status = 'paid'                -- rows
GROUP BY user_id
HAVING sum(total_cents) > 2000       -- groups ✓
ORDER BY cents DESC;

-- this fails: WHERE cannot see an aggregate
-- SELECT user_id, sum(total_cents) FROM orders
-- WHERE sum(total_cents) > 2000 GROUP BY user_id;
-- Error: misuse of aggregate function sum()`,
    },
    {
      title: "The ambiguous-column trap",
      note: "Runs in SQLite, rejected by Postgres. Do not write it.",
      code: `-- ✗ 'name' is arbitrary — SQLite picks one silently
SELECT country, name, count(*) FROM users GROUP BY country;

-- ✓ say which name you mean
SELECT country, min(name) AS first_alphabetically, count(*) AS n
FROM users GROUP BY country;

-- ✓ or keep them all
SELECT country, group_concat(name, ', ') AS names, count(*) AS n
FROM users GROUP BY country;

-- ✓ or group by both (a different question!)
SELECT country, name, count(*) FROM users GROUP BY country, name;`,
    },
    {
      title: "A dashboard in one query",
      note: "Conditional aggregation — five metrics, one scan.",
      code: `SELECT
  u.country,
  count(DISTINCT u.id)                                        AS customers,
  count(o.id)                                                 AS orders,
  COALESCE(sum(o.total_cents), 0)                             AS gross_cents,
  COALESCE(sum(CASE WHEN o.status='paid'     THEN o.total_cents END), 0) AS paid_cents,
  COALESCE(sum(CASE WHEN o.status='refunded' THEN o.total_cents END), 0) AS refunded_cents,
  round(100.0 * sum(CASE WHEN o.status='paid' THEN 1 ELSE 0 END)
        / NULLIF(count(o.id), 0), 1)                          AS paid_pct
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.country
ORDER BY paid_cents DESC;`,
    },
  ],
};
