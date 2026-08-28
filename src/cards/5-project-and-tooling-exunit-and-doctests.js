export default {
  front:
    "How do you test a module, and how do the examples in your `@doc` become tests automatically?",
  back: '`ExUnit` ships with Elixir: `defmodule XTest do use ExUnit.Case; test "..." do assert ... end end` in `test/`. Add `doctest MyModule` and every `iex>` example inside your `@doc` strings is executed and compared against its stated output — so your documentation cannot silently rot. Tests run concurrently with `async: true`, which is possible precisely because processes are isolated.',
  philosophy: {
    lead: "Testing in Elixir is unusually pleasant because pure functions dominate and the runtime isolates everything else.",
    body: [
      "Most of your code takes data and returns data, so most tests are `assert transform(input) == expected` with no setup, no mocks, no fixtures. The parts that are not pure are processes, and ExUnit gives you real tools for them: start a supervised process per test with `start_supervised!/1` and it is torn down automatically, keeping tests independent.",
      "`async: true` runs test MODULES in parallel across cores. It is safe by default because each test process has its own state; the only shared resource is usually the database, and Ecto solves that by running each test in a transaction that is rolled back (the SQL Sandbox, card 97).",
      "Doctests deserve a special mention: they make examples in documentation executable. Write your `@doc` with an `iex>` line and its result, add one `doctest` line to the test file, and your docs are now verified by CI.",
    ],
    diagram: `flowchart TB
  subgraph src["lib/shop/cart.ex"]
    direction TB
    doc["@doc #quot;#quot;#quot;<br/>    iex&gt; Cart.total([2,3])<br/>    5<br/>#quot;#quot;#quot;<br/>def total(p), do: sum(p)"]:::code
    doc ~~~ total
    total ~~~ sum
  end
  subgraph tst["test/shop/cart_test.exs"]
    direction TB
    tcode["defmodule Shop.CartTest do<br/>  use ExUnit.Case, async: true<br/>  doctest Shop.Cart      ← RUNS the doc examples<br/>  test 'adds' do<br/>    assert Cart.total([1]) == 1<br/>  end<br/>end"]:::code
  end
  doc -->|the example IS a test| tcode
  tcode --> ref["ASSERTIONS — assert ¦ refute ¦ assert_raise ¦ assert_receive<br/>assert {:ok, %{id: id}} = create(...)   ← match AND bind<br/><br/>SETUP — setup, setup_all, on_exit, @tag, @moduletag<br/>PROCESSES — start_supervised!({Counter, 0}) is torn down for you<br/><br/>RUN — mix test · --failed · path:42 · --only integration · --cover · --seed 0"]:::ok`,
    takeaway:
      "Pure functions make tests trivial; async is safe because processes are isolated; doctests keep docs honest.",
  },
  codeSamples: [
    {
      title: "A module with doctests",
      note: "Save as lib/shop/cart.ex in your mix project.",
      code: `defmodule Shop.Cart do
  @moduledoc "Cart totals in integer cents."

  @doc """
  Sums line item prices.

      iex> Shop.Cart.total([100, 250])
      350

      iex> Shop.Cart.total([])
      0
  """
  def total(prices), do: Enum.sum(prices)

  @doc """
  Applies a percentage discount, rounding to the nearest cent.

      iex> Shop.Cart.discount(1000, 10)
      900
  """
  def discount(cents, pct) when pct >= 0 and pct <= 100 do
    round(cents * (100 - pct) / 100)
  end
end`,
    },
    {
      title: "The test file",
      note: "test/shop/cart_test.exs — then run mix test",
      code: `defmodule Shop.CartTest do
  use ExUnit.Case, async: true
  doctest Shop.Cart

  describe "total/1" do
    test "sums line items" do
      assert Shop.Cart.total([100, 250, 5]) == 355
    end

    test "empty cart is free" do
      assert Shop.Cart.total([]) == 0
    end
  end

  describe "discount/2" do
    test "rejects impossible percentages" do
      assert_raise FunctionClauseError, fn -> Shop.Cart.discount(100, 150) end
    end

    test "pattern-match assertions bind values" do
      assert {:ok, %{total: total}} = {:ok, %{total: 900}}
      assert total == 900
    end
  end
end`,
    },
    {
      title: "setup, tags and fixtures",
      note: "",
      code: `defmodule OrderTest do
  use ExUnit.Case, async: true

  setup do
    # returns context available to every test in this module
    {:ok, cart: [100, 200], user: %{id: 1}}
  end

  setup context do
    on_exit(fn -> IO.puts("cleaning up #{context.test}") end)
    :ok
  end

  @tag :slow
  test "uses the context", %{cart: cart} do
    assert Enum.sum(cart) == 300
  end
end
# mix test --exclude slow
# mix test --only slow`,
    },
    {
      title: "Testing processes",
      note: "start_supervised! gives per-test isolation.",
      code: `defmodule CounterTest do
  use ExUnit.Case, async: true

  test "counts up" do
    pid = start_supervised!({Agent, fn -> 0 end})
    Agent.update(pid, &(&1 + 1))
    assert Agent.get(pid, & &1) == 1
  end

  test "message assertions" do
    send(self(), {:done, 42})
    assert_receive {:done, 42}, 100
    refute_receive {:done, _}, 10
  end
end`,
    },
  ],
};
