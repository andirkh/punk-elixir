export default {
  front:
    "A table has 100 rows, 10 with `country = NULL`. `SELECT count(*) WHERE country = 'GB'` returns 40 and `WHERE country <> 'GB'` returns 50. Where did ten rows go?",
  back: "Into the third truth value. SQL logic is **three-valued**: TRUE, FALSE and UNKNOWN. `NULL <> 'GB'` is not TRUE, it is UNKNOWN — and WHERE keeps only rows where the condition is TRUE. NULL means *unknown*, not *empty*, so any comparison with it is unknown too. Use `IS NULL` / `IS NOT NULL`, and remember that `NOT IN` with a NULL in the list returns nothing at all.",
  philosophy: {
    lead: "NULL is not a value. It is the absence of one, and SQL propagates that absence through every expression it touches.",
    body: [
      "Once you accept that NULL means 'I do not know', the rules become inevitable rather than surprising. Is an unknown country equal to GB? Unknown. Is it different from GB? Also unknown. Is unknown equal to unknown? Still unknown — which is why `NULL = NULL` is not true and why `IS NULL` had to be invented as a separate operator.",
      "The consequences ripple into arithmetic and aggregates. `NULL + 5` is NULL. String concatenation with a NULL yields NULL, so one missing middle name can blank out an entire formatted address. Aggregates go the other way and quietly *skip* NULLs: `count(col)` ignores them while `count(*)` does not, and `avg(col)` divides by the number of non-null values, which is usually what you want but rarely what people expect.",
      "The genuinely dangerous one is `NOT IN` with a subquery that can return NULL. `WHERE id NOT IN (SELECT user_id FROM orders)` returns zero rows the moment a single `user_id` is NULL, because `id <> NULL` is UNKNOWN and the whole AND-chain can never be TRUE. It fails silently — the query runs, returns an empty set, and looks like 'no matches'. Prefer `NOT EXISTS`, which has no such hole.",
      "Design-wise, a NULLable column is a decision, not a default. Ask what NULL would mean in that column; if you cannot answer, make it NOT NULL with a default. Fewer nullable columns means fewer three-valued surprises later.",
    ],
    diagram: `flowchart TB
  def0["NULL = UNKNOWN.<br/>Not empty. Not zero. Not an empty string."]:::hot
  def0 --> ops["NULL = NULL     ⇒ UNKNOWN, not TRUE   ← use IS NULL<br/>NULL &lt;&gt; 'GB'    ⇒ UNKNOWN ⇒ the row is dropped by WHERE<br/>NULL + 5        ⇒ NULL<br/>'a' ¦¦ NULL     ⇒ NULL ⇒ one missing field blanks the whole string"]:::warn
  ops --> logic["THREE-VALUED LOGIC — WHERE keeps only TRUE<br/><br/>AND ¦ T F U        OR ¦ T F U       NOT<br/>T   ¦ T F U        T  ¦ T T T       T → F<br/>F   ¦ F F F        F  ¦ T F U       F → T<br/>U   ¦ U F U        U  ¦ T U U       U → U  ← stays unknown"]:::code
  logic --> part["THE 100-ROW PARTITION<br/>country = 'GB'    → 40<br/>country &lt;&gt; 'GB'   → 50<br/>country IS NULL   → 10<br/>40 + 50 = 90. The 10 NULLs are in NEITHER set."]:::hot
  part --> notin["⚠⚠ NOT IN + NULL = A SILENT EMPTY RESULT<br/>SELECT * FROM users WHERE id NOT IN (SELECT user_id FROM orders)<br/>one NULL user_id ⇒ ZERO rows, no error, looks like 'no matches'"]:::bad
  notin --> fix["✓ SELECT * FROM users u WHERE NOT EXISTS<br/>    (SELECT 1 FROM orders o WHERE o.user_id = u.id)"]:::ok
  fix --> aggs["AGGREGATES SKIP NULLS          TOOLS<br/>count(*) — counts rows          COALESCE(x, y, 'default') — first non-null<br/>count(col) — skips NULLs        IFNULL(x, 0) — the 2-arg version<br/>avg(col) — divides by non-null  NULLIF(x, 0) — NULL if equal, for safe division<br/>sum of all NULL ⇒ NULL, not 0   ORDER BY col NULLS LAST"]:::code`,
    takeaway:
      "NULL is unknown and infects every expression. Use IS NULL, prefer NOT EXISTS over NOT IN, and remember aggregates skip NULLs.",
  },
  codeSamples: [
    {
      title: "Prove the third value exists",
      note: "",
      code: `CREATE TEMP TABLE t (id INTEGER, country TEXT);
INSERT INTO t VALUES (1,'GB'),(2,'US'),(3,NULL),(4,'GB'),(5,NULL);

SELECT count(*) AS total FROM t;                         -- 5
SELECT count(*) AS gb    FROM t WHERE country =  'GB';   -- 2
SELECT count(*) AS notgb FROM t WHERE country <> 'GB';   -- 1  (not 3!)
SELECT count(*) AS nulls FROM t WHERE country IS NULL;   -- 2
--                                     2 + 1 + 2 = 5 ✓

SELECT NULL = NULL;        -- NULL (unknown)
SELECT NULL IS NULL;       -- 1    (true)
SELECT NULL + 5;           -- NULL
SELECT 'hi ' || NULL;      -- NULL
SELECT count(*) AS rows_, count(country) AS non_null FROM t;   -- 5 | 3`,
    },
    {
      title: "The NOT IN trap, live",
      note: "The most expensive silent bug in this card.",
      code: `CREATE TEMP TABLE u (id INTEGER);
CREATE TEMP TABLE o (user_id INTEGER);
INSERT INTO u VALUES (1),(2),(3);
INSERT INTO o VALUES (1), (NULL);        -- one NULL is all it takes

-- expected: users 2 and 3
SELECT * FROM u WHERE id NOT IN (SELECT user_id FROM o);
-- (no rows)  😱 no error, no warning

-- correct, and NULL-safe:
SELECT * FROM u WHERE NOT EXISTS (SELECT 1 FROM o WHERE o.user_id = u.id);
-- 2 | 3 ✓

-- also correct, if you must use NOT IN:
SELECT * FROM u WHERE id NOT IN (SELECT user_id FROM o WHERE user_id IS NOT NULL);`,
    },
    {
      title: "Handling NULLs deliberately",
      note: "COALESCE, IFNULL, NULLIF and safe division.",
      code: `SELECT
  id,
  COALESCE(country, 'unknown')            AS country,
  IFNULL(country, '-')                    AS country2
FROM t;

-- safe division: NULLIF turns a zero denominator into NULL, not an error
SELECT 10 / NULLIF(0, 0) AS safe;         -- NULL instead of a divide error
SELECT COALESCE(10 / NULLIF(0,0), 0) AS with_default;

-- sum of nothing is NULL, not 0 — this bites in dashboards
SELECT sum(total_cents) FROM orders WHERE status = 'nonexistent';         -- NULL
SELECT COALESCE(sum(total_cents), 0) FROM orders WHERE status = 'nope';   -- 0 ✓

-- ordering: put unknowns last
SELECT id, country FROM t ORDER BY country IS NULL, country;`,
    },
    {
      title: "NULLs across the Elixir boundary",
      note: "NULL becomes nil — and nil in a bind is NULL.",
      code: `conn = SqlLab.DB.open()

SqlLab.DB.query(conn, "SELECT NULL AS a, 1 AS b")
# [%{"a" => nil, "b" => 1}]

# ⚠ binding nil produces "col = NULL", which is never TRUE:
SqlLab.DB.query(conn, "SELECT * FROM users WHERE country = ?", [nil])   # []

# express "maybe null" explicitly instead:
sql = "SELECT * FROM users WHERE (?1 IS NULL AND country IS NULL) OR country = ?1"
SqlLab.DB.query(conn, sql, [nil])

# or use SQLite's null-safe equality operator:
SqlLab.DB.query(conn, "SELECT * FROM users WHERE country IS ?", [nil])`,
    },
  ],
};
