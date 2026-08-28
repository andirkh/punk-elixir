export default {
  front:
    "Card 64 taught windows. What does an OLAP engine add — and how do you filter on a window function without a wrapper subquery?",
  back: "`QUALIFY`. It filters on window functions the way HAVING filters on aggregates, removing the CTE-then-filter ceremony entirely. DuckDB also adds precise **frame** control (`ROWS`, `RANGE` and `GROUPS` with `INTERVAL` bounds for real time windows), `time_bucket` for gapless series, and `LIST`/`histogram` aggregates — the vocabulary of time-series analysis.",
  philosophy: {
    lead: "Window frames are where analytical SQL gets its precision: exactly which neighbouring rows count towards this row's answer.",
    body: [
      "The distinction between `ROWS` and `RANGE` is the one to get right. `ROWS BETWEEN 6 PRECEDING AND CURRENT ROW` counts seven physical rows — which is a true seven-day moving average only if you have exactly one row per day. `RANGE BETWEEN INTERVAL 6 DAYS PRECEDING AND CURRENT ROW` counts by the ORDER BY *value*, so it stays correct when days are missing or duplicated. Real event data always has gaps, so RANGE with an interval is usually what you actually meant.",
      "Gaps are the recurring problem in time series generally. A GROUP BY over event days simply has no row for a day with no events, so your chart draws a line straight through the gap and your moving average silently averages over the wrong window. The fix is to generate a dense spine of dates and LEFT JOIN the data onto it — the recursive CTE from card 63, or `generate_series` in DuckDB, or `time_bucket` which does the bucketing for you.",
      "QUALIFY is a small syntactic thing with a large readability effect. The top-N-per-group pattern from card 64 needed a CTE purely because you cannot put a window function in WHERE. QUALIFY is evaluated after windows, so `QUALIFY row_number() OVER (...) <= 3` says exactly what you mean in one line. It is not standard SQL, but DuckDB, Snowflake and BigQuery all have it.",
      "Put these together and you get the queries that actually appear in product analytics: retention cohorts, funnels, sessionisation by inactivity gap, and rolling metrics. They are all the same three moves — bucket time, window over a partition, filter with QUALIFY.",
    ],
    diagram: `flowchart TB
  frame["THE FRAME — which neighbouring rows count for THIS row<br/>OVER (PARTITION BY x ORDER BY t &lt;frame&gt;)<br/><br/>ROWS   BETWEEN 6 PRECEDING AND CURRENT ROW  ← 7 PHYSICAL rows<br/>RANGE  BETWEEN INTERVAL 6 DAYS PRECEDING<br/>              AND CURRENT ROW               ← 7 days of VALUES ✓<br/>GROUPS BETWEEN 1 PRECEDING AND 1 FOLLOWING  ← peer groups"]:::code
  frame --> gaps
  subgraph gaps["⚠ ROWS vs RANGE on real data WITH GAPS"]
    direction LR
    d0["events on days: 1  2  4  5  8<br/>days 3, 6 and 7 have no events"]:::muted
    d1["ROWS 2 PRECEDING at day 8<br/>⇒ days 4, 5, 8<br/>✗ that spans 5 calendar days"]:::bad
    d2["RANGE INTERVAL 2 DAYS at day 8<br/>⇒ day 8 only<br/>✓ what you actually meant"]:::ok
    d0 --> d1
    d0 --> d2
  end
  gaps --> defaults["DEFAULT FRAMES — memorise these, or be surprised<br/>OVER (ORDER BY t)     ⇒ UNBOUNDED PRECEDING .. CURRENT ROW — a running total<br/>OVER (PARTITION BY x) ⇒ the whole partition — the total on every row"]:::warn
  defaults --> qual
  subgraph qual["QUALIFY — HAVING, but for window functions"]
    direction LR
    q1["standard SQL: compute in a CTE, filter outside<br/>WITH r AS (SELECT *, row_number() OVER (...) rn FROM t)<br/>SELECT * FROM r WHERE rn &lt;= 3"]:::warn
    q2["DuckDB:<br/>SELECT * FROM t<br/>QUALIFY row_number() OVER (PARTITION BY c ORDER BY x DESC) &lt;= 3"]:::ok
  end
  qual --> exec["EXECUTION ORDER, extended<br/>FROM → WHERE → GROUP BY → HAVING → WINDOW → QUALIFY → SELECT → ORDER BY"]:::hot
  exec --> ts["GAPS ARE THE TIME-SERIES BUG<br/>GROUP BY day ⇒ days with no events simply DO NOT EXIST as rows<br/>✓ generate a dense spine and LEFT JOIN onto it<br/>generate_series(DATE '2025-01-01', DATE '2025-12-31', INTERVAL 1 DAY)<br/>time_bucket(INTERVAL 1 DAY, created_at)"]:::ok`,
    takeaway:
      "RANGE with an interval survives gaps; QUALIFY filters windows in place; always build a dense date spine for charts.",
  },
  codeSamples: [
    {
      title: "QUALIFY vs the CTE dance",
      note: "Identical results, one is readable.",
      code: `-- the standard-SQL way (card 64)
WITH ranked AS (
  SELECT country, user_id, sum(amount_cents) AS cents,
         row_number() OVER (PARTITION BY country ORDER BY sum(amount_cents) DESC) AS rn
  FROM events GROUP BY country, user_id
)
SELECT * FROM ranked WHERE rn <= 3 ORDER BY country, rn;

-- the DuckDB way
SELECT country, user_id, sum(amount_cents) AS cents
FROM events
GROUP BY country, user_id
QUALIFY row_number() OVER (PARTITION BY country ORDER BY sum(amount_cents) DESC) <= 3
ORDER BY country, cents DESC;`,
    },
    {
      title: "ROWS vs RANGE on gappy data",
      note: "Build a series with holes and compare the two moving averages.",
      code: `CREATE OR REPLACE TABLE daily AS
SELECT * FROM (VALUES
  (DATE '2026-01-01', 10), (DATE '2026-01-02', 20),
  (DATE '2026-01-05', 30),                                -- 3rd, 4th missing
  (DATE '2026-01-06', 40), (DATE '2026-01-10', 50)        -- 7th–9th missing
) t(d, n);

SELECT
  d, n,
  avg(n) OVER (ORDER BY d ROWS  BETWEEN 2 PRECEDING AND CURRENT ROW)  AS by_rows,
  avg(n) OVER (ORDER BY d RANGE BETWEEN INTERVAL 2 DAYS PRECEDING
                                    AND CURRENT ROW)                  AS by_range
FROM daily ORDER BY d;
-- by_rows averages the last 3 ROWS regardless of how far apart they are
-- by_range averages only what actually happened in the last 3 DAYS ✓`,
    },
    {
      title: "A gapless daily chart",
      note: "Dense spine + LEFT JOIN + rolling average.",
      code: `WITH spine AS (
  SELECT unnest(generate_series(DATE '2025-01-01', DATE '2025-03-31', INTERVAL 1 DAY))::DATE AS d
),
actual AS (
  SELECT created_at::DATE AS d, count(*) AS n, sum(amount_cents) AS cents
  FROM events GROUP BY 1
)
SELECT
  s.d,
  COALESCE(a.n, 0)                                                    AS events,
  COALESCE(a.cents, 0)                                                AS cents,
  round(avg(COALESCE(a.n, 0)) OVER (ORDER BY s.d
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1)                 AS ma7,
  sum(COALESCE(a.cents, 0)) OVER (ORDER BY s.d)                       AS cumulative,
  COALESCE(a.n,0) - lag(COALESCE(a.n,0)) OVER (ORDER BY s.d)          AS delta
FROM spine s
LEFT JOIN actual a ON a.d = s.d
ORDER BY s.d;

-- time_bucket does the bucketing for you (hourly, weekly, 15-minute…)
SELECT time_bucket(INTERVAL 1 WEEK, created_at) AS week, count(*) AS n
FROM events GROUP BY 1 ORDER BY 1;`,
    },
    {
      title: "Retention, funnels and sessions",
      note: "The three queries every product analytics deck needs.",
      code: `-- 1. RETENTION COHORTS: what fraction of each signup-month came back?
WITH first_seen AS (
  SELECT user_id, min(created_at)::DATE AS cohort_day FROM events GROUP BY 1
),
activity AS (
  SELECT e.user_id, f.cohort_day,
         date_diff('day', f.cohort_day, e.created_at::DATE) AS day_offset
  FROM events e JOIN first_seen f USING (user_id)
)
SELECT
  date_trunc('month', cohort_day)                       AS cohort,
  count(DISTINCT user_id)                               AS size,
  count(DISTINCT CASE WHEN day_offset BETWEEN 1 AND 7   THEN user_id END) AS d1_7,
  count(DISTINCT CASE WHEN day_offset BETWEEN 8 AND 30  THEN user_id END) AS d8_30,
  round(100.0 * count(DISTINCT CASE WHEN day_offset BETWEEN 1 AND 7 THEN user_id END)
        / count(DISTINCT user_id), 1)                   AS week1_pct
FROM activity GROUP BY 1 ORDER BY 1;

-- 2. FUNNEL: view -> click -> purchase
SELECT
  count(DISTINCT user_id) FILTER (WHERE kind = 'view')     AS viewed,
  count(DISTINCT user_id) FILTER (WHERE kind = 'click')    AS clicked,
  count(DISTINCT user_id) FILTER (WHERE kind = 'purchase') AS purchased,
  round(100.0 * count(DISTINCT user_id) FILTER (WHERE kind='purchase')
        / nullif(count(DISTINCT user_id) FILTER (WHERE kind='view'), 0), 2) AS conv_pct
FROM events;

-- 3. SESSIONISATION: a new session after 30 minutes of inactivity
WITH gaps AS (
  SELECT user_id, created_at,
         CASE WHEN date_diff('minute',
                lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at),
                created_at) > 30
              OR lag(created_at) OVER (PARTITION BY user_id ORDER BY created_at) IS NULL
              THEN 1 ELSE 0 END AS is_new_session
  FROM events
)
SELECT user_id,
       sum(is_new_session) OVER (PARTITION BY user_id ORDER BY created_at) AS session_no,
       created_at
FROM gaps
ORDER BY user_id, created_at
LIMIT 20;`,
    },
  ],
};
