export default {
  front:
    "Your test suite hits Postgres and runs with `async: true`. How do 8 tests share one database without corrupting each other?",
  back: "The **Ecto SQL Sandbox**. Each test process checks out its own database connection and runs inside a transaction that is rolled back at the end. Tests are therefore isolated, order-independent, and safe to run in parallel. `DataCase` sets this up for context tests, `ConnCase` for controllers, `ChannelCase` for websockets — and for external services you use `Mox` against a behaviour (card 26).",
  philosophy: {
    lead: "Elixir's test story is unusually good because the two hardest parts — isolating state and faking dependencies — both have first-class answers.",
    body: [
      "The sandbox is a genuinely clever use of process ownership. A connection is checked out and OWNED by the test process; anything that process spawns can be allowed access explicitly. That is why `async: true` works against a real database at all, and it means you almost never need fixtures files or a truncate-between-tests step.",
      "For external services, resist the urge to mock modules globally. Define a behaviour, implement a real adapter and a `Mox` mock, and select via config (card 26). Mox verifies expectations per test and works with `async: true` because expectations are process-scoped. The rule 'mock the boundary you own, not the library you imported' keeps tests from breaking every time a dependency changes shape.",
      "Aim your effort at the layer that gives the most confidence per line: context tests. They exercise real business logic against a real database with no HTTP, run fast, and rarely need changing when routes or serialisation change. Add controller tests for status codes and shape, and channel tests for realtime behaviour.",
    ],
    diagram: `flowchart TB
  subgraph sandbox["ONE POSTGRES DATABASE, 8 PARALLEL TESTS"]
    direction TB
    s1["test proc 1 → conn 1 → BEGIN … work … ROLLBACK ✓"]:::ok
    s2["test proc 2 → conn 2 → BEGIN … work … ROLLBACK ✓"]:::ok
    s3["test proc 3 → conn 3 → BEGIN … work … ROLLBACK ✓"]:::ok
    s1 ~~~ s2 ~~~ s3
  end
  s3 --> props["isolated · order-independent · no cleanup code · async: true ✓"]:::ok
  props --> spawn0["spawned a Task in the code under test? grant it access:<br/>Ecto.Adapters.SQL.Sandbox.allow(Repo, test_pid, task_pid)<br/>or use :shared mode for that test — and then async: false"]:::warn
  spawn0 --> c1
  subgraph cases["THE CASE TEMPLATES"]
    direction TB
    c1["Shop.DataCase — contexts and schemas · sandbox, errors_on/1"]:::hot
    c2["ShopWeb.ConnCase — controllers · build_conn/0, json_response/2"]:::hot
    c3["ShopWeb.ChannelCase — channels · socket/2, assert_broadcast"]:::hot
    c4["ExUnit.Case — pure functions · no database at all"]:::hot
    c1 ~~~ c2 ~~~ c3 ~~~ c4
  end
  c4 --> mox["EXTERNAL SERVICES — Mox, against YOUR behaviour<br/>@callback charge(map) :: {:ok, map} ¦ {:error, term}<br/>Mox.defmock(Shop.MockGateway, for: Shop.Gateway)<br/>config :shop, :gateway, Shop.MockGateway        in test.exs<br/>expect(Shop.MockGateway, :charge, fn _ -&gt; {:ok, %{id: 'ch_1'}} end)<br/>⇒ process-scoped, verified on exit, async-safe"]:::code
  mox --> effort["WHERE TO SPEND EFFORT<br/>████████ contexts — real DB, real logic, fast<br/>████     controllers — status and shape<br/>███      channels — realtime behaviour<br/>██       end-to-end — few, slow, high value"]:::ok`,
    takeaway:
      "The sandbox transaction-isolates every test process. Test contexts hardest; mock only behaviours you own.",
  },
  codeSamples: [
    {
      title: "Sandbox setup",
      note: "test/support/data_case.ex + test_helper.exs — phx.new generates these.",
      code: `# config/test.exs
config :shop, Shop.Repo,
  database: "shop_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2

# test/test_helper.exs
ExUnit.start()
Ecto.Adapters.SQL.Sandbox.mode(Shop.Repo, :manual)

# test/support/data_case.ex
defmodule Shop.DataCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      alias Shop.Repo
      import Ecto
      import Ecto.Changeset
      import Ecto.Query
      import Shop.DataCase
    end
  end

  setup tags do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Shop.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
    :ok
  end

  def errors_on(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {message, opts} ->
      Regex.replace(~r"%{(\\w+)}", message, fn _, key ->
        opts |> Keyword.get(String.to_existing_atom(key), key) |> to_string()
      end)
    end)
  end
end`,
    },
    {
      title: "Context tests — where the value is",
      note: "Real database, real logic, async, fast.",
      code: `defmodule Shop.OrdersTest do
  use Shop.DataCase, async: true

  alias Shop.Orders
  import Shop.AccountsFixtures

  describe "create_order/2" do
    test "creates a valid order" do
      user = user_fixture()
      assert {:ok, order} = Orders.create_order(user, %{"total_cents" => 1500})
      assert order.total_cents == 1500
      assert order.status == :pending
    end

    test "rejects a negative total" do
      user = user_fixture()
      assert {:error, changeset} = Orders.create_order(user, %{"total_cents" => -1})
      assert %{total_cents: ["must be greater than or equal to 0"]} = errors_on(changeset)
    end
  end

  describe "authorisation" do
    test "fetch_order/2 scopes to the owner" do
      owner = user_fixture()
      other = user_fixture()
      {:ok, order} = Orders.create_order(owner, %{"total_cents" => 100})

      assert {:ok, _} = Orders.fetch_order(owner, order.id)
      assert {:error, :not_found} = Orders.fetch_order(other, order.id)
    end
  end
end

# test/support/fixtures/accounts_fixtures.ex
defmodule Shop.AccountsFixtures do
  def unique_email, do: "user#{System.unique_integer([:positive])}@example.com"

  def user_fixture(attrs \\\\ %{}) do
    {:ok, user} =
      attrs
      |> Enum.into(%{"email" => unique_email(), "password" => "correcthorsebattery"})
      |> Shop.Accounts.register()

    user
  end
end`,
    },
    {
      title: "Mox for external services",
      note: "Behaviour + mock + config swap. No library monkey-patching.",
      code: `# mix.exs: {:mox, "~> 1.1", only: :test}

# lib/shop/gateway.ex
defmodule Shop.Gateway do
  @callback charge(map()) :: {:ok, map()} | {:error, term()}
  @callback refund(String.t()) :: :ok | {:error, term()}
end

# lib/shop/billing.ex
defmodule Shop.Billing do
  defp impl, do: Application.get_env(:shop, :gateway, Shop.Gateway.Stripe)
  def charge(user, cents), do: impl().charge(%{user_id: user.id, amount: cents})
end

# test/support/mocks.ex
Mox.defmock(Shop.MockGateway, for: Shop.Gateway)

# config/test.exs
config :shop, :gateway, Shop.MockGateway

# the test
defmodule Shop.BillingTest do
  use Shop.DataCase, async: true
  import Mox

  setup :verify_on_exit!          # fails the test if expectations are unmet

  test "charges through the gateway" do
    expect(Shop.MockGateway, :charge, fn %{amount: 1500} ->
      {:ok, %{id: "ch_test_1"}}
    end)

    assert {:ok, %{id: "ch_test_1"}} = Shop.Billing.charge(%{id: 1}, 1500)
  end

  test "propagates a declined card" do
    expect(Shop.MockGateway, :charge, fn _ -> {:error, :card_declined} end)
    assert {:error, :card_declined} = Shop.Billing.charge(%{id: 1}, 1500)
  end
end`,
    },
    {
      title: "Testing processes, jobs and async code",
      note: "The tricky bits, each with its idiom.",
      code: `defmodule Shop.AsyncTest do
  use Shop.DataCase, async: true
  import Mox

  test "a spawned task can use the database" do
    parent = self()

    task = Task.async(fn ->
      # grant the task access to this test's sandbox connection
      Ecto.Adapters.SQL.Sandbox.allow(Shop.Repo, parent, self())
      Shop.Repo.aggregate(Shop.Orders.Order, :count)
    end)

    assert is_integer(Task.await(task))
  end

  test "an Oban job runs inline" do
    # config/test.exs:  config :shop, Oban, testing: :inline
    assert {:ok, _job} = Oban.insert(Shop.Workers.WelcomeEmail.new(%{user_id: 1}))
  end

  test "messages and timeouts" do
    Process.send_after(self(), :tick, 50)
    assert_receive :tick, 500
    refute_receive :tock, 100
  end

  test "a supervised GenServer, torn down per test" do
    pid = start_supervised!({Agent, fn -> 0 end})
    Agent.update(pid, &(&1 + 1))
    assert Agent.get(pid, & &1) == 1
  end
end

# useful commands
# mix test                     mix test --failed
# mix test test/x_test.exs:42  mix test --only integration
# mix test --seed 0            mix test --cover
# mix test --repeat-until-failure 50   ← hunt flaky tests`,
    },
  ],
};
