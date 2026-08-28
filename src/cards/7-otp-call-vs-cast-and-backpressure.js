export default {
  front:
    "`cast` is faster because it does not wait. Why is defaulting to `cast` one of the most common production mistakes in Elixir?",
  back: "Because `cast` has no backpressure. The caller returns instantly regardless of whether the server can keep up, so a fast producer silently grows the server's mailbox until the node runs out of memory. `call` blocks the caller until the server replies, which automatically throttles producers to the speed of the consumer. Default to `call`; use `cast` only when losing the message is genuinely acceptable.",
  philosophy: {
    lead: "The choice between call and cast is really a choice about who absorbs the pressure when the system is overloaded.",
    body: [
      "With `call`, a slow server makes its callers wait, and those callers make THEIR callers wait, all the way back to the connection that started it. The load naturally applies the brakes. With `cast`, the pressure has nowhere to go except the mailbox, and a mailbox is unbounded. The failure mode is not a slow response, it is a dead node — and it usually happens at 3am under peak load.",
      "The `call` timeout (5000ms by default) is a real timeout with real semantics: when it fires, the CALLER exits, but the server keeps processing the request. That is why long-running work does not belong in `handle_call` — you block the whole server for everyone else while it runs. Instead, reply immediately with `{:noreply, ...}` and use `GenServer.reply/2` from a Task later, or push the work outside the GenServer entirely.",
      "One more thing to know: `handle_call` gives you `from`, a `{pid, ref}` tuple. Holding onto it and replying later is the officially supported way to build asynchronous request handling on top of a synchronous interface.",
    ],
    diagram: `flowchart TB
  subgraph callp["CALL — synchronous, BACKPRESSURED"]
    direction LR
    c0["caller<br/>BLOCKS, default 5000ms"]:::hot -->|request + ref| c1["server mailbox"]:::hot --> c2["handle_call"]:::hot -->|reply| c0
  end
  callp --> cgood["if the server is slow, the caller waits<br/>⇒ producers throttle themselves ✓ backpressure"]:::ok
  subgraph castp["CAST — asynchronous, NO backpressure"]
    direction LR
    k0["caller<br/>returns :ok instantly"]:::warn -->|message| k1["mailbox grows … ∞"]:::bad
  end
  cgood ~~~ castp
  castp --> cbad["a producer 10x faster than the consumer ⇒ the mailbox grows forever<br/>⇒ memory climbs ⇒ the node dies ✗ a 3am outage"]:::bad
  cbad --> rule["USE call — almost always. reads, writes, anything ordered<br/>USE cast — metrics, fire-and-forget logs, best effort only<br/>USE send — raw messages, timers, monitors"]:::hot
  rule --> long["LONG WORK IN handle_call BLOCKS EVERY OTHER CLIENT<br/>def handle_call(:slow, from, state) do<br/>  Task.start(fn -&gt; GenServer.reply(from, expensive()) end)   ← reply later<br/>  {:noreply, state}                                          ← unblock now<br/>end"]:::code`,
    takeaway:
      "call gives you backpressure for free. cast is an unbounded queue waiting to kill your node.",
  },
  codeSamples: [
    {
      title: "Watch a cast mailbox explode",
      note: "Run it and watch message_queue_len climb.",
      code: `defmodule Slow do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, 0, name: __MODULE__)
  def push_cast(n), do: GenServer.cast(__MODULE__, {:work, n})
  def push_call(n), do: GenServer.call(__MODULE__, {:work, n}, 30_000)

  @impl true
  def init(s), do: {:ok, s}
  @impl true
  def handle_cast({:work, _n}, s) do
    Process.sleep(5)
    {:noreply, s + 1}
  end
  @impl true
  def handle_call({:work, _n}, _from, s) do
    Process.sleep(5)
    {:reply, :ok, s + 1}
  end
end

{:ok, pid} = Slow.start_link(nil)

# CAST: returns instantly, queue explodes
{t, _} = :timer.tc(fn -> for i <- 1..2_000, do: Slow.push_cast(i) end)
IO.puts("cast returned in #{div(t,1000)}ms")
Process.info(pid, :message_queue_len)     # thousands queued 😱
Process.sleep(1000)
Process.info(pid, :message_queue_len)     # slowly draining`,
    },
    {
      title: "call self-throttles",
      note: "Same work, but the producer is forced to keep pace.",
      code: `{t2, _} = :timer.tc(fn -> for i <- 1..200, do: Slow.push_call(i) end)
IO.puts("call took #{div(t2,1000)}ms — the producer was throttled ✓")
Process.info(Process.whereis(Slow), :message_queue_len)   # ~0 ✓`,
    },
    {
      title: "Timeouts and how they fail",
      note: "Note who dies: the caller, not the server.",
      code: `defmodule Sleeper do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  @impl true
  def init(s), do: {:ok, s}
  @impl true
  def handle_call(:slow, _from, s) do
    Process.sleep(2_000)
    {:reply, :done, s}
  end
end

{:ok, _} = Sleeper.start_link(nil)

try do
  GenServer.call(Sleeper, :slow, 300)
catch
  :exit, {:timeout, _} -> :caller_timed_out
end
# the server is STILL working on that request; it is not cancelled`,
    },
    {
      title: "Reply later — keep the server free",
      note: "The professional pattern for slow work.",
      code: `defmodule Async do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  def fetch(id), do: GenServer.call(__MODULE__, {:fetch, id}, 10_000)
  def ping, do: GenServer.call(__MODULE__, :ping)

  @impl true
  def init(s), do: {:ok, s}

  @impl true
  def handle_call({:fetch, id}, from, state) do
    Task.start(fn ->
      Process.sleep(1_500)                       # slow I/O
      GenServer.reply(from, {:ok, %{id: id}})    # reply from ANOTHER process
    end)
    {:noreply, state}                            # server is free immediately
  end

  def handle_call(:ping, _from, state), do: {:reply, :pong, state}
end

{:ok, _} = Async.start_link(nil)
spawn(fn -> IO.inspect(Async.fetch(1), label: "slow result") end)
Process.sleep(100)
Async.ping()      # answers instantly even though a fetch is in flight ✓`,
    },
  ],
};
