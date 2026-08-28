export default {
  front:
    "You need to add an index to a 50-million-row table without locking writes. What does the migration look like, and what makes it safe?",
  back: "`create index(:orders, [:user_id], concurrently: true)` plus `@disable_ddl_transaction true` and `@disable_migration_lock true` — because `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Migrations are versioned, ordered Elixir modules with `up`/`down` (or a reversible `change`), run by `mix ecto.migrate`, tracked in a `schema_migrations` table.",
  philosophy: {
    lead: "Migrations are code that runs against a live production database, so they deserve the same care as any deploy step — more, because they are hard to undo.",
    body: [
      "Ecto wraps each migration in a transaction and takes an advisory lock so two nodes deploying simultaneously cannot both run it. That default is right almost always, and the exceptions (concurrent indexes, some ALTERs) are exactly the ones that need the escape hatches above.",
      "The rule that prevents most incidents: never write a migration that breaks the currently running code. Deploys are not atomic — old and new code run at the same time. So adding a NOT NULL column with no default, or renaming a column, will break the version still serving traffic. Split it: add nullable, backfill, deploy code that writes both, then add the constraint, then drop the old column. Boring, and it never causes an outage.",
      "Backfills belong in their own migration or a separate task, batched, so you do not hold a transaction open over millions of rows. And always define `down` (or use reversible `change`) so a bad deploy can be rolled back.",
    ],
    diagram: `flowchart TB
  file0["priv/repo/migrations/20260828120000_create_orders.exs<br/>                     └── the timestamp IS the version, and they run in order<br/><br/>the schema_migrations table records which versions have run"]:::code
  file0 --> cmds["mix ecto.gen.migration create_orders     mix ecto.migrate<br/>mix ecto.rollback                        mix ecto.migrations<br/>mix ecto.migrate --step 1                mix ecto.reset"]:::hot
  cmds --> lock["EACH MIGRATION RUNS IN A TRANSACTION + AN ADVISORY LOCK<br/>two nodes deploying at once ⇒ only one of them runs it ✓<br/>escape hatches when you need them:<br/>@disable_ddl_transaction true · @disable_migration_lock true"]:::ok
  lock --> atomic["⚠ DEPLOYS ARE NOT ATOMIC — old and new code run SIMULTANEOUSLY<br/>✗ add a NOT NULL column   ✗ rename a column   ✗ drop a column now"]:::bad
  atomic --> s1
  subgraph safe["✓ THE SAFE SEQUENCE"]
    direction TB
    s1["1. add a NULLABLE column — old code is unaffected"]:::ok
    s2["2. deploy code that writes BOTH"]:::ok
    s3["3. backfill in batches"]:::ok
    s4["4. add the NOT NULL constraint"]:::ok
    s5["5. deploy code that reads the NEW column only"]:::ok
    s6["6. drop the old column — in a LATER deploy"]:::ok
    s1 --> s2 --> s3 --> s4 --> s5 --> s6
  end
  s6 --> big["BIG TABLES<br/>create index(..., concurrently: true) + @disable_ddl_transaction<br/>backfill in batches of ~1000, not one giant UPDATE"]:::warn`,
    takeaway:
      "Versioned, transactional, locked. Never break the code that is currently running.",
  },
  codeSamples: [
    {
      title: "A normal migration",
      note: "mix ecto.gen.migration create_orders",
      code: `defmodule Shop.Repo.Migrations.CreateOrders do
  use Ecto.Migration

  def change do
    create table(:orders) do
      add :user_id, references(:users, on_delete: :delete_all), null: false
      add :status, :string, null: false, default: "pending"
      add :total_cents, :integer, null: false, default: 0
      add :metadata, :map, default: %{}
      add :placed_at, :utc_datetime_usec

      timestamps(type: :utc_datetime_usec)
    end

    create index(:orders, [:user_id])
    create index(:orders, [:status])
    create index(:orders, [:user_id, :inserted_at])

    create table(:order_items) do
      add :order_id, references(:orders, on_delete: :delete_all), null: false
      add :sku, :string, null: false
      add :qty, :integer, null: false, default: 1
      add :price_cents, :integer, null: false
      timestamps(type: :utc_datetime_usec)
    end

    create index(:order_items, [:order_id])
    create unique_index(:order_items, [:order_id, :sku])

    create constraint(:orders, :total_non_negative, check: "total_cents >= 0")
  end
end`,
    },
    {
      title: "A concurrent index on a huge table",
      note: "The two attributes are mandatory here.",
      code: `defmodule Shop.Repo.Migrations.AddOrdersStatusIndexConcurrently do
  use Ecto.Migration

  @disable_ddl_transaction true
  @disable_migration_lock true

  def up do
    create index(:orders, [:status, :inserted_at], concurrently: true)
  end

  def down do
    drop index(:orders, [:status, :inserted_at], concurrently: true)
  end
end`,
    },
    {
      title: "The safe multi-step column change",
      note: "Three separate migrations across three deploys.",
      code: `# --- deploy 1: add nullable ---
defmodule Shop.Repo.Migrations.AddCurrencyToOrders do
  use Ecto.Migration
  def change do
    alter table(:orders) do
      add :currency, :string, size: 3
    end
  end
end

# --- deploy 2: backfill in batches (after code writes both) ---
defmodule Shop.Repo.Migrations.BackfillOrdersCurrency do
  use Ecto.Migration
  import Ecto.Query
  @disable_ddl_transaction true
  @disable_migration_lock true

  def up do
    repo = Shop.Repo
    batch = fn ->
      from(o in "orders", where: is_nil(o.currency), select: o.id, limit: 1_000)
      |> repo.all()
      |> case do
        [] -> :done
        ids ->
          from(o in "orders", where: o.id in ^ids) |> repo.update_all(set: [currency: "USD"])
          :more
      end
    end

    Stream.repeatedly(batch)
    |> Enum.find(&(&1 == :done))
  end

  def down, do: :ok
end

# --- deploy 3: enforce ---
defmodule Shop.Repo.Migrations.RequireOrdersCurrency do
  use Ecto.Migration
  def change do
    alter table(:orders) do
      modify :currency, :string, null: false, from: {:string, null: true}
    end
  end
end`,
    },
    {
      title: "Everyday commands",
      note: "",
      code: `mix ecto.gen.migration add_status_to_orders
mix ecto.migrate
mix ecto.migrations            # which have run
mix ecto.rollback              # undo the last one
mix ecto.rollback --to 20260101000000
mix ecto.reset                 # drop + create + migrate + seed (dev only!)

# in a release (no Mix available), use a release task:
# Shop.Release.migrate()`,
    },
  ],
};
