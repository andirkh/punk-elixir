export default {
  front:
    "You debit one account and credit another in two statements. The process crashes between them. What guarantees the money did not evaporate?",
  back: "A **transaction**. `BEGIN` ... `COMMIT` makes the pair **atomic** — all or nothing. ACID is the four promises: **A**tomicity (all or nothing), **C**onsistency (constraints hold at commit), **I**solation (concurrent transactions do not see each other's partial work), **D**urability (a committed write survives a crash). Without an explicit BEGIN, every statement is its own transaction — which is why a loop of 10,000 inserts is 10,000 fsyncs and takes minutes.",
  philosophy: {
    lead: "A transaction turns several statements into one indivisible unit — the database's version of the atomicity you got from Ecto.Multi, but at the storage layer.",
    body: [
      "The performance consequence surprises people more than the correctness one. Every commit must reach durable storage, and that is the slowest thing a database does. Ten thousand autocommitted inserts mean ten thousand disk syncs. Wrap them in a single transaction and it becomes one — routinely a 100x speedup, with no change to the inserts themselves. Batch your writes.",
      "Isolation is where the subtlety lives. Concurrent transactions can produce anomalies: a **dirty read** sees uncommitted data, a **non-repeatable read** sees a row change between two reads, a **phantom read** sees new rows appear in a repeated range query, and **lost update** silently discards one of two concurrent read-modify-writes. Isolation levels are the dial that trades anomalies for concurrency. SQLite keeps it simple by serialising writers — it is effectively SERIALIZABLE — while Postgres defaults to READ COMMITTED and lets you ask for more.",
      "Lost update is the one that bites application code most, and it is not exotic: read a balance, compute a new one in Elixir, write it back. Two requests interleave and one increment vanishes. The fixes are to do the arithmetic in SQL (`SET balance = balance - ?`), to take an explicit row lock, or to use optimistic concurrency with a version column. Note the resemblance to card 37's Agent race — same bug, different layer.",
      "SQLite specifics worth knowing: `BEGIN IMMEDIATE` takes the write lock up front, which avoids an upgrade deadlock when a transaction reads and then writes. And `PRAGMA busy_timeout` makes a blocked connection wait rather than immediately failing with SQLITE_BUSY.",
    ],
    diagram: `flowchart TB
  acid["ACID<br/>Atomicity   — all statements commit, or none do<br/>Consistency — constraints (FK, CHECK, UNIQUE) hold at commit<br/>Isolation   — concurrent transactions do not see partial work<br/>Durability  — once COMMIT returns, a crash cannot lose it"]:::hot
  acid --> auto["⚠ NO EXPLICIT BEGIN = AUTOCOMMIT = one transaction PER STATEMENT<br/>10,000 inserts → 10,000 fsyncs → minutes<br/>BEGIN then 10,000 inserts then COMMIT → 1 fsync → under a second · ~100x ✓"]:::warn
  auto --> anom["ISOLATION ANOMALIES<br/>dirty read          — read another transaction's UNCOMMITTED data<br/>non-repeatable read — the same row read twice, different values<br/>phantom read        — the same range read twice, NEW rows appeared<br/>lost update         — two read-modify-writes, one silently overwritten"]:::warn
  anom --> lvl["LEVEL             ¦ dirty ¦ non-rep ¦ phantom<br/>READ UNCOMMITTED  ¦ yes   ¦ yes     ¦ yes<br/>READ COMMITTED    ¦ no    ¦ yes     ¦ yes    ← Postgres default<br/>REPEATABLE READ   ¦ no    ¦ no      ¦ yes<br/>SERIALIZABLE      ¦ no    ¦ no      ¦ no     ← SQLite behaves like this"]:::code
  lvl --> lost
  subgraph lost["⚠⚠ LOST UPDATE — the same race as card 37, one layer down"]
    direction LR
    t1["T1: SELECT balance → 100<br/>T1: UPDATE SET balance = 90"]:::bad
    t2["T2: SELECT balance → 100<br/>T2: UPDATE SET balance = 80"]:::bad
    t1 --> fin["final balance 80.<br/>T1's debit vanished. No error."]:::bad
    t2 --> fin
  end
  lost --> fixes["✓ do the arithmetic IN SQL — UPDATE … SET balance = balance - 10<br/>✓ or lock — BEGIN IMMEDIATE, or SELECT … FOR UPDATE in Postgres<br/>✓ or version — UPDATE … WHERE version = ? then check the row count"]:::ok
  fixes --> lite["SQLITE<br/>BEGIN            — deferred: takes the write lock LATE ⇒ upgrade conflicts<br/>BEGIN IMMEDIATE — takes it now ⇒ use this for read-then-write ✓<br/>PRAGMA busy_timeout = 5000 — wait instead of failing with SQLITE_BUSY"]:::code`,
    takeaway:
      "Wrap multi-step writes and bulk inserts in BEGIN/COMMIT. Do read-modify-write arithmetic inside SQL, not in Elixir.",
  },
  codeSamples: [
    {
      title: "Atomicity you can see",
      note: "",
      code: `CREATE TEMP TABLE accounts_t (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0));
INSERT INTO accounts_t VALUES (1, 100), (2, 50);

-- a transfer that must not half-happen
BEGIN;
  UPDATE accounts_t SET balance = balance - 30 WHERE id = 1;
  UPDATE accounts_t SET balance = balance + 30 WHERE id = 2;
COMMIT;
SELECT * FROM accounts_t;      -- 70 | 80 ✓

-- a transfer that violates a constraint: nothing is applied
BEGIN;
  UPDATE accounts_t SET balance = balance - 999 WHERE id = 1;   -- CHECK fails
ROLLBACK;
SELECT * FROM accounts_t;      -- still 70 | 80 ✓`,
    },
    {
      title: "The 100x insert speedup",
      note: "Run both and compare the timer.",
      code: `.timer on
CREATE TEMP TABLE bulk (id INTEGER PRIMARY KEY, n INTEGER);

-- autocommit: one transaction (and one fsync) per row
WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM s WHERE n < 20000)
INSERT INTO bulk (n) SELECT n FROM s;
-- (a single statement is already one transaction — this one is fast)

-- the slow shape is a LOOP of statements from your application:
--   for i <- 1..20_000, do: exec(conn, "INSERT INTO bulk (n) VALUES (?)", [i])
-- that is 20,000 transactions. Wrap it:
--   execute(conn, "BEGIN")
--   for i <- 1..20_000, do: exec(...)
--   execute(conn, "COMMIT")
SELECT count(*) FROM bulk;`,
    },
    {
      title: "Lost update, and three fixes",
      note: "The read-modify-write race, made concrete.",
      code: `-- ✗ THE RACE (what your Elixir code does if you are not careful)
--   balance = query("SELECT balance FROM accounts_t WHERE id = 1")   -- 70
--   exec("UPDATE accounts_t SET balance = ? WHERE id = 1", [balance - 10])
--   two concurrent requests ⇒ one decrement disappears

-- ✓ fix 1: arithmetic inside SQL — atomic, no read needed
UPDATE accounts_t SET balance = balance - 10 WHERE id = 1 AND balance >= 10;
SELECT changes();     -- 0 means "insufficient funds", not "no such row"

-- ✓ fix 2: optimistic concurrency with a version column
CREATE TEMP TABLE docs (id INTEGER PRIMARY KEY, body TEXT, version INTEGER NOT NULL);
INSERT INTO docs VALUES (1, 'v1', 1);

UPDATE docs SET body = 'v2', version = version + 1 WHERE id = 1 AND version = 1;
SELECT changes();     -- 1 = won
UPDATE docs SET body = 'v2b', version = version + 1 WHERE id = 1 AND version = 1;
SELECT changes();     -- 0 = someone else won; re-read and retry ✓

-- ✓ fix 3: take the write lock before reading
BEGIN IMMEDIATE;
  SELECT balance FROM accounts_t WHERE id = 1;
  UPDATE accounts_t SET balance = 60 WHERE id = 1;
COMMIT;`,
    },
    {
      title: "Transactions from Elixir",
      note: "A helper that always commits or always rolls back.",
      code: `defmodule SqlLab.Tx do
  alias Exqlite.Sqlite3

  @doc "Runs fun inside a transaction. Rolls back on any exception or :error."
  def transaction(conn, fun, mode \\\\ "IMMEDIATE") do
    :ok = Sqlite3.execute(conn, "BEGIN " <> mode)

    try do
      case fun.(conn) do
        {:error, _} = err -> Sqlite3.execute(conn, "ROLLBACK"); err
        result -> :ok = Sqlite3.execute(conn, "COMMIT"); {:ok, result}
      end
    rescue
      e -> Sqlite3.execute(conn, "ROLLBACK"); reraise e, __STACKTRACE__
    catch
      kind, reason -> Sqlite3.execute(conn, "ROLLBACK"); :erlang.raise(kind, reason, __STACKTRACE__)
    end
  end
end

conn = SqlLab.DB.open()

SqlLab.Tx.transaction(conn, fn c ->
  {:ok, 1} = SqlLab.DB.exec(c, "UPDATE accounts SET balance_cents = balance_cents - ? WHERE id = ? AND balance_cents >= ?", [1000, 1, 1000])
  {:ok, 1} = SqlLab.DB.exec(c, "UPDATE accounts SET balance_cents = balance_cents + ? WHERE id = ?", [1000, 2])
  :transferred
end)

# bulk insert: one transaction, not 10_000
SqlLab.Tx.transaction(conn, fn c ->
  Enum.each(1..10_000, fn i ->
    SqlLab.DB.exec(c, "INSERT INTO events (user_id, country, kind, amount_cents, payload, created_at) VALUES (?,?,?,?,?,datetime('now'))",
                   [rem(i, 100), "GB", "view", i, "x"])
  end)
end)`,
    },
  ],
};
