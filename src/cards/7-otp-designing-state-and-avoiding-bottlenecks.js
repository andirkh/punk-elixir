export default {
  front:
    "Your GenServer holds a cache used on every request, and at 5k req/s the whole app slows down. What went wrong, and what are the three fixes?",
  back: "You built a single-process bottleneck: every request serialises through one mailbox. Fixes, in order of preference: (1) move read-heavy state into **ETS** so reads bypass the process entirely; (2) **shard** into N processes keyed by a hash; (3) give each entity its own process (one per user/room) via a Registry. A GenServer should own a decision, not a hot data path.",
  philosophy: {
    lead: "The same serialisation that gives you lock-free correctness makes a single process a throughput ceiling. Good OTP design is about where you put that ceiling.",
    body: [
      "Think in terms of what the process is FOR. A GenServer is excellent at owning a decision that must be made one at a time: allocating a seat, enforcing a rate limit, sequencing writes to an external system. It is bad at being a shared read cache, because reads have no reason to be serialised at all.",
      "That is why ETS exists (card 47): a table any process can read concurrently, at full core count, with no message passing. The classic pattern is a GenServer that OWNS an ETS table and performs all writes, while readers hit the table directly. You keep single-writer correctness and get parallel reads.",
      "Sharding is the next tool: `:erlang.phash2(key, 8)` picks one of eight identical GenServers, cutting contention by eight. And for entity-shaped state, one process per entity is the most Elixir-native answer — a million user sessions are a million tiny independent servers, each with a mailbox that is almost always empty.",
      "Finally, keep the state small and shaped as a map or struct, never a list you scan. A GenServer holding a 100k-element list that it filters on every call is slow for reasons that have nothing to do with concurrency.",
    ],
    diagram: `flowchart TB
  load["5000 req/s — all funnelling into ONE process"]:::warn --> gs["GenServer<br/>1 core · mailbox growing ████████"]:::bad
  gs --> ceiling["throughput ceiling = 1 process"]:::bad
  ceiling --> f1
  subgraph fixes["THE FIXES"]
    direction TB
    f1["1. ETS FOR READS ★ best for caches<br/>readers → :ets.lookup, in parallel<br/>one writer → a GenServer, serialised"]:::ok
    f2["2. SHARD BY KEY<br/>hash(key) → one of 8 servers<br/>8x the throughput, the same code"]:::ok
    f3["3. PROCESS PER ENTITY<br/>user 1 → its own pid, user 2 → its own pid, via a Registry<br/>every mailbox stays nearly empty ✓"]:::ok
    f1 ~~~ f2 ~~~ f3
  end
  f3 --> right["WHEN A SINGLE GENSERVER IS RIGHT<br/>✓ it owns a DECISION that must be serialised — allocate, sequence, limit<br/>✓ it owns a connection or resource that is single-use<br/>✗ it sits on the read path of every request<br/>✗ it holds a big collection it scans on every call"]:::hot
  right --> shape["STATE SHAPE — a %State{} struct or a map with indexed access<br/>✗ not a list you Enum.find on every call"]:::warn`,
    takeaway:
      "A process serialises. Put ETS or sharding or per-entity processes where you need parallelism.",
  },
  codeSamples: [
    {
      title: "Measure the bottleneck",
      note: "One server, many clients.",
      code: `defmodule HotCache do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  def get(k), do: GenServer.call(__MODULE__, {:get, k})
  def put(k, v), do: GenServer.call(__MODULE__, {:put, k, v})
  @impl true
  def init(s), do: {:ok, s}
  @impl true
  def handle_call({:get, k}, _f, s), do: {:reply, Map.get(s, k), s}
  def handle_call({:put, k, v}, _f, s), do: {:reply, :ok, Map.put(s, k, v)}
end

{:ok, _} = HotCache.start_link(nil)
HotCache.put(:k, :v)

{t, _} = :timer.tc(fn ->
  1..50_000
  |> Task.async_stream(fn _ -> HotCache.get(:k) end, max_concurrency: 50)
  |> Stream.run()
end)
IO.puts("50k serialised reads: #{div(t, 1000)} ms")`,
    },
    {
      title: "Fix 1 — GenServer owns ETS, readers bypass it",
      note: "Usually a 10-50x improvement on reads.",
      code: `defmodule FastCache do
  use GenServer
  @table :fast_cache

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  # READ: no message passing at all, runs in the CALLER, fully parallel
  def get(k) do
    case :ets.lookup(@table, k) do
      [{^k, v}] -> v
      [] -> nil
    end
  end

  # WRITE: goes through the owner process, so writes stay serialised
  def put(k, v), do: GenServer.call(__MODULE__, {:put, k, v})

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :set, :protected, read_concurrency: true])
    {:ok, %{}}
  end

  @impl true
  def handle_call({:put, k, v}, _from, s) do
    :ets.insert(@table, {k, v})
    {:reply, :ok, s}
  end
end

{:ok, _} = FastCache.start_link(nil)
FastCache.put(:k, :v)

{t2, _} = :timer.tc(fn ->
  1..50_000
  |> Task.async_stream(fn _ -> FastCache.get(:k) end, max_concurrency: 50)
  |> Stream.run()
end)
IO.puts("50k parallel reads: #{div(t2, 1000)} ms  ✓")`,
    },
    {
      title: "Fix 2 — shard by key",
      note: "Same API, N processes behind it.",
      code: `defmodule Sharded do
  @shards 8

  def child_specs do
    for i <- 0..(@shards - 1) do
      Supervisor.child_spec({Agent, fn -> %{} end}, id: {__MODULE__, i})
    end
  end

  def start_all do
    for i <- 0..(@shards - 1) do
      {:ok, pid} = Agent.start_link(fn -> %{} end, name: name(i))
      pid
    end
  end

  defp name(i), do: :"sharded_#{i}"
  defp shard_for(key), do: name(:erlang.phash2(key, @shards))

  def put(k, v), do: Agent.update(shard_for(k), &Map.put(&1, k, v))
  def get(k),    do: Agent.get(shard_for(k), &Map.get(&1, k))
end

Sharded.start_all()
for i <- 1..100, do: Sharded.put("key#{i}", i)
Sharded.get("key42")
:erlang.phash2("key42", 8)     # which shard it landed in`,
    },
    {
      title: "Fix 3 — state shape matters",
      note: "Same process, 1000x faster, no concurrency changes.",
      code: `slow_state = Enum.to_list(1..100_000) |> Enum.map(&%{id: &1, name: "u#{&1}"})
fast_state = Map.new(slow_state, &{&1.id, &1})

{t1, _} = :timer.tc(fn -> Enum.find(slow_state, &(&1.id == 99_999)) end)
{t2, _} = :timer.tc(fn -> Map.get(fast_state, 99_999) end)
{t1, t2}    # list scan vs map lookup`,
    },
  ],
};
