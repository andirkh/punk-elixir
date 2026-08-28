export default {
  front:
    "Card 42 said to move read-heavy state out of a GenServer. Where to, given that processes share nothing?",
  back: "**ETS** (Erlang Term Storage): in-memory tables owned by a process but readable by any process directly, with no message passing. Reads are concurrent across all cores. Tables are typed (`:set`, `:ordered_set`, `:bag`) and access-controlled (`:private`, `:protected`, `:public`). The table dies with its owner — which is why the owner is normally a supervised GenServer.",
  philosophy: {
    lead: "ETS is the one place the BEAM offers genuinely shared memory, and it is safe because every operation on it is atomic and isolated.",
    body: [
      "There is no locking API because you never need one for a single operation: `:ets.insert/2`, `:ets.lookup/2`, `:ets.update_counter/3` are each atomic. Multi-step read-modify-write is NOT atomic, and that is exactly where you route the write through the owning GenServer, or use `update_counter` which does it atomically for you.",
      "The performance model is what makes it worth learning. `read_concurrency: true` lets many cores read at full speed. `write_concurrency: true` splits internal locks for parallel writes to different keys. A lookup is roughly 1 microsecond, which is why every serious Elixir cache, rate limiter, session store and Registry is ETS underneath.",
      "The ownership rule bites people once: if the process that created the table dies, the table is destroyed. Create tables in a supervised GenServer's `init` so a restart recreates them, or use `heir` to hand ownership to another process on death. And remember ETS data is not garbage collected per-key — you must expire entries yourself, usually with a periodic `handle_info` sweep (card 41).",
    ],
    diagram: `flowchart TB
  subgraph ets["ETS table :cache — it lives IN THE VM, it is not a process"]
    direction LR
    d1["{'user:1', %{…}}"]:::code
    d2["{'user:2', %{…}}"]:::code
    d3["{'rate:ip', 42}"]:::code
  end
  rd1["reader 1"]:::ok --> ets
  rd2["reader 2"]:::ok --> ets
  rd3["reader 3"]:::ok --> ets
  own["owner GenServer<br/>creates the table and writes to it"]:::hot --> ets
  ets --> perf["reads are parallel, lock-free, ~1µs<br/>⚠ the table dies WITH ITS OWNER"]:::warn
  perf --> opts
  subgraph opts["choosing a table"]
    direction LR
    ty["TYPES<br/>:set — unique keys<br/>:ordered_set — sorted keys<br/>:bag — many per key<br/>:duplicate_bag — duplicate entries"]:::hot
    ac["ACCESS<br/>:private — owner only<br/>:protected — owner writes, all read ★<br/>:public — anyone writes"]:::hot
    op["OPTIONS THAT MATTER<br/>read_concurrency: true — many parallel readers, for caches<br/>write_concurrency: true — parallel writes to different keys, for counters<br/>:named_table — address it by atom instead of a tid"]:::hot
  end
  opts --> atom0["ATOMIC — insert/2 · lookup/2 · delete/2 · update_counter/3<br/>NOT ATOMIC — lookup then insert ⇒ route that through the owner GenServer"]:::warn
  atom0 --> limits["✗ ETS does not expire anything for you — sweep it yourself<br/>✗ ETS is per-node — it is NOT a distributed cache"]:::bad`,
    takeaway:
      "ETS = shared, atomic, concurrent in-memory tables. Owner writes, everyone reads, you handle expiry.",
  },
  codeSamples: [
    {
      title: "First contact",
      note: "",
      code: `table = :ets.new(:demo, [:set, :public])
:ets.insert(table, {"a", 1})
:ets.insert(table, {"b", %{name: "Ada"}})
:ets.lookup(table, "a")          # [{"a", 1}]
:ets.lookup(table, "zzz")        # []
:ets.tab2list(table)
:ets.info(table, :size)
:ets.delete(table, "a")
:ets.delete(table)               # destroy the whole table`,
    },
    {
      title: "A supervised cache with TTL",
      note: "Owner GenServer + periodic sweep. Real, usable code.",
      code: `defmodule TTLCache do
  use GenServer
  @table :ttl_cache
  @sweep_ms 5_000

  # --- client: reads bypass the process entirely ---
  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  def put(key, value, ttl_ms \\\\ 60_000) do
    expires = System.monotonic_time(:millisecond) + ttl_ms
    :ets.insert(@table, {key, value, expires})
    :ok
  end

  def get(key) do
    now = System.monotonic_time(:millisecond)
    case :ets.lookup(@table, key) do
      [{^key, value, expires}] when expires > now -> {:ok, value}
      [{^key, _v, _expired}] -> :ets.delete(@table, key); :miss
      [] -> :miss
    end
  end

  def fetch(key, ttl_ms, fun) do
    case get(key) do
      {:ok, v} -> v
      :miss -> v = fun.(); put(key, v, ttl_ms); v
    end
  end

  def size, do: :ets.info(@table, :size)

  # --- server: owns the table and sweeps it ---
  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :set, :public,
                      read_concurrency: true, write_concurrency: true])
    Process.send_after(self(), :sweep, @sweep_ms)
    {:ok, %{sweeps: 0}}
  end

  @impl true
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)
    # match spec: delete every row whose expiry is in the past
    deleted = :ets.select_delete(@table, [{{:_, :_, :"$1"}, [{:<, :"$1", now}], [true]}])
    if deleted > 0, do: IO.puts("swept #{deleted} expired keys")
    Process.send_after(self(), :sweep, @sweep_ms)
    {:noreply, %{state | sweeps: state.sweeps + 1}}
  end
  def handle_info(_, state), do: {:noreply, state}
end

{:ok, _} = TTLCache.start_link(nil)
TTLCache.put("user:1", %{name: "Ada"}, 2_000)
TTLCache.get("user:1")
TTLCache.fetch("slow", 10_000, fn -> Process.sleep(300); :computed end)
TTLCache.fetch("slow", 10_000, fn -> :never_runs end)
Process.sleep(2_500)
TTLCache.get("user:1")      # :miss ✓`,
    },
    {
      title: "Atomic counters — a rate limiter core",
      note: "update_counter is atomic; no GenServer needed at all.",
      code: `:ets.new(:rate, [:named_table, :public, write_concurrency: true])

defmodule Limiter do
  @max 5
  def allow?(key) do
    count = :ets.update_counter(:rate, key, {2, 1}, {key, 0})
    count <= @max
  end
  def reset(key), do: :ets.delete(:rate, key)
end

for i <- 1..8, do: {i, Limiter.allow?("ip:1.2.3.4")}
# 1..5 true, 6..8 false ✓ — and it is correct under full concurrency`,
    },
    {
      title: "Speed and table types",
      note: "",
      code: `:ets.new(:speed, [:named_table, :public, read_concurrency: true])
for i <- 1..100_000, do: :ets.insert(:speed, {i, "value #{i}"})

{t, _} = :timer.tc(fn -> for _ <- 1..100_000, do: :ets.lookup(:speed, 50_000) end)
IO.puts("100k lookups in #{div(t, 1000)} ms")

# ordered_set supports range queries
o = :ets.new(:ord, [:ordered_set])
for i <- 1..10, do: :ets.insert(o, {i, i * i})
:ets.first(o); :ets.last(o); :ets.next(o, 5)

# bag allows many values per key
b = :ets.new(:bag, [:bag])
:ets.insert(b, {"tags", "elixir"})
:ets.insert(b, {"tags", "otp"})
:ets.lookup(b, "tags")`,
    },
  ],
};
