export default {
  front:
    "Placing an order must insert an order, insert items, decrement stock and record a payment — all or nothing. What do you reach for, and why not a plain `Repo.transaction(fn -> ... end)`?",
  back: "`Ecto.Multi`. You NAME each step and build the whole operation as a data structure, then run it once. On failure you get `{:error, failed_step_name, failed_value, changes_so_far}` — you know exactly which step failed and what had already succeeded. A function transaction only tells you it rolled back; a Multi tells you the story, and it is composable and testable without a database.",
  philosophy: {
    lead: "Ecto.Multi turns a transaction from a block of imperative code into a value you can build, inspect, compose and test.",
    body: [
      "The named-step error tuple is the practical win. In a controller you can pattern-match `{:error, :payment, %Stripe.Error{}, _}` and return a different status than `{:error, :order, %Changeset{}, _}` — no parsing of exception messages, no ambiguity. And because a Multi is just data, one context can build a partial Multi and another can append to it.",
      "`Multi.run/3` is the escape hatch for steps that are not Repo operations: call an external API, compute something, check an invariant. It must return `{:ok, value}` or `{:error, value}`, and returning an error rolls the whole transaction back. That is how you keep a payment charge and a database write consistent.",
      "Two things to remember about transactions on Postgres. First, they hold a connection from the pool for their entire duration (card 79), so never put a slow HTTP call inside one if you can avoid it — do the external call first, or use an idempotency key and reconcile. Second, `Repo.rollback/1` inside a function transaction returns your value from `Repo.transaction/1` as `{:error, value}`, which is the manual equivalent.",
    ],
    diagram: `flowchart TB
  multi["Ecto.Multi.new()<br/>¦&gt; Ecto.Multi.insert(:order, order_changeset)        ← NAMED steps<br/>¦&gt; Ecto.Multi.insert_all(:items, Item, items_fun)<br/>¦&gt; Ecto.Multi.update_all(:stock, stock_query, inc: [qty: -1])<br/>¦&gt; Ecto.Multi.run(:payment, fn _repo, changes -&gt; Billing.charge(...) end)<br/>¦&gt; Ecto.Multi.run(:notify, fn _repo, changes -&gt; … end)<br/>¦&gt; Repo.transaction()"]:::code
  multi --> okp["SUCCESS<br/>{:ok, %{order: %Order{}, items: {2, nil}, payment: %{id: 'ch_1'},<br/>        stock: {2, nil}, notify: :sent}}"]:::ok
  multi --> errp["FAILURE<br/>{:error, :payment, %Stripe.Error{code: :card_declined},<br/>        %{order: %Order{}, items: {2, nil}, stock: {2, nil}}}<br/>         WHICH step ¦ WHAT went wrong ¦ what had SUCCEEDED<br/>         — and all of it was rolled back"]:::bad
  okp --> d1
  errp --> d1
  subgraph data["a Multi is DATA, not control flow"]
    direction TB
    d1["Ecto.Multi.to_list(multi) — inspect it WITHOUT a database"]:::hot
    d2["Ecto.Multi.append / prepend — compose across contexts"]:::hot
    d3["Ecto.Multi.merge(fn changes -&gt; … end) — branch on earlier steps"]:::hot
    d1 ~~~ d2 ~~~ d3
  end
  d3 --> warn0["⚠ a transaction holds a POOL CONNECTION the whole time.<br/>Slow external calls inside one will starve your pool — card 79."]:::bad`,
    takeaway:
      "Multi names every step, tells you which one failed, and is composable data.",
  },
  codeSamples: [
    {
      title: "Checkout as a Multi",
      note: "The full pattern, including a non-Repo step.",
      code: `defmodule Shop.Checkout do
  alias Ecto.Multi
  alias Shop.{Repo, Orders.Order, Orders.Item}
  import Ecto.Query

  def place(user, %{"items" => item_params} = attrs) do
    Multi.new()
    |> Multi.insert(:order, Order.changeset(%Order{user_id: user.id}, attrs))
    |> Multi.insert_all(:items, Item, fn %{order: order} ->
         now = DateTime.utc_now()
         for i <- item_params do
           %{order_id: order.id, sku: i["sku"], qty: i["qty"],
             price_cents: i["price_cents"], inserted_at: now, updated_at: now}
         end
       end)
    |> Multi.update_all(:reserve_stock, fn _changes ->
         skus = Enum.map(item_params, & &1["sku"])
         from(s in "stock", where: s.sku in ^skus and s.qty > 0)
       end, inc: [qty: -1])
    |> Multi.run(:charge, fn _repo, %{order: order} ->
         Shop.Billing.charge(user, order.total_cents)
       end)
    |> Multi.run(:mark_paid, fn repo, %{order: order} ->
         order |> Ecto.Changeset.change(status: :paid) |> repo.update()
       end)
    |> Repo.transaction()
    |> case do
         {:ok, %{mark_paid: order}} -> {:ok, order}
         {:error, :charge, reason, _done} -> {:error, {:payment_failed, reason}}
         {:error, :order, changeset, _done} -> {:error, changeset}
         {:error, step, reason, _done} -> {:error, {step, reason}}
       end
  end
end`,
    },
    {
      title: "Inspect a Multi without a database",
      note: "It is just data — that is the point.",
      code: `alias Ecto.Multi

multi =
  Multi.new()
  |> Multi.insert(:a, %Shop.Orders.Order{total_cents: 100})
  |> Multi.run(:b, fn _repo, %{a: a} -> {:ok, a.total_cents * 2} end)
  |> Multi.run(:c, fn _repo, _ -> {:error, :nope} end)

Multi.to_list(multi) |> Enum.map(fn {name, {kind, _, _}} -> {name, kind} end)

# compose across contexts:
other = Multi.new() |> Multi.run(:audit, fn _r, _c -> {:ok, :logged} end)
Multi.append(multi, other) |> Multi.to_list() |> Enum.map(&elem(&1, 0))`,
    },
    {
      title: "Plain function transactions and rollback",
      note: "Simpler for two steps; you lose the named errors.",
      code: `alias Shop.Repo

Repo.transaction(fn ->
  {:ok, order} = Repo.insert(%Shop.Orders.Order{user_id: 1, total_cents: 500})

  case Shop.Billing.charge_stub(order) do
    {:ok, charge} -> %{order: order, charge: charge}
    {:error, reason} -> Repo.rollback({:payment, reason})   # ← returns {:error, ...}
  end
end)

# nested transactions become SAVEPOINTs when you ask for them:
Repo.transaction(fn ->
  Repo.insert!(%Shop.Orders.Order{user_id: 1, total_cents: 1})
  Repo.transaction(fn -> Repo.rollback(:inner) end)   # rolls back everything
end)`,
    },
    {
      title: "Locking and isolation",
      note: "When two requests race for the same row.",
      code: `import Ecto.Query
alias Shop.Repo

# SELECT ... FOR UPDATE — serialise concurrent updates to one row
Repo.transaction(fn ->
  stock =
    from(s in "stock", where: s.sku == ^"BOOK-1", select: %{id: s.id, qty: s.qty}, lock: "FOR UPDATE")
    |> Repo.one()

  if stock.qty > 0 do
    from(s in "stock", where: s.id == ^stock.id) |> Repo.update_all(inc: [qty: -1])
    {:ok, :reserved}
  else
    Repo.rollback(:out_of_stock)
  end
end)

# upsert — let Postgres resolve the race instead
Repo.insert_all("counters", [%{key: "views", n: 1}],
  on_conflict: [inc: [n: 1]],
  conflict_target: [:key]
)

# stronger isolation when you need it
# Repo.transaction(fn -> ... end, isolation: :serializable)`,
    },
  ],
};
