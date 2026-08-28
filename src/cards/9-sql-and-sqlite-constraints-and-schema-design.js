export default {
  front:
    "You declared `REFERENCES users(id)` on `orders.user_id`, then inserted an order for user 9999 — and SQLite accepted it. Why?",
  back: "Because SQLite ships with **foreign key enforcement OFF by default**, for backwards compatibility. You must run `PRAGMA foreign_keys = ON` on **every connection**. This is the single nastiest default in SQLite: your schema documents a relationship the engine is not enforcing, and orphan rows accumulate silently. Constraints are only guarantees if the engine checks them.",
  philosophy: {
    lead: "A constraint moves a rule out of your application code and into the one place every writer must pass through.",
    body: [
      "Application-level validation — the Ecto changeset of card 82 — gives good error messages but cannot be the guarantee, because it only runs on the paths that use it. A migration, a mix task, a psql session, a second service or a bug all bypass it. The database constraint is what actually holds. You want both: validate in the app for UX, constrain in the database for truth. That is exactly why Ecto has `unique_constraint` alongside `validate_required`.",
      "The constraint vocabulary is small: PRIMARY KEY (identity), UNIQUE (no duplicates), NOT NULL (must be present), CHECK (an arbitrary boolean per row), FOREIGN KEY (must reference an existing row) with ON DELETE behaviour, and DEFAULT. Between them they encode most of what your domain considers impossible.",
      "Normalization is the other half of schema design, and the useful version is short: store each fact once, in the table it belongs to, and reference it by key. If a customer's email appears in the orders table, then changing it means updating many rows and any missed row is now wrong — that is an update anomaly. Third normal form is essentially 'every non-key column depends on the key, the whole key, and nothing but the key'. Denormalise later, deliberately, for measured performance reasons — and know that you are trading correctness for speed.",
      "One more caution specific to SQLite: `ALTER TABLE` is limited. You can add a column and rename things, but you cannot drop arbitrary constraints. The standard workaround is the twelve-step dance in the SQLite docs — create a new table, copy, drop, rename — inside a transaction.",
    ],
    diagram: `flowchart TB
  worst["⚠⚠ SQLITE'S WORST DEFAULT<br/>PRAGMA foreign_keys      → 0   ← OFF. Every. New. Connection.<br/>PRAGMA foreign_keys = ON       ← you must do this yourself<br/>without it, REFERENCES is documentation, not enforcement 😱"]:::bad
  worst --> vocab["THE CONSTRAINT VOCABULARY<br/>PRIMARY KEY — identity · implies UNIQUE + NOT NULL<br/>UNIQUE      — no duplicates · can span columns · NULLs are distinct<br/>NOT NULL    — must be present<br/>CHECK (expr) — any boolean, evaluated per row<br/>DEFAULT     — the value when the column is omitted<br/>FOREIGN KEY — must reference an existing row<br/>  ON DELETE CASCADE / RESTRICT / SET NULL"]:::hot
  vocab --> both
  subgraph both["VALIDATE IN THE APP + CONSTRAIN IN THE DATABASE"]
    direction LR
    app["a changeset gives GOOD MESSAGES<br/>but runs only on the paths that use it"]:::warn
    dbc["a constraint is the actual GUARANTEE<br/>migrations, mix tasks, psql, other services<br/>and your own bugs all still have to pass it ← the truth"]:::ok
  end
  both --> norm["NORMALIZATION, the useful version: store each fact ONCE<br/>✗ orders(id, user_email, user_country, total) — the email is in every row<br/>  change an email ⇒ update N rows ⇒ miss one ⇒ an inconsistency<br/>✓ users(id, email, country) + orders(id, user_id, total)<br/>  one fact, one place, referenced by key"]:::hot
  norm --> nf["1NF atomic columns · 2NF no partial-key dependency · 3NF no transitive dependency<br/>denormalise LATER, deliberately, with a measurement in hand<br/><br/>⚠ SQLite ALTER TABLE is limited to ADD COLUMN and RENAME.<br/>To change constraints: create new → copy → drop → rename, inside a transaction."]:::warn`,
    takeaway:
      "Turn foreign keys ON on every connection. Validate in the app for messages, constrain in the database for truth.",
  },
  codeSamples: [
    {
      title: "See foreign keys not working",
      note: "Then turn them on and watch the difference.",
      code: `PRAGMA foreign_keys;                 -- 0  ← OFF

CREATE TEMP TABLE parents (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TEMP TABLE children (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
INSERT INTO parents VALUES (1, 'p1');

INSERT INTO children VALUES (1, 9999, 'orphan');   -- ✓ accepted 😱
SELECT * FROM children;

DELETE FROM children;
PRAGMA foreign_keys = ON;

INSERT INTO children VALUES (1, 9999, 'orphan');
-- Runtime error: FOREIGN KEY constraint failed ✓

INSERT INTO children VALUES (1, 1, 'real');
DELETE FROM parents WHERE id = 1;
SELECT count(*) AS remaining_children FROM children;   -- 0, cascaded ✓`,
    },
    {
      title: "A fully constrained schema",
      note: "Every rule the domain considers impossible, encoded.",
      code: `PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS subscriptions;

CREATE TABLE subscriptions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan         TEXT    NOT NULL,
  price_cents  INTEGER NOT NULL,
  seats        INTEGER NOT NULL DEFAULT 1,
  status       TEXT    NOT NULL DEFAULT 'active',
  started_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,

  CHECK (plan   IN ('free','pro','enterprise')),
  CHECK (status IN ('active','paused','cancelled')),
  CHECK (price_cents >= 0),
  CHECK (seats BETWEEN 1 AND 1000),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (plan <> 'free' OR price_cents = 0)          -- cross-column rule
) STRICT;

-- one active subscription per user — a partial unique index
CREATE UNIQUE INDEX subs_one_active
  ON subscriptions(user_id) WHERE status = 'active';

INSERT INTO subscriptions (user_id, plan, price_cents) VALUES (1,'pro',2900);
-- INSERT INTO subscriptions (user_id, plan, price_cents) VALUES (1,'pro',900);
--   ⇒ UNIQUE constraint failed ✓ (already has an active one)
-- INSERT INTO subscriptions (user_id, plan, price_cents) VALUES (1,'free',500);
--   ⇒ CHECK constraint failed ✓ (free plans must be 0)`,
    },
    {
      title: "Normalization, shown as an anomaly",
      note: "Why duplicated facts rot.",
      code: `-- ✗ denormalised: the email is repeated in every order
CREATE TEMP TABLE bad_orders (id INTEGER PRIMARY KEY, user_email TEXT, total INTEGER);
INSERT INTO bad_orders VALUES (1,'ada@x.dev',100),(2,'ada@x.dev',200),(3,'ada@x.dev',300);

-- Ada changes her email. Miss one row and the data is now inconsistent:
UPDATE bad_orders SET user_email = 'ada@new.dev' WHERE id IN (1,2);   -- oops
SELECT DISTINCT user_email FROM bad_orders;     -- two emails for one person 😱

-- ✓ normalised: the fact lives in exactly one place
UPDATE users SET email = 'ada@new.dev' WHERE id = 1;   -- one row, always correct
SELECT o.id, u.email FROM orders o JOIN users u ON u.id = o.user_id;`,
    },
    {
      title: "Changing a schema in SQLite",
      note: "The documented rewrite dance, in a transaction.",
      code: `-- ADD COLUMN is easy
ALTER TABLE orders ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE orders RENAME COLUMN placed_at TO ordered_at;

-- changing or dropping a CONSTRAINT requires a rewrite:
PRAGMA foreign_keys = OFF;
BEGIN;
  CREATE TABLE orders_new (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    ordered_at TEXT NOT NULL DEFAULT (datetime('now'))
  ) STRICT;

  INSERT INTO orders_new (id, user_id, status, total_cents, currency, ordered_at)
    SELECT id, user_id, status, total_cents, currency, ordered_at FROM orders;

  DROP TABLE orders;
  ALTER TABLE orders_new RENAME TO orders;

  CREATE INDEX orders_user_idx ON orders(user_id);
COMMIT;
PRAGMA foreign_key_check;      -- verify nothing was orphaned
PRAGMA foreign_keys = ON;`,
    },
  ],
};
