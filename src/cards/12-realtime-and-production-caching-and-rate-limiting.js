export default {
  front:
    "Two problems, one tool. Why is ETS the right answer for both a hot read cache and a per-IP rate limiter?",
  back: "Because both need microsecond, lock-free, concurrent access to small mutable state that does not have to survive a restart. ETS (card 47) gives exactly that: `:ets.lookup/2` for cache reads with no message passing, and `:ets.update_counter/3` for atomic rate-limit increments. Both patterns are ~30 lines and need no external service — no Redis, no memcached, no extra thing to operate.",
  philosophy: {
    lead: "A large fraction of what teams deploy Redis for is already in the BEAM, faster, with no network hop and no extra failure mode.",
    body: [
      "The cache pattern to internalise is read-through with single-flight. A naive cache lets a thousand concurrent misses all recompute the same value — a cache stampede that can take down the thing you were protecting. Routing misses through a GenServer that tracks in-flight computations means one process computes and the other 999 wait for its result. That is a genuine production-grade cache in a page of code.",
      "For rate limiting, the fixed window with `update_counter` is simple and adequate; a sliding window is more accurate and only slightly harder. Either way, the key design question is what you key on — IP, user, API key, or a tuple of endpoint and user — and what you return: `429` with a `Retry-After` header, so clients can behave.",
      "The honest limitation: ETS is per-node. Three nodes means three independent caches and three independent rate limiters, so your effective limit is 3x. If you need a cluster-wide limit, either use a distributed counter (`:global`, or a single owning process reached over distribution) or accept the multiple and divide your limit by the node count. Reach for Redis when you need cross-node atomicity or persistence — not by default.",
    ],
    diagram: `flowchart TB
  subgraph cache["CACHE — read-through with SINGLE-FLIGHT, so there is no stampede"]
    direction TB
    c0["1000 concurrent requests for the same MISSING key"]:::warn
    c0 --> c1[":ets.lookup ⇒ miss"]:::muted
    c1 --> c2["the owner GenServer asks:<br/>is this key already being computed?<br/>  yes → park this caller in a waiters list<br/>  no  → a Task computes it ONCE"]:::hot
    c2 --> c3["result → :ets.insert + reply to ALL waiters<br/>⇒ 1 computation, 1000 satisfied callers ✓"]:::ok
  end
  c3 --> naive["a naive cache would run it 1000 times and melt the source"]:::bad
  naive --> r1
  subgraph rate["RATE LIMIT — an atomic counter, no process at all"]
    direction TB
    r1[":ets.update_counter(:rate, {ip, window}, {2, 1}, {{ip, window}, 0})<br/>an ATOMIC increment that returns the new value"]:::code
    r2["count &gt; limit ? ⇒ 429 + Retry-After   :   allow"]:::hot
    r3["window = div(System.system_time(:second), 60)  ← a fixed window, trivial<br/>a sliding window = keep timestamps and drop old ones ← more accurate"]:::hot
    r1 --> r2 --> r3
  end
  r3 --> pernode["⚠ ETS IS PER NODE<br/>3 nodes × a limit of 100 = an effective 300/min<br/>fix: divide the limit by the node count, or use one owning process,<br/>or Redis when you truly need cluster-wide atomicity."]:::bad`,
    takeaway:
      "ETS covers caching and rate limiting in-process. Guard against stampedes; remember limits are per node.",
  },
  codeSamples: [
    {
      title: "Read-through cache with single-flight",
      note: "Paste it all; the last block proves it works.",
      code: `defmodule Shop.Cache do
  use GenServer
  @table :shop_cache

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @doc "Read-through fetch. Concurrent misses compute the value ONCE."
  def fetch(key, ttl_ms, fun) do
    case lookup(key) do
      {:ok, value} -> value
      :miss -> GenServer.call(__MODULE__, {:compute, key, ttl_ms, fun}, 30_000)
    end
  end

  def lookup(key) do
    now = System.monotonic_time(:millisecond)
    case :ets.lookup(@table, key) do
      [{^key, value, expires}] when expires > now -> {:ok, value}
      _ -> :miss
    end
  end

  def invalidate(key), do: :ets.delete(@table, key)
  def size, do: :ets.info(@table, :size)

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :set, :public, read_concurrency: true])
    {:ok, %{inflight: %{}}}
  end

  @impl true
  def handle_call({:compute, key, ttl, fun}, from, state) do
    case lookup(key) do
      {:ok, value} ->
        {:reply, value, state}                       # someone filled it meanwhile

      :miss ->
        case Map.fetch(state.inflight, key) do
          {:ok, waiters} ->
            # already being computed — just wait for it
            {:noreply, put_in(state.inflight[key], [from | waiters])}

          :error ->
            owner = self()
            Task.start(fn -> send(owner, {:computed, key, ttl, fun.()}) end)
            {:noreply, put_in(state.inflight[key], [from])}
        end
    end
  end

  @impl true
  def handle_info({:computed, key, ttl, value}, state) do
    :ets.insert(@table, {key, value, System.monotonic_time(:millisecond) + ttl})
    {waiters, inflight} = Map.pop(state.inflight, key, [])
    Enum.each(waiters, &GenServer.reply(&1, value))
    {:noreply, %{state | inflight: inflight}}
  end
  def handle_info(_, state), do: {:noreply, state}
end

{:ok, _} = Shop.Cache.start_link(nil)

# 500 concurrent misses on the same key:
counter = :counters.new(1, [])
1..500
|> Task.async_stream(fn _ ->
     Shop.Cache.fetch("expensive", 60_000, fn ->
       :counters.add(counter, 1, 1)
       Process.sleep(300)
       :computed_value
     end)
   end, max_concurrency: 500)
|> Stream.run()

:counters.get(counter, 1)     # 1 ✓  — not 500`,
    },
    {
      title: "Rate limiter — fixed window",
      note: "No GenServer needed; update_counter is atomic.",
      code: `defmodule Shop.RateLimiter do
  @table :rate_limiter

  def init, do: :ets.new(@table, [:named_table, :set, :public, write_concurrency: true])

  @doc "Returns {:ok, remaining} | {:error, :rate_limited, retry_after_seconds}"
  def check(key, limit, window_seconds \\\\ 60) do
    now = System.system_time(:second)
    window = div(now, window_seconds)
    bucket = {key, window}

    count = :ets.update_counter(@table, bucket, {2, 1}, {bucket, 0})

    if count <= limit do
      {:ok, limit - count}
    else
      retry_after = (window + 1) * window_seconds - now
      {:error, :rate_limited, retry_after}
    end
  end

  def sweep(window_seconds \\\\ 60) do
    current = div(System.system_time(:second), window_seconds)
    :ets.select_delete(@table, [{{{:_, :"$1"}, :_}, [{:<, :"$1", current}], [true]}])
  end
end

Shop.RateLimiter.init()
for i <- 1..7, do: {i, Shop.RateLimiter.check("ip:1.2.3.4", 5)}`,
    },
    {
      title: "Wire it into Phoenix as a plug",
      note: "Standard headers so clients can back off politely.",
      code: `defmodule ShopWeb.Plugs.RateLimit do
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  def init(opts), do: %{limit: Keyword.get(opts, :limit, 100),
                        window: Keyword.get(opts, :window, 60)}

  def call(conn, %{limit: limit, window: window}) do
    key = identifier(conn)

    case Shop.RateLimiter.check(key, limit, window) do
      {:ok, remaining} ->
        conn
        |> put_resp_header("x-ratelimit-limit", to_string(limit))
        |> put_resp_header("x-ratelimit-remaining", to_string(remaining))

      {:error, :rate_limited, retry_after} ->
        conn
        |> put_resp_header("retry-after", to_string(retry_after))
        |> put_status(:too_many_requests)
        |> json(%{error: "rate limited", retry_after: retry_after})
        |> halt()
    end
  end

  defp identifier(%{assigns: %{current_user: %{id: id}}}), do: "user:#{id}"
  defp identifier(conn) do
    ip = conn.remote_ip |> :inet.ntoa() |> to_string()
    # behind a proxy, prefer the forwarded header (and validate the proxy!)
    case get_req_header(conn, "x-forwarded-for") do
      [value | _] -> "ip:" <> (value |> String.split(",") |> hd() |> String.trim())
      [] -> "ip:" <> ip
    end
  end
end

# router:  pipeline :api do plug ShopWeb.Plugs.RateLimit, limit: 100, window: 60 end`,
    },
    {
      title: "Caching a database read in a context",
      note: "Invalidate on write — the boring, correct approach.",
      code: `defmodule Shop.Catalog do
  alias Shop.{Repo, Catalog.Product}

  @ttl :timer.minutes(5)

  def get_product!(id) do
    Shop.Cache.fetch({:product, id}, @ttl, fn -> Repo.get!(Product, id) end)
  end

  def update_product(%Product{} = product, attrs) do
    result = product |> Product.changeset(attrs) |> Repo.update()

    case result do
      {:ok, updated} ->
        Shop.Cache.invalidate({:product, updated.id})
        # tell the other nodes too — their ETS tables are separate:
        Phoenix.PubSub.broadcast(Shop.PubSub, "cache:invalidate", {:product, updated.id})
        result
      error -> error
    end
  end
end`,
    },
  ],
};
