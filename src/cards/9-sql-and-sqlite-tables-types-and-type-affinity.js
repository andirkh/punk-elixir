export default {
  front:
    "You declare a column `age INTEGER` in SQLite and insert the string 'banana'. What happens — and why does that horrify a Postgres user?",
  back: "It is stored, as the text 'banana'. SQLite uses **type affinity**, not type enforcement: a declared type is a *preference* for conversion, and any value of any type may live in any column. This is dynamic typing at the storage layer. The fix, since SQLite 3.37, is a `STRICT` table, which rejects the wrong type like every other database.",
  philosophy: {
    lead: "SQLite's flexible typing is its single biggest departure from every other SQL engine, and you should turn it off.",
    body: [
      "The design made sense historically — SQLite came from a world of Tcl and loosely typed embedded systems — but in a backend service it turns a schema from a guarantee into a suggestion. A bug that would fail loudly at insert time in Postgres instead silently stores garbage that explodes three months later during a report. Always declare `STRICT` on new tables; you get real type errors and your schema means something again.",
      "The other SQLite-specific thing to learn here is `INTEGER PRIMARY KEY`. Spelled exactly that way, it is not just a primary key — it becomes an alias for the table's internal `rowid`, which means lookups by it are the fastest possible operation and no separate index is stored. Spell it `INT PRIMARY KEY` and you silently get something slower. Details like this are why reading the manual of your actual engine pays off.",
      "There are only five storage classes: NULL, INTEGER, REAL, TEXT, BLOB. Notice what is missing — there is no boolean (use INTEGER 0/1), no date/time type (use TEXT in ISO-8601, or INTEGER unix seconds), and no decimal. The money rule from card 30 applies with force: store money as INTEGER cents. Floating point cannot represent 0.1, and a rounding error in a financial total is not a bug you want to explain.",
      "Dates as ISO-8601 TEXT sort correctly as strings, which is a small piece of design elegance: `'2026-08-28' < '2026-09-01'` is true both as dates and as text, so ORDER BY and range filters just work.",
    ],
    diagram: `flowchart TB
  classes["FIVE STORAGE CLASSES — that is all there is<br/>NULL · INTEGER · REAL · TEXT · BLOB"]:::hot
  classes --> missing["NO boolean  → INTEGER 0 / 1<br/>NO datetime → TEXT 'YYYY-MM-DD HH:MM:SS' — it sorts correctly<br/>              or INTEGER unix seconds<br/>NO decimal  → INTEGER cents. NEVER REAL for money."]:::warn
  missing --> a1
  subgraph aff["TYPE AFFINITY — the default, and the trap"]
    direction TB
    a1["CREATE TABLE t (age INTEGER)<br/>INSERT INTO t VALUES ('banana')  ⇒ ✓ accepted, stored as TEXT 😱<br/>INSERT INTO t VALUES ('42')      ⇒ ✓ converted to INTEGER 42"]:::bad
    a2["CREATE TABLE t (age INTEGER) STRICT      ← SQLite ≥ 3.37, use this<br/>INSERT INTO t VALUES ('banana')  ⇒ ✗ Error: cannot store TEXT ✓"]:::ok
    a1 --> a2
  end
  a2 --> pk["INTEGER PRIMARY KEY IS SPECIAL<br/>id INTEGER PRIMARY KEY — an alias for rowid · fastest lookup, no extra index<br/>id INT     PRIMARY KEY — NOT an alias · a separate index · slower ⚠<br/>id INTEGER PRIMARY KEY AUTOINCREMENT — only if ids must never be reused"]:::warn
  pk --> three["MONEY, TIME, BOOLEANS — the three you will get wrong once<br/>total_cents INTEGER NOT NULL                       -- 19.99 is 1999<br/>created_at  TEXT NOT NULL DEFAULT (datetime('now'))<br/>is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))"]:::code`,
    takeaway:
      "Five storage classes, affinity not enforcement. Declare STRICT, use INTEGER PRIMARY KEY, store money as cents.",
  },
  codeSamples: [
    {
      title: "Watch affinity betray you",
      note: "Run both halves and compare.",
      code: `CREATE TABLE loose (id INTEGER PRIMARY KEY, age INTEGER, price REAL);
INSERT INTO loose (age, price) VALUES ('banana', 'free');
SELECT age, typeof(age), price, typeof(price) FROM loose;
-- banana|text|free|text     ← the schema lied 😱

CREATE TABLE strict_t (
  id INTEGER PRIMARY KEY,
  age INTEGER,
  price INTEGER
) STRICT;

INSERT INTO strict_t (age, price) VALUES ('banana', 1);
-- Runtime error: cannot store TEXT value in INTEGER column ✓`,
    },
    {
      title: "A schema written properly",
      note: "Copy this shape for real tables.",
      code: `DROP TABLE IF EXISTS accounts;

CREATE TABLE accounts (
  id           INTEGER PRIMARY KEY,             -- rowid alias, fastest
  email        TEXT    NOT NULL,
  display_name TEXT    NOT NULL DEFAULT '',
  balance_cents INTEGER NOT NULL DEFAULT 0,     -- money is an integer
  is_active    INTEGER NOT NULL DEFAULT 1,
  metadata     TEXT,                            -- JSON as TEXT
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),

  CHECK (balance_cents >= 0),
  CHECK (is_active IN (0, 1)),
  CHECK (email LIKE '%_@_%')
) STRICT;

CREATE UNIQUE INDEX accounts_email_idx ON accounts(lower(email));

INSERT INTO accounts (email, display_name, balance_cents) VALUES ('Ada@X.dev','Ada',1999);
-- INSERT INTO accounts (email, balance_cents) VALUES ('b@x.dev', -1);  -- CHECK fails ✓
-- INSERT INTO accounts (email) VALUES ('ADA@x.dev');                   -- UNIQUE fails ✓
SELECT * FROM accounts;`,
    },
    {
      title: "Money and floating point",
      note: "Run this once and you will never use REAL for money.",
      code: `SELECT 0.1 + 0.2;              -- 0.30000000000000004
SELECT 0.1 + 0.2 = 0.3;        -- 0  (false!)

-- integer cents are exact
SELECT 10 + 20 = 30;           -- 1
SELECT (1999 * 3) AS cents, printf('$%.2f', (1999 * 3) / 100.0) AS display;

-- format only at the edge, never store the formatted value
SELECT id, printf('$%.2f', balance_cents / 100.0) AS balance FROM accounts;`,
    },
    {
      title: "Dates as sortable text",
      note: "SQLite date functions all work on this format.",
      code: `SELECT datetime('now'), date('now'), strftime('%Y-%m', 'now');
SELECT datetime('now', '-7 days');
SELECT date('now', 'start of month');
SELECT julianday('now') - julianday('2026-01-01') AS days_into_year;

-- ISO-8601 text sorts chronologically, so this is a real range scan:
SELECT * FROM orders WHERE placed_at >= date('now','-30 days') ORDER BY placed_at DESC;

-- unix seconds if you prefer integers:
SELECT strftime('%s','now') AS unix, datetime(strftime('%s','now'), 'unixepoch');`,
    },
  ],
};
