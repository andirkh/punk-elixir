export default {
  front:
    "You run `UPDATE users SET country = 'GB'` and press enter. What did you just do to production?",
  back: "You set every user's country to GB. **A missing WHERE clause applies to every row** — UPDATE and DELETE default to the whole table, silently and instantly. This is the single most destructive mistake in SQL, and the defence is mechanical: write the WHERE first, run it as a SELECT, wrap it in a transaction you can ROLLBACK, and use `RETURNING` to see what you touched.",
  philosophy: {
    lead: "Writes are where SQL stops being a query language and starts being a loaded weapon.",
    body: [
      "The reason this bites people is that SQL has no undo and no confirmation. `DELETE FROM orders` is valid, fast, and complete. On a big table it may finish before you have released the enter key. Every experienced database person has a story here, and every one of them now writes the WHERE clause before the verb.",
      "Build the habit as a ritual: compose the statement as `SELECT * FROM t WHERE ...` first, look at the rows, then change SELECT to DELETE or UPDATE without touching the WHERE. In an interactive session, `BEGIN;` first — then a wrong statement is one `ROLLBACK;` away from never having happened. In application code, the same protection is a transaction (card 66).",
      "SQLite gives you two modern conveniences worth learning now because Postgres has them too. `RETURNING` makes a write also a read — you get back the rows you created or changed, which removes the classic insert-then-select round trip. And `ON CONFLICT DO UPDATE` (upsert) lets you express insert-or-update as one atomic statement rather than a read-then-write race.",
      "One more habit: name your columns in INSERT. `INSERT INTO users VALUES (...)` depends on column order, so the day someone adds a column your inserts start writing values into the wrong fields. `INSERT INTO users (email, name) VALUES (?, ?)` is immune.",
    ],
    diagram: `flowchart TB
  danger["⚠⚠ THE MOST EXPENSIVE MISSING CHARACTERS IN SOFTWARE<br/><br/>UPDATE users SET country = 'GB'   ← every row. no warning. instant.<br/>DELETE FROM orders                ← the entire table. gone.<br/><br/>no WHERE = ALL ROWS"]:::bad
  danger --> r1
  subgraph ritual["THE RITUAL — do this every single time"]
    direction TB
    r1["1. SELECT * FROM users WHERE id = 42    ← look first"]:::ok
    r2["2. BEGIN                                ← the escape hatch is armed"]:::ok
    r3["3. UPDATE users SET country='GB' WHERE id=42"]:::ok
    r4["4. SELECT changes()                     ← 1 row? is that what you expected?"]:::ok
    r5["5. COMMIT — or ROLLBACK if the number surprised you"]:::ok
    r1 --> r2 --> r3 --> r4 --> r5
  end
  r5 --> ins["INSERT — always name the columns<br/>✗ INSERT INTO users VALUES ('a@b.c','Ada','GB')   breaks when a column is added<br/>✓ INSERT INTO users (email, name, country) VALUES (?,?,?)"]:::warn
  ins --> ret["RETURNING — write and read in one statement<br/>INSERT INTO orders (user_id, total_cents) VALUES (1, 2500) RETURNING id, placed_at<br/>UPDATE orders SET status='paid' WHERE id=1 RETURNING *<br/>DELETE FROM orders WHERE status='cancelled' RETURNING id"]:::code
  ret --> ups["UPSERT — insert-or-update atomically, no read-then-write race<br/>INSERT INTO counters (key, n) VALUES ('views', 1)<br/>ON CONFLICT(key) DO UPDATE SET n = n + 1<br/><br/>changes() — rows affected by the last statement<br/>total_changes() — since the connection opened"]:::code`,
    takeaway:
      "No WHERE means all rows. SELECT first, BEGIN before you write, name your INSERT columns, use RETURNING.",
  },
  codeSamples: [
    {
      title: "The safe write ritual",
      note: "Run it inside sqlite3 and watch changes().",
      code: `-- 1. LOOK
SELECT id, name, country FROM users WHERE country = 'GB';

-- 2. ARM
BEGIN;

-- 3. WRITE (same WHERE, different verb)
UPDATE users SET country = 'UK' WHERE country = 'GB';

-- 4. VERIFY
SELECT changes() AS rows_changed;
SELECT id, name, country FROM users;

-- 5. DECIDE
ROLLBACK;      -- nothing happened
-- COMMIT;     -- or make it real

SELECT id, name, country FROM users;   -- unchanged ✓`,
    },
    {
      title: "See the disaster safely",
      note: "Do this on a scratch copy so the lesson costs nothing.",
      code: `CREATE TEMP TABLE demo AS SELECT * FROM users;

SELECT count(*) FROM demo;          -- 4

BEGIN;
UPDATE demo SET country = 'GB';     -- the missing WHERE
SELECT changes();                   -- 4  ← every row, instantly
SELECT * FROM demo;
ROLLBACK;

BEGIN;
DELETE FROM demo;                   -- the other one
SELECT changes();                   -- 4
SELECT count(*) FROM demo;          -- 0
ROLLBACK;

SELECT count(*) FROM demo;          -- 4 again, because we armed first ✓`,
    },
    {
      title: "RETURNING and upsert",
      note: "Both work in SQLite and Postgres.",
      code: `INSERT INTO orders (user_id, status, total_cents)
VALUES (1, 'pending', 4200)
RETURNING id, status, placed_at;

UPDATE orders SET status = 'paid'
WHERE user_id = 1 AND status = 'pending'
RETURNING id, status;

DELETE FROM orders WHERE status = 'refunded' RETURNING id, total_cents;

-- upsert: one atomic statement, no read-then-write race
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL) STRICT;

INSERT INTO counters (key, n) VALUES ('views', 1)
  ON CONFLICT(key) DO UPDATE SET n = n + excluded.n;

INSERT INTO counters (key, n) VALUES ('views', 5)
  ON CONFLICT(key) DO UPDATE SET n = n + excluded.n;

SELECT * FROM counters;   -- views | 6`,
    },
    {
      title: "From Elixir, with the same discipline",
      note: "Parameters always; transaction around multi-step writes.",
      code: `conn = SqlLab.DB.open()

# never build SQL with string interpolation — card 68 shows why
{:ok, n} = SqlLab.DB.exec(conn,
  "UPDATE orders SET status = ? WHERE user_id = ? AND status = ?",
  ["paid", 1, "pending"])

n   # rows changed — assert on this, do not assume

# multi-step write, all-or-nothing
alias Exqlite.Sqlite3
:ok = Sqlite3.execute(conn, "BEGIN")
try do
  {:ok, _} = SqlLab.DB.exec(conn, "INSERT INTO orders (user_id,total_cents) VALUES (?,?)", [1, 999])
  {:ok, _} = SqlLab.DB.exec(conn, "UPDATE users SET country = ? WHERE id = ?", ["JP", 1])
  :ok = Sqlite3.execute(conn, "COMMIT")
rescue
  e ->
    Sqlite3.execute(conn, "ROLLBACK")
    reraise e, __STACKTRACE__
end`,
    },
  ],
};
