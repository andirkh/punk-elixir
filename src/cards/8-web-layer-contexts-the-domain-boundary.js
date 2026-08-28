export default {
  front:
    "Phoenix generates `lib/shop/accounts.ex`. What is it for, and what is the single rule that makes contexts worth having?",
  back: "A **context** is a module that is the public API of one part of your domain: `Accounts.register_user/1`, `Orders.place_order/2`. The rule: nothing outside the context may touch its schemas or Repo directly. Controllers, channels, background jobs and tests all go through the context. That single constraint is what lets you change the database without touching the web layer.",
  philosophy: {
    lead: "Contexts are Phoenix's answer to the question every growing codebase eventually asks: where does the business logic go?",
    body: [
      "Without them, Ecto queries spread into controllers, then into views, then into background jobs, and every schema change becomes a search-and-replace across the app. With them, the context is a seam: it owns its schemas, its queries and its invariants, and exposes verbs that make sense to a product person. `Orders.place_order/2` can validate stock, charge a card, insert rows in a transaction and broadcast an event — the controller never knows.",
      "Design them around language, not tables. `Accounts`, `Orders`, `Billing`, `Notifications` are contexts; `UserContext` and `OrderContext` are just tables with a suffix. Two contexts may both have a User-shaped concept with different fields, and that is healthy — `Accounts.User` cares about passwords, `Billing.Customer` cares about payment methods.",
      "The return-value convention ties back to card 22: contexts return `{:ok, thing}` / `{:error, reason}` so controllers can use `with` and `action_fallback`. And because a context is a plain module of plain functions, you can test your entire domain with no HTTP, no browser and no mocks.",
    ],
    diagram: `flowchart TB
  subgraph delivery["shop_web — DELIVERY"]
    direction LR
    w1["controllers"]:::hot
    w2["channels"]:::hot
    w3["plugs"]:::hot
    w4["LiveViews"]:::hot
    w5["mix tasks"]:::hot
  end
  delivery -->|ONLY through context functions| contexts
  subgraph contexts["the CONTEXTS — your public domain API"]
    direction LR
    c1["Shop.Accounts<br/>register_user/1<br/>authenticate/2"]:::ok
    c2["Shop.Orders<br/>place_order/2<br/>fetch_order/2"]:::ok
    c3["Shop.Billing<br/>charge/2<br/>refund/1"]:::ok
  end
  contexts -->|private to the context| guts
  subgraph guts["schemas and the repo"]
    direction LR
    g1["Accounts.User"]:::muted
    g2["Orders.Order"]:::muted
    g3["Orders.Item"]:::muted
    g4["Shop.Repo"]:::muted
  end
  guts --> rule["THE RULE — no Repo call and no schema struct escapes its context.<br/>(Ecto.Changeset structs crossing into the web layer are fine —<br/>that is how form and JSON error rendering works.)"]:::warn
  rule --> naming["NAME THEM AFTER THE DOMAIN, NOT THE TABLES<br/>✓ Accounts, Orders, Billing, Notifications, Inventory<br/>✗ UserContext, OrderContext, DataAccessLayer<br/><br/>return {:ok, _} ¦ {:error, _} so with + action_fallback compose<br/>mix phx.gen.json Orders Order orders total_cents:integer status:string"]:::code`,
    takeaway:
      "One module is the front door to one part of the domain. Nothing bypasses it.",
  },
  codeSamples: [
    {
      title: "A real context",
      note: "lib/shop/orders.ex — note there is no HTTP anywhere.",
      code: `defmodule Shop.Orders do
  @moduledoc "The Orders domain. The only public way to touch orders."

  import Ecto.Query, warn: false
  alias Shop.Repo
  alias Shop.Orders.{Order, Item}
  alias Shop.Accounts.User

  # ---------- reads ----------
  def list_orders(%User{id: user_id}, params \\\\ %{}) do
    Order
    |> where([o], o.user_id == ^user_id)
    |> filter_by_status(params["status"])
    |> order_by([o], desc: o.inserted_at)
    |> limit(^min(String.to_integer(params["limit"] || "50"), 100))
    |> preload(:items)
    |> Repo.all()
  end

  def fetch_order(%User{id: user_id}, id) do
    case Repo.get_by(Order, id: id, user_id: user_id) |> Repo.preload(:items) do
      nil -> {:error, :not_found}
      order -> {:ok, order}
    end
  end

  # ---------- writes ----------
  def create_order(%User{} = user, attrs) do
    %Order{user_id: user.id}
    |> Order.changeset(attrs)
    |> Repo.insert()
    |> broadcast(:order_created)
  end

  def update_order(%Order{} = order, attrs) do
    order |> Order.changeset(attrs) |> Repo.update()
  end

  def delete_order(%Order{} = order), do: Repo.delete(order)

  def change_order(%Order{} = order, attrs \\\\ %{}), do: Order.changeset(order, attrs)

  # ---------- private ----------
  defp filter_by_status(query, nil), do: query
  defp filter_by_status(query, status), do: where(query, [o], o.status == ^status)

  defp broadcast({:ok, order} = ok, event) do
    Phoenix.PubSub.broadcast(Shop.PubSub, "orders:#{order.user_id}", {event, order})
    ok
  end
  defp broadcast({:error, _} = err, _event), do: err
end`,
    },
    {
      title: "Cross-context orchestration",
      note: "One context may call another — through its public API only.",
      code: `defmodule Shop.Checkout do
  alias Shop.{Orders, Billing, Notifications, Inventory}

  @doc "Places an order end to end. Returns {:ok, order} | {:error, reason}."
  def place(user, cart_params) do
    with {:ok, :available}  <- Inventory.reserve(cart_params["items"]),
         {:ok, order}       <- Orders.create_order(user, cart_params),
         {:ok, _charge}     <- Billing.charge(user, order.total_cents),
         {:ok, order}       <- Orders.update_order(order, %{"status" => "paid"}) do
      Notifications.order_confirmed(user, order)
      {:ok, order}
    else
      {:error, :out_of_stock} = err ->
        err
      {:error, %Ecto.Changeset{}} = err ->
        err
      {:error, reason} ->
        Inventory.release(cart_params["items"])
        {:error, reason}
    end
  end
end`,
    },
    {
      title: "Testing the domain with no web layer",
      note: "This is the payoff.",
      code: `defmodule Shop.OrdersTest do
  use Shop.DataCase, async: true
  alias Shop.Orders

  test "create_order/2 persists and returns the order" do
    user = Shop.AccountsFixtures.user_fixture()
    assert {:ok, order} = Orders.create_order(user, %{"total_cents" => 1500})
    assert order.user_id == user.id
    assert order.total_cents == 1500
  end

  test "create_order/2 rejects a negative total" do
    user = Shop.AccountsFixtures.user_fixture()
    assert {:error, changeset} = Orders.create_order(user, %{"total_cents" => -1})
    assert "must be greater than or equal to 0" in errors_on(changeset).total_cents
  end

  test "fetch_order/2 does not leak other users orders" do
    a = Shop.AccountsFixtures.user_fixture()
    b = Shop.AccountsFixtures.user_fixture()
    {:ok, order} = Orders.create_order(a, %{"total_cents" => 100})
    assert {:error, :not_found} = Orders.fetch_order(b, order.id)
  end
end`,
    },
    {
      title: "Generators that scaffold the whole slice",
      note: "",
      code: `# generates context + schema + migration + JSON controller + view + tests
mix phx.gen.json Orders Order orders total_cents:integer status:string user_id:references:users

# context + schema only (no web layer)
mix phx.gen.context Inventory Item items sku:string:unique qty:integer

# add a function to an EXISTING context — just edit the file;
# generators are a starting point, not a framework requirement.`,
    },
  ],
};
