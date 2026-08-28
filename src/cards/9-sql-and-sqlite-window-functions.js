export default {
  front:
    "You need each order alongside that customer's running total, without collapsing rows into groups. GROUP BY cannot do it. What can?",
  back: "A **window function**: `sum(total_cents) OVER (PARTITION BY user_id ORDER BY placed_at)`. Unlike GROUP BY, a window computes a value across a set of related rows *while keeping every row*. `OVER` defines the window, `PARTITION BY` splits it into independent groups, `ORDER BY` orders rows within each, and a frame clause controls which rows are included. This is the foundation of analytical SQL.",
  philosophy: {
    lead: "GROUP BY collapses. A window function looks sideways at neighbouring rows and keeps yours intact.",
    body: [
      "That distinction unlocks a whole class of questions that are painful otherwise: running totals, rank within a category, difference from the previous row, percent of a group's total, top-N per group, moving averages. Before window functions people solved these with self-joins and correlated subqueries — one pass per row. A window function does it in one pass overall.",
      "Learn the three families. **Ranking**: `row_number` (always unique), `rank` (ties share a number, then it skips), `dense_rank` (ties share, no skip), `ntile` (buckets). **Offset**: `lag` and `lead` reach to previous or next rows, which is how you compute deltas and detect gaps; `first_value`/`last_value` reach to the ends of the frame. **Aggregate-as-window**: any aggregate with an OVER clause becomes cumulative or windowed.",
      "The frame clause is the part people skip and then get wrong. When you write `ORDER BY` inside OVER without a frame, the default frame is `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` — that is what makes it a running total. Omit ORDER BY and the frame is the whole partition, giving a group total repeated on every row. And `RANGE` groups peer rows with equal ORDER BY values together while `ROWS` counts physical rows; for a moving average you almost always want `ROWS`.",
      "Top-N per group is the canonical use and worth memorising: rank inside a partition in a subquery or CTE, then filter on that rank in the outer query. You cannot filter on a window function in WHERE — windows are computed after WHERE — which is why the subquery is required. DuckDB adds `QUALIFY` to remove even that ceremony (card 75).",
    ],
    diagram: `flowchart TB
  subgraph diff["the one distinction that matters"]
    direction LR
    grp["GROUP BY collapses<br/>3 orders ⇒ 1 row"]:::warn
    win["WINDOW keeps every row<br/>3 orders ⇒ 3 rows + a computed column"]:::ok
  end
  diff --> anat["sum(total) OVER (PARTITION BY user_id ORDER BY placed_at)<br/>                  └ split ┘   └ order within ┘   └ frame, implicit ┘"]:::code
  anat --> tbl["user ¦ placed_at ¦ total ¦ running_total ¦ rank ¦ prev<br/>1    ¦ Jan 01    ¦ 2500  ¦ 2500          ¦ 1    ¦ NULL<br/>1    ¦ Jan 05    ¦ 1200  ¦ 3700          ¦ 2    ¦ 2500<br/>2    ¦ Jan 02    ¦ 800   ¦ 800           ¦ 1    ¦ NULL   ← the partition RESETS<br/>2    ¦ Jan 07    ¦ 9900  ¦ 10700         ¦ 2    ¦ 800"]:::code
  tbl --> fam["THREE FAMILIES<br/>RANKING — row_number() 1,2,3,4 always unique<br/>          rank() 1,2,2,4 ties share then SKIP<br/>          dense_rank() 1,2,2,3 ties share, no skip · ntile(4) quartiles<br/>OFFSET  — lag(x,1) lead(x,1) first_value(x) last_value(x)<br/>AGGREGATE — sum/avg/count/min/max … OVER (...)"]:::hot
  fam --> frame["THE FRAME — the part everyone gets wrong<br/>OVER (PARTITION BY u ORDER BY t) ⇒ frame = start .. CURRENT ROW ⇒ a running total ✓<br/>OVER (PARTITION BY u)            ⇒ frame = the whole partition ⇒ the group total on every row<br/>OVER (... ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) ⇒ a moving 7-row average<br/>⚠ RANGE groups equal-valued peers · ROWS counts physical rows"]:::warn
  frame --> filt["⚠ you cannot filter a window in WHERE — windows run AFTER WHERE<br/>⇒ compute it in a CTE and filter in the outer query. That is TOP-N PER GROUP."]:::bad`,
    takeaway:
      "OVER computes across neighbouring rows without collapsing them. Mind the frame, and filter windows in an outer query.",
  },
  codeSamples: [
    {
      title: "Running totals and ranks",
      note: "",
      code: `SELECT
  o.user_id,
  o.id,
  o.placed_at,
  o.total_cents,
  sum(o.total_cents) OVER (PARTITION BY o.user_id ORDER BY o.id)      AS running,
  sum(o.total_cents) OVER (PARTITION BY o.user_id)                    AS user_total,
  round(100.0 * o.total_cents
        / sum(o.total_cents) OVER (PARTITION BY o.user_id), 1)        AS pct_of_user,
  row_number() OVER (PARTITION BY o.user_id ORDER BY o.total_cents DESC) AS rn
FROM orders o
ORDER BY o.user_id, o.id;`,
    },
    {
      title: "rank vs dense_rank vs row_number",
      note: "The tie behaviour is the whole point.",
      code: `CREATE TEMP TABLE scores (name TEXT, points INTEGER);
INSERT INTO scores VALUES ('a',100),('b',90),('c',90),('d',80),('e',80),('f',70);

SELECT
  name, points,
  row_number() OVER (ORDER BY points DESC) AS row_number,
  rank()       OVER (ORDER BY points DESC) AS rank,
  dense_rank() OVER (ORDER BY points DESC) AS dense_rank,
  ntile(3)     OVER (ORDER BY points DESC) AS tercile
FROM scores;
-- a 100 | 1 1 1
-- b  90 | 2 2 2
-- c  90 | 3 2 2      ties share in rank/dense_rank
-- d  80 | 4 4 3      rank SKIPS to 4; dense_rank does not
-- e  80 | 5 4 3
-- f  70 | 6 6 4`,
    },
    {
      title: "lag / lead — deltas and gaps",
      note: "How you compute change-over-time without a self-join.",
      code: `WITH daily AS (
  SELECT date(created_at) AS d, count(*) AS events, sum(amount_cents) AS cents
  FROM events
  WHERE created_at >= date('now','-14 days')
  GROUP BY date(created_at)
)
SELECT
  d,
  events,
  lag(events) OVER (ORDER BY d)                       AS yesterday,
  events - lag(events) OVER (ORDER BY d)              AS delta,
  round(100.0 * (events - lag(events) OVER (ORDER BY d))
        / NULLIF(lag(events) OVER (ORDER BY d), 0), 1) AS pct_change,
  round(avg(events) OVER (ORDER BY d ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1)
                                                       AS moving_avg_7d
FROM daily
ORDER BY d;`,
    },
    {
      title: "Top-N per group — the canonical pattern",
      note: "Rank in a CTE, filter outside.",
      code: `-- top 2 orders per user
WITH ranked AS (
  SELECT
    o.*,
    row_number() OVER (PARTITION BY o.user_id ORDER BY o.total_cents DESC) AS rn
  FROM orders o
)
SELECT u.name, r.id AS order_id, r.total_cents, r.rn
FROM ranked r
JOIN users u ON u.id = r.user_id
WHERE r.rn <= 2                      -- ⚠ cannot be done in the inner WHERE
ORDER BY u.name, r.rn;

-- best-selling SKU per country
WITH sales AS (
  SELECT u.country, i.sku, sum(i.qty) AS units
  FROM order_items i
  JOIN orders o ON o.id = i.order_id
  JOIN users  u ON u.id = o.user_id
  GROUP BY u.country, i.sku
), ranked AS (
  SELECT *, rank() OVER (PARTITION BY country ORDER BY units DESC) AS r FROM sales
)
SELECT country, sku, units FROM ranked WHERE r = 1 ORDER BY country;`,
    },
  ],
};
