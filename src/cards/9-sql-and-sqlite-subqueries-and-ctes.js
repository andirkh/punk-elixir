export default {
  front:
    "A 60-line query with four levels of nested parentheses works but nobody can review it. What restructures it without changing the plan?",
  back: "A **CTE** — `WITH name AS (SELECT ...)` — which names an intermediate result and lets you build a query as a sequence of readable steps, exactly like a pipeline. Subqueries come in three shapes: scalar (returns one value), IN/EXISTS (a filter), and derived tables (a virtual table in FROM). A **recursive** CTE adds iteration, which is how you walk trees and generate series.",
  philosophy: {
    lead: "CTEs are to SQL what the pipe operator is to Elixir: the same computation, restructured so a human can follow it top to bottom.",
    body: [
      "The readability gain is real but the composability gain is bigger. Once an intermediate result has a name, you can reference it twice, join it to itself, and reason about it in isolation. A CTE chain reads as: here are the paid orders; here are their per-user totals; here are the users above the median. That is a paragraph a colleague can review.",
      "Know the difference between a **correlated** and an uncorrelated subquery, because it is a performance cliff. An uncorrelated subquery runs once. A correlated one references the outer row and therefore runs *per outer row* — a thousand outer rows can mean a thousand executions. `EXISTS` is usually the right correlated form since it can stop at the first match; a correlated scalar subquery in the SELECT list is usually better rewritten as a LEFT JOIN to a grouped derived table.",
      "Recursive CTEs are the one place SQL becomes a real programming language, and the structure is exactly the recursion you learned in card 20: a base case, a recursive step that references the CTE itself, and termination. They generate sequences and date ranges, and they walk hierarchies — org charts, category trees, comment threads, graph reachability — in a single query.",
      "One engine caveat worth knowing: SQLite and older Postgres may **materialise** a CTE, computing it fully before the outer query filters it. Modern Postgres inlines them unless you write `MATERIALIZED`. So a CTE is not automatically free; if a query gets slow after refactoring into CTEs, that is why.",
    ],
    diagram: `flowchart TB
  subgraph shapes["THREE SHAPES OF SUBQUERY"]
    direction TB
    s1["SCALAR — returns exactly one value, usable anywhere a value is<br/>SELECT *, (SELECT count(*) FROM orders) AS all_orders FROM users"]:::hot
    s2["FILTER — IN / NOT IN / EXISTS / NOT EXISTS<br/>WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)"]:::hot
    s3["DERIVED — a virtual table in FROM<br/>FROM (SELECT user_id, sum(total_cents) c FROM orders GROUP BY 1) t"]:::hot
    s1 ~~~ s2 ~~~ s3
  end
  s3 --> corr["⚠ CORRELATED = runs ONCE PER OUTER ROW<br/>SELECT u.name, (SELECT count(*) FROM orders o WHERE o.user_id = u.id)<br/>FROM users u<br/>1000 users ⇒ 1000 subqueries"]:::bad
  corr --> fix["✓ rewrite as a LEFT JOIN onto a grouped derived table — ONE pass"]:::ok
  fix --> cte["CTE — name the steps and read top to bottom (SQL's pipe operator)<br/>WITH paid AS (<br/>  SELECT * FROM orders WHERE status = 'paid'<br/>), per_user AS (<br/>  SELECT user_id, sum(total_cents) AS cents FROM paid GROUP BY user_id<br/>)<br/>SELECT u.name, p.cents FROM per_user p JOIN users u ON u.id = p.user_id"]:::code
  cte --> rec["RECURSIVE CTE = base case + step + termination (card 20, in SQL)<br/>WITH RECURSIVE seq(n) AS (<br/>  SELECT 1                            ← base case<br/>  UNION ALL<br/>  SELECT n + 1 FROM seq WHERE n &lt; 10  ← step + termination<br/>) SELECT * FROM seq<br/><br/>⚠ forget the WHERE and it loops until the disk fills."]:::warn`,
    takeaway:
      "CTEs name intermediate steps; correlated subqueries run per row; recursive CTEs are recursion with a base case you must not forget.",
  },
  codeSamples: [
    {
      title: "The three shapes",
      note: "",
      code: `-- scalar
SELECT name, (SELECT count(*) FROM orders) AS orders_in_system FROM users;

-- filter with EXISTS (stops at the first match)
SELECT name FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.status='paid');

-- derived table
SELECT u.name, t.cents
FROM users u
JOIN (SELECT user_id, sum(total_cents) AS cents FROM orders GROUP BY user_id) t
  ON t.user_id = u.id
ORDER BY t.cents DESC;`,
    },
    {
      title: "The same report, nested vs CTE",
      note: "Identical results. One of them is reviewable.",
      code: `-- nested: correct, unreadable
SELECT name, cents FROM (
  SELECT u.name AS name, t.cents AS cents FROM users u JOIN (
    SELECT user_id, sum(total_cents) AS cents FROM (
      SELECT * FROM orders WHERE status = 'paid'
    ) GROUP BY user_id
  ) t ON t.user_id = u.id
) WHERE cents > (
  SELECT avg(c) FROM (SELECT sum(total_cents) AS c FROM orders WHERE status='paid' GROUP BY user_id)
);

-- CTE: same query, read it top to bottom
WITH paid AS (
  SELECT * FROM orders WHERE status = 'paid'
),
per_user AS (
  SELECT user_id, sum(total_cents) AS cents FROM paid GROUP BY user_id
),
average AS (
  SELECT avg(cents) AS mean FROM per_user
)
SELECT u.name, p.cents, round((SELECT mean FROM average), 0) AS avg_cents
FROM per_user p
JOIN users u ON u.id = p.user_id
WHERE p.cents > (SELECT mean FROM average)
ORDER BY p.cents DESC;`,
    },
    {
      title: "Correlated vs joined — measure it",
      note: "Run against the 200k events table.",
      code: `.timer on

-- correlated: one subquery per user row
SELECT u.id, u.name,
       (SELECT count(*) FROM events e WHERE e.user_id = u.id) AS n
FROM users u;

-- joined derived table: one pass
SELECT u.id, u.name, COALESCE(e.n, 0) AS n
FROM users u
LEFT JOIN (SELECT user_id, count(*) AS n FROM events GROUP BY user_id) e
       ON e.user_id = u.id;

EXPLAIN QUERY PLAN
SELECT u.id, (SELECT count(*) FROM events e WHERE e.user_id = u.id) FROM users u;`,
    },
    {
      title: "Recursive CTEs — series and trees",
      note: "Base case, step, termination.",
      code: `-- 1. generate a series (used in card 55 to make 200k rows)
WITH RECURSIVE seq(n) AS (
  SELECT 1
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 10        -- ⚠ omit this and it never ends
) SELECT n, n*n AS square FROM seq;

-- 2. a dense date range (so charts have no missing days)
WITH RECURSIVE days(d) AS (
  SELECT date('now','-13 days')
  UNION ALL
  SELECT date(d,'+1 day') FROM days WHERE d < date('now')
)
SELECT days.d, COALESCE(count(o.id), 0) AS orders
FROM days LEFT JOIN orders o ON date(o.placed_at) = days.d
GROUP BY days.d ORDER BY days.d;

-- 3. walk a tree
CREATE TEMP TABLE categories (id INTEGER PRIMARY KEY, parent_id INTEGER, name TEXT);
INSERT INTO categories VALUES
  (1,NULL,'root'),(2,1,'books'),(3,1,'office'),(4,2,'fiction'),(5,4,'scifi'),(6,3,'chairs');

WITH RECURSIVE tree(id, name, depth, path) AS (
  SELECT id, name, 0, name FROM categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.name, t.depth + 1, t.path || ' > ' || c.name
  FROM categories c JOIN tree t ON c.parent_id = t.id
)
SELECT printf('%.*c', depth*2, ' ') || name AS indented, depth, path
FROM tree ORDER BY path;`,
    },
  ],
};
