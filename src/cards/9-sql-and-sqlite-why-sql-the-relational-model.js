export default {
  front:
    "Your context module now needs to store data. Before any library: what IS a relational database, and why has one query language survived fifty years of fashion?",
  back: "A relational database stores **relations** — unordered sets of rows over a fixed set of typed columns. SQL is a *declarative* language over those sets: you describe the result you want, and a **query planner** decides how to get it. That separation is why SQL outlived every ORM, ODM and NoSQL wave: your query survives changes to indexes, storage and even the engine underneath.",
  philosophy: {
    lead: "SQL is the only place in your stack where you say WHAT you want and let a machine figure out HOW.",
    body: [
      "Everything you have written so far is imperative: Enum.map walks a list in the order you specified. SQL is the opposite. `SELECT name FROM users WHERE age > 18` does not say scan-the-table or use-the-index; it states a set. The planner reads your statement, looks at the available indexes and its statistics about the data, and picks a physical strategy. Add an index tomorrow and the same query gets faster with zero code changes.",
      "The mental model that unlocks SQL is: **every clause takes a set of rows and returns a set of rows**. FROM produces rows, JOIN combines them, WHERE removes some, GROUP BY folds them into groups, HAVING removes groups, SELECT projects columns, ORDER BY imposes an order, LIMIT truncates. Once you see a query as that pipeline — and you already understand pipelines from card 16 — SQL stops being a magic incantation.",
      "The order you WRITE a query is not the order it RUNS. That single fact explains most beginner confusion: why you cannot use a SELECT alias in WHERE, why WHERE cannot see an aggregate, why HAVING exists at all. Learn the execution order once and those rules become obvious instead of arbitrary.",
      "We start on SQLite deliberately. It is a single file, it is already installed on your Mac, it has no server, no users, no ports and no configuration — so nothing stands between you and the language itself. Everything you learn here transfers directly to Postgres in module 11.",
    ],
    diagram: `flowchart TB
  rel["A RELATION = a SET of rows over typed columns<br/><br/>id ¦ name  ¦ age<br/>1  ¦ Ada   ¦ 36<br/>2  ¦ Grace ¦ 45<br/><br/>rows are a SET — no index, no position,<br/>no 'first row' unless you ORDER BY"]:::code
  rel --> cmp
  subgraph cmp["two ways to ask for the same thing"]
    direction LR
    dec["DECLARATIVE — SQL<br/>SELECT name FROM users<br/>WHERE age &gt; 18<br/>ORDER BY name<br/><br/>'give me this SET'<br/>the planner chooses index or scan"]:::ok
    imp["IMPERATIVE — what you did until now<br/>users<br/>¦&gt; Enum.filter(fun)<br/>¦&gt; Enum.sort_by(fun)<br/>¦&gt; Enum.map(fun)<br/><br/>'do these STEPS in this order'"]:::hot
  end
  cmp --> orders
  subgraph orders["written order vs execution order"]
    direction LR
    wr["WRITTEN<br/>SELECT ← 5<br/>FROM ← 1<br/>WHERE ← 2<br/>GROUP BY ← 3<br/>HAVING ← 4<br/>ORDER BY ← 6<br/>LIMIT ← 7"]:::warn
    ex["EXECUTED<br/>1. FROM / JOIN — rows<br/>2. WHERE — filter<br/>3. GROUP BY — fold<br/>4. HAVING — filter<br/>5. SELECT — project<br/>6. ORDER BY — sort<br/>7. LIMIT — cut"]:::ok
  end
  orders --> why["⇒ WHERE cannot see a SELECT alias.<br/>⇒ HAVING exists because filtering GROUPS happens AFTER grouping.<br/>Nothing here is arbitrary."]:::hot`,
    takeaway:
      "SQL describes a set; the planner chooses the strategy. Learn the execution order and the rules stop feeling arbitrary.",
  },
  codeSamples: [
    {
      title: "Open a database and look around",
      note: "sqlite3 ships with macOS — nothing to install. Run in a terminal.",
      code: `sqlite3 learn.db

-- inside the sqlite3 prompt:
.headers on
.mode box
.databases
.tables

SELECT sqlite_version();
SELECT 1 + 1 AS answer;
SELECT 'sql is just expressions' AS note;

.quit`,
    },
    {
      title: "A tiny schema you will use all module",
      note: "Paste the whole block into sqlite3.",
      code: `DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  email      TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  country    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'pending',
  total_cents INTEGER NOT NULL DEFAULT 0,
  placed_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE order_items (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  sku         TEXT    NOT NULL,
  qty         INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL
);

.schema`,
    },
    {
      title: "Seed some data",
      note: "",
      code: `INSERT INTO users (email, name, country) VALUES
  ('ada@x.dev',   'Ada',   'GB'),
  ('grace@x.dev', 'Grace', 'US'),
  ('alan@x.dev',  'Alan',  'GB'),
  ('kaz@x.dev',   'Kaz',   'JP');

INSERT INTO orders (user_id, status, total_cents) VALUES
  (1, 'paid',     2500),
  (1, 'paid',     1200),
  (2, 'pending',   800),
  (2, 'paid',     9900),
  (3, 'refunded', 1500);

INSERT INTO order_items (order_id, sku, qty, price_cents) VALUES
  (1, 'BOOK-1', 2, 1000), (1, 'PEN-9', 1, 500),
  (2, 'BOOK-1', 1, 1200),
  (4, 'DESK-3', 1, 9900),
  (5, 'MUG-2',  3,  500);

SELECT count(*) AS users FROM users;
SELECT count(*) AS orders FROM orders;`,
    },
    {
      title: "Feel the pipeline",
      note: "Each clause takes rows and returns rows.",
      code: `-- FROM: 5 rows
SELECT * FROM orders;

-- + WHERE: fewer rows
SELECT * FROM orders WHERE status = 'paid';

-- + GROUP BY: rows folded into groups
SELECT user_id, count(*) AS n, sum(total_cents) AS cents
FROM orders WHERE status = 'paid' GROUP BY user_id;

-- + HAVING: groups filtered
SELECT user_id, sum(total_cents) AS cents
FROM orders WHERE status = 'paid'
GROUP BY user_id HAVING sum(total_cents) > 3000;

-- + ORDER BY + LIMIT: ordered and cut
SELECT user_id, sum(total_cents) AS cents
FROM orders WHERE status = 'paid'
GROUP BY user_id ORDER BY cents DESC LIMIT 1;`,
    },
  ],
};
