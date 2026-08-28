export default {
  front:
    "An Ecto schema looks like a table definition. Why is it better to think of it as a data-shape declaration instead?",
  back: "Because a schema is just a struct plus a mapping between Elixir types and database columns — and you can have several schemas over one table, a schema over a query result, or an `embedded_schema` with no table at all. `Repo` uses the mapping; nothing forces one schema per table. That freedom is how you build read models and validate API params without polluting your write model.",
  philosophy: {
    lead: "A schema declares a shape and its types. The table is only one of the places that shape can come from.",
    body: [
      "The single-schema-per-table habit comes from ORMs and it causes bloated modules with twelve changeset functions. Ecto lets you write `Accounts.User` for the full record and `Accounts.UserProfile` for the three fields the public API exposes, both reading `users`. Queries can also select into any schema or into a plain map, so read models are cheap.",
      "`embedded_schema` deserves special attention for backends: it gives you a struct with types and changeset validation but no table. That is the clean way to validate incoming JSON — define the expected shape, cast the params, get typed data or a changeset full of errors — without inventing a database table for a search filter.",
      "The type list matters in practice: `:utc_datetime_usec` for timestamps (always store UTC), `:decimal` for money if you must use fractional currency (or, better, integer cents), `:map` and `{:array, :string}` map to jsonb and Postgres arrays, and `Ecto.Enum` gives you atoms in Elixir backed by a string or integer column.",
    ],
    diagram: `flowchart TB
  sch["defmodule Shop.Orders.Order do<br/>  use Ecto.Schema<br/>  @primary_key {:id, :binary_id, autogenerate: true}<br/>  schema 'orders' do                 ← the table name, or none if embedded<br/>    field :status, Ecto.Enum, values: [:pending, :paid, :refunded]<br/>    field :total_cents, :integer, default: 0<br/>    field :metadata, :map<br/>    field :tags, {:array, :string}<br/>    field :placed_at, :utc_datetime_usec<br/>    field :card_number, :string, virtual: true, redact: true<br/>    belongs_to :user, Shop.Accounts.User<br/>    has_many :items, Shop.Orders.Item<br/>    timestamps(type: :utc_datetime_usec)<br/>  end<br/>end"]:::code
  sch --> plain["⇒ %Order{} is a PLAIN STRUCT.<br/>The Repo is what maps its fields to columns."]:::hot
  plain --> m1
  subgraph multi["ONE TABLE, MANY SCHEMAS — perfectly legal and often right"]
    direction TB
    m1["Accounts.User — the full record, the WRITE model"]:::ok
    m2["Accounts.UserSummary — 3 fields, a READ model for a list endpoint"]:::ok
    m3["Accounts.UserRegistration — embedded, validates signup params"]:::ok
    m1 ~~~ m2 ~~~ m3
  end
  m3 --> emb["embedded_schema → struct + types + changesets, NO table<br/>ideal for validating JSON params and filters"]:::hot
  emb --> types["TYPES THAT MATTER<br/>:utc_datetime_usec — always UTC     :integer — cents, for money<br/>:decimal — exact fractions          :map → jsonb<br/>{:array, :string} — a Postgres array Ecto.Enum → atoms in Elixir<br/>virtual: true — never persisted, for passwords and confirmations<br/>redact: true — hidden from inspect and logs"]:::warn`,
    takeaway:
      "A schema is a typed struct mapped to columns. Many schemas per table is a feature, not a smell.",
  },
  codeSamples: [
    {
      title: "A full schema",
      note: "lib/shop/orders/order.ex",
      code: `defmodule Shop.Orders.Order do
  use Ecto.Schema
  import Ecto.Changeset

  @statuses [:pending, :paid, :shipped, :refunded, :cancelled]

  schema "orders" do
    field :status, Ecto.Enum, values: @statuses, default: :pending
    field :total_cents, :integer, default: 0
    field :currency, :string, default: "USD"
    field :metadata, :map, default: %{}
    field :tags, {:array, :string}, default: []
    field :placed_at, :utc_datetime_usec

    field :promo_code, :string, virtual: true          # never stored

    belongs_to :user, Shop.Accounts.User
    has_many :items, Shop.Orders.Item, on_replace: :delete

    timestamps(type: :utc_datetime_usec)
  end

  def statuses, do: @statuses

  def changeset(order, attrs) do
    order
    |> cast(attrs, [:status, :total_cents, :currency, :metadata, :tags, :promo_code])
    |> validate_required([:total_cents, :currency])
    |> validate_number(:total_cents, greater_than_or_equal_to: 0)
    |> validate_inclusion(:status, @statuses)
    |> validate_length(:currency, is: 3)
  end
end`,
    },
    {
      title: "embedded_schema for API params",
      note: "Validate untrusted JSON with no table involved.",
      code: `defmodule ShopWeb.OrderSearch do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key false
  embedded_schema do
    field :status, Ecto.Enum, values: [:pending, :paid, :shipped]
    field :min_cents, :integer
    field :max_cents, :integer
    field :from, :utc_datetime
    field :page, :integer, default: 1
    field :per_page, :integer, default: 25
  end

  def parse(params) do
    %__MODULE__{}
    |> cast(params, [:status, :min_cents, :max_cents, :from, :page, :per_page])
    |> validate_number(:page, greater_than: 0)
    |> validate_number(:per_page, greater_than: 0, less_than_or_equal_to: 100)
    |> validate_number(:min_cents, greater_than_or_equal_to: 0)
    |> apply_action(:validate)      # {:ok, struct} | {:error, changeset}
  end
end

ShopWeb.OrderSearch.parse(%{"status" => "paid", "per_page" => "10"})
ShopWeb.OrderSearch.parse(%{"per_page" => "5000"})
ShopWeb.OrderSearch.parse(%{"status" => "nonsense"})`,
    },
    {
      title: "Several schemas over one table",
      note: "A slim read model for list endpoints.",
      code: `defmodule Shop.Accounts.User do
  use Ecto.Schema
  schema "users" do
    field :email, :string
    field :password_hash, :string, redact: true
    field :role, Ecto.Enum, values: [:member, :admin], default: :member
    field :settings, :map, default: %{}
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule Shop.Accounts.UserSummary do
  use Ecto.Schema
  @primary_key {:id, :id, autogenerate: false}
  schema "users" do
    field :email, :string
    field :role, Ecto.Enum, values: [:member, :admin]
  end
end

# Repo.all(Shop.Accounts.UserSummary)
# SELECT id, email, role FROM users    ← never touches password_hash ✓`,
    },
    {
      title: "Inspect a schema",
      note: "Reflection functions are handy in iex.",
      code: `Shop.Orders.Order.__schema__(:fields)
Shop.Orders.Order.__schema__(:source)
Shop.Orders.Order.__schema__(:type, :total_cents)
Shop.Orders.Order.__schema__(:associations)
Shop.Orders.Order.__schema__(:primary_key)

%Shop.Orders.Order{}          # note items is NotLoaded, not []`,
    },
  ],
};
