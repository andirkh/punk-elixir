export default {
  front:
    "You list 100 orders and render each order's items. Why might that fire 101 queries, and what are your two ways out?",
  back: "Accessing `order.items` per order is the classic N+1 — except Ecto refuses to do it silently, giving you `NotLoaded`. Fix it with `preload(:items)`, which runs ONE extra query (`WHERE order_id IN (...)`) and is usually what you want, or with `join` + `preload` in a single query when you also need to filter on the association. `Repo.preload/2` does the same after the fact.",
  philosophy: {
    lead: "Ecto makes the number of queries visible in your code, which is the whole reason it refuses to lazy-load.",
    body: [
      "Two preloads, two strategies. Separate-query preload (`preload(:items)`) issues a second query with an `IN` clause. It is efficient, avoids row multiplication, and is the right default. Join-preload (`join: i in assoc(o, :items), preload: [items: i]`) fetches everything in one query — necessary when you filter or order by the association, but it multiplies rows for has_many, so a query returning 100 orders with 10 items each returns 1000 rows.",
      "The association macros describe where the foreign key lives: `belongs_to` on the side holding the key, `has_many`/`has_one` on the other, `many_to_many` through a join table, and `has_many :through` to reach across two hops. Getting the direction right is most of the battle.",
      "`Ecto.Multi` and `cast_assoc`/`put_assoc` let you insert a parent with children in one changeset, which is how you accept a nested JSON payload. Use `cast_assoc` when the children come from user params, and `put_assoc` when you already have structs.",
    ],
    diagram: `flowchart TB
  shape["users 1 ──&lt; orders 1 ──&lt; order_items ≥──&lt; via a join table"]:::hot
  shape --> kinds["belongs_to :user — the schema holding the FOREIGN KEY<br/>has_many :items — the schema on the OTHER side<br/>has_one :profile<br/>many_to_many …, join_through: '...'<br/>has_many :skus, through: [:items, :sku]"]:::code
  kinds --> nplus1["N+1 — what other ORMs do SILENTLY<br/>SELECT * FROM orders                      (1)<br/>SELECT * FROM items WHERE order_id = 1<br/>SELECT * FROM items WHERE order_id = 2<br/>… 100 more"]:::bad
  nplus1 --> ecto["ECTO gives you NotLoaded instead, so you MUST choose"]:::hot
  ecto --> optA["A) preload(:items) — 2 queries<br/>SELECT * FROM orders<br/>SELECT * FROM items WHERE order_id IN (…) ✓"]:::ok
  ecto --> optB["B) join + preload — 1 query<br/>…but the rows multiply:<br/>100 orders × 10 items = 1000 rows"]:::warn
  optA --> rule["USE preload — almost always<br/>USE join + preload — when you FILTER or ORDER by the association"]:::hot
  optB --> rule
  rule --> api["Repo.preload(orders, [items: :product, user: []])   ← after the fact<br/>Ecto.assoc(user, :orders)                          ← a query from a struct"]:::code`,
    takeaway:
      "Ecto never lazy-loads. Preload with a second query by default; join-preload when you must filter on it.",
  },
  codeSamples: [
    {
      title: "Declare the associations",
      note: "",
      code: `defmodule Shop.Accounts.User do
  use Ecto.Schema
  schema "users" do
    field :email, :string
    has_many :orders, Shop.Orders.Order
    has_one  :profile, Shop.Accounts.Profile
    has_many :order_items, through: [:orders, :items]
    many_to_many :groups, Shop.Accounts.Group, join_through: "users_groups"
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule Shop.Orders.Order do
  use Ecto.Schema
  schema "orders" do
    field :status, Ecto.Enum, values: [:pending, :paid]
    field :total_cents, :integer
    belongs_to :user, Shop.Accounts.User          # this table holds user_id
    has_many :items, Shop.Orders.Item, on_replace: :delete
    timestamps(type: :utc_datetime_usec)
  end
end

defmodule Shop.Orders.Item do
  use Ecto.Schema
  schema "order_items" do
    field :sku, :string
    field :qty, :integer
    field :price_cents, :integer
    belongs_to :order, Shop.Orders.Order          # this table holds order_id
    timestamps(type: :utc_datetime_usec)
  end
end`,
    },
    {
      title: "See the N+1 and both fixes",
      note: "Watch the SQL in your dev logs as you run each.",
      code: `import Ecto.Query
alias Shop.{Repo, Orders.Order}

# 1. the accident Ecto prevents
orders = Repo.all(from o in Order, limit: 100)
hd(orders).items        # #Ecto.Association.NotLoaded<:items>  ← no silent query

# 2. preload: 2 queries total ✓ (the default choice)
orders = Repo.all(from o in Order, limit: 100, preload: [:items])
hd(orders).items

# equivalent, after the fact:
orders = Repo.all(from o in Order, limit: 100) |> Repo.preload([:items, :user])

# 3. join + preload: 1 query, but rows multiply
orders =
  from(o in Order,
    join: i in assoc(o, :items),
    where: i.qty > 1,                      # ← filtering on the association
    preload: [items: i],
    limit: 100
  )
  |> Repo.all()

# nested preloads
Repo.all(from o in Order, preload: [:user, items: :order], limit: 5)

# preload with a custom query (e.g. only expensive items, newest first)
expensive = from i in Shop.Orders.Item, where: i.price_cents > 1_000, order_by: [desc: i.price_cents]
Repo.all(from o in Order, preload: [items: ^expensive], limit: 5)`,
    },
    {
      title: "Nested inserts from a JSON payload",
      note: "cast_assoc handles the children.",
      code: `defmodule Shop.Orders.Order do
  # … schema as above …
  import Ecto.Changeset

  def changeset(order, attrs) do
    order
    |> cast(attrs, [:status, :total_cents])
    |> cast_assoc(:items, with: &Shop.Orders.Item.changeset/2, required: true)
    |> validate_required([:total_cents])
  end
end

defmodule Shop.Orders.Item do
  import Ecto.Changeset
  def changeset(item, attrs) do
    item
    |> cast(attrs, [:sku, :qty, :price_cents])
    |> validate_required([:sku, :qty, :price_cents])
    |> validate_number(:qty, greater_than: 0)
  end
end

attrs = %{
  "total_cents" => 3000,
  "items" => [
    %{"sku" => "BOOK-1", "qty" => 2, "price_cents" => 1000},
    %{"sku" => "PEN-9",  "qty" => 1, "price_cents" => 1000}
  ]
}

%Shop.Orders.Order{user_id: 1}
|> Shop.Orders.Order.changeset(attrs)
|> Shop.Repo.insert()      # parent + children in ONE transaction ✓`,
    },
    {
      title: "Queries from a struct",
      note: "Ecto.assoc builds the scoped query for you.",
      code: `import Ecto.Query
alias Shop.Repo

user = Repo.get!(Shop.Accounts.User, 1)

Ecto.assoc(user, :orders) |> Repo.all()
Ecto.assoc(user, :orders) |> where([o], o.status == :paid) |> Repo.aggregate(:count)
Ecto.assoc(user, [:orders, :items]) |> Repo.all()

# has_many :through in a query
from(u in Shop.Accounts.User, where: u.id == ^1, preload: [:order_items])
|> Repo.one()`,
    },
  ],
};
