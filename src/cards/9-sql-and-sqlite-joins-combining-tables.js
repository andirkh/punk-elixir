export default {
  front:
    "You join 1,000 orders to their items and get 3,000 rows back. Nothing is broken. Why — and what happens if you then `sum(orders.total_cents)`?",
  back: "A JOIN produces one row per **matching pair**. An order with 3 items becomes 3 rows, each repeating the order's columns. So `sum(orders.total_cents)` triple-counts that order's total — a silently wrong number, not an error. This row multiplication is the single most common source of wrong analytics. Aggregate the child table separately, or aggregate over `DISTINCT` order ids.",
  philosophy: {
    lead: "A JOIN is a filtered cross product. Understanding it that way explains both how it works and every way it goes wrong.",
    body: [
      "Conceptually the engine forms every possible pairing of rows from both tables and then keeps the pairs where the ON condition is TRUE. It never actually does that — the planner uses indexes, hash tables and merge strategies — but the *semantics* are exactly that. Which is why forgetting the ON clause gives you a cartesian product: 10,000 orders joined to 10,000 users with no condition is 100,000,000 rows, and your laptop will find out.",
      "The join types answer one question: what happens to rows with no match? INNER drops them. LEFT keeps every row of the left table and fills the right side with NULLs. That NULL-filling connects directly to the previous card, and it creates a classic trap: putting a condition on the right table in the WHERE clause turns your LEFT JOIN back into an INNER JOIN, because `right.col = 'x'` is never TRUE when the column is NULL. Conditions on the outer table belong in ON, not WHERE.",
      "Row multiplication deserves its own alarm. It is dangerous precisely because it produces a plausible number rather than an error. Any time you aggregate across a one-to-many join, ask whether the thing you are summing lives on the 'one' side. If it does, either aggregate the many-side in a subquery first, or use `sum(DISTINCT ...)` carefully, or count with `count(DISTINCT o.id)`.",
      "Finally: alias your tables and qualify your columns. `SELECT id FROM orders JOIN users ON ...` is ambiguous the moment both tables have an `id`. `SELECT o.id, u.email FROM orders o JOIN users u ON u.id = o.user_id` reads cleanly and never breaks when a column is added.",
    ],
    diagram: `flowchart TB
  idea["A JOIN IS A FILTERED CROSS PRODUCT<br/>every pair of rows where the ON condition is TRUE"]:::hot
  idea --> ex
  subgraph ex["2 orders × 3 items ⇒ 3 ROWS — and o1 appears TWICE"]
    direction LR
    o1["orders<br/>o1<br/>o2"]:::code --> res["result<br/>o1 ¦ i1<br/>o1 ¦ i2   ← o1 repeated<br/>o2 ¦ i3"]:::warn
    i1["order_items<br/>i1 (o1)<br/>i2 (o1)<br/>i3 (o2)"]:::code --> res
  end
  ex --> fan["⚠⚠ THE FAN-OUT BUG — a wrong NUMBER, not an error<br/>SELECT sum(o.total_cents)<br/>FROM orders o JOIN order_items i ON i.order_id = o.id<br/>⇒ o1s total is counted twice<br/>✓ aggregate the many-side first, or count(DISTINCT o.id), or a subquery"]:::bad
  fan --> types["JOIN TYPES — 'what about rows with no match?'<br/>INNER JOIN — keep only matched pairs (the default)<br/>LEFT JOIN  — keep ALL left rows, the right side becomes NULL<br/>CROSS JOIN — every pair, no condition, deliberate<br/>⚠ no ON at all ⇒ an accidental CROSS JOIN: 10k × 10k = 100,000,000 rows"]:::warn
  types --> trap["⚠ THE LEFT-JOIN-KILLED-BY-WHERE TRAP<br/>✗ FROM users u LEFT JOIN orders o ON o.user_id = u.id<br/>  WHERE o.status = 'paid'<br/>  NULL &lt;&gt; 'paid' ⇒ unmatched users are dropped ⇒ it is now an INNER JOIN 😱<br/><br/>✓ FROM users u LEFT JOIN orders o<br/>    ON o.user_id = u.id AND o.status = 'paid'   ← the condition belongs in ON"]:::bad`,
    takeaway:
      "One row per matching pair. Fan-out silently multiplies aggregates, and a WHERE on the outer table cancels a LEFT JOIN.",
  },
  codeSamples: [
    {
      title: "Watch the fan-out",
      note: "Same data, three answers. Only two are right.",
      code: `-- how many rows does the join produce?
SELECT count(*) AS joined_rows
FROM orders o JOIN order_items i ON i.order_id = o.id;

-- ✗ WRONG: totals multiplied by the item count
SELECT sum(o.total_cents) AS wrong_total
FROM orders o JOIN order_items i ON i.order_id = o.id;

-- ✓ right: the order totals alone
SELECT sum(total_cents) AS right_total FROM orders;

-- ✓ right: aggregate the many-side in a subquery, then join
SELECT o.id, o.total_cents, COALESCE(it.items, 0) AS items
FROM orders o
LEFT JOIN (SELECT order_id, count(*) AS items FROM order_items GROUP BY order_id) it
       ON it.order_id = o.id
ORDER BY o.id;

-- ✓ right: count distinct parents
SELECT count(DISTINCT o.id) AS orders, count(*) AS item_rows
FROM orders o JOIN order_items i ON i.order_id = o.id;`,
    },
    {
      title: "INNER vs LEFT, and the WHERE trap",
      note: "Kaz has no orders — watch where they disappear.",
      code: `-- INNER: Kaz vanishes (no matching order)
SELECT u.name, o.id AS order_id, o.status
FROM users u
JOIN orders o ON o.user_id = u.id
ORDER BY u.name;

-- LEFT: Kaz appears with NULLs ✓
SELECT u.name, o.id AS order_id, o.status
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
ORDER BY u.name;

-- ✗ the trap: this LEFT JOIN is secretly an INNER JOIN again
SELECT u.name, o.id
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.status = 'paid';

-- ✓ move the condition into ON
SELECT u.name, o.id, o.status
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'paid'
ORDER BY u.name;

-- "users with no orders at all" — an anti-join
SELECT u.name
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE o.id IS NULL;`,
    },
    {
      title: "Accidental cartesian product",
      note: "Small numbers here; imagine them at production scale.",
      code: `SELECT count(*) FROM users;          -- 4
SELECT count(*) FROM orders;         -- 5

-- no ON: every pair
SELECT count(*) AS cartesian FROM users, orders;        -- 20
SELECT count(*) AS cartesian FROM users CROSS JOIN orders;  -- 20, explicit

-- at 10k × 10k that is 100,000,000 rows.
-- ALWAYS check: does every join have an ON that links the keys?

-- a legitimate cross join: build a dense date × country grid
WITH RECURSIVE days(d) AS (
  SELECT date('now','-6 days')
  UNION ALL SELECT date(d,'+1 day') FROM days WHERE d < date('now')
)
SELECT d, c.country
FROM days CROSS JOIN (SELECT DISTINCT country FROM users) c
ORDER BY d, c.country;`,
    },
    {
      title: "A three-table report",
      note: "Alias everything, qualify everything.",
      code: `SELECT
  u.name,
  u.country,
  o.id                          AS order_id,
  o.status,
  printf('$%.2f', o.total_cents/100.0) AS total,
  count(i.id)                   AS line_items,
  COALESCE(sum(i.qty), 0)       AS units
FROM users u
JOIN orders      o ON o.user_id  = u.id
LEFT JOIN order_items i ON i.order_id = o.id
WHERE o.status <> 'refunded'
GROUP BY u.name, u.country, o.id, o.status, o.total_cents
ORDER BY o.total_cents DESC;`,
    },
  ],
};
