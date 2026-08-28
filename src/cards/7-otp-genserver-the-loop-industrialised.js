export default {
  front:
    "You wrote the receive loop by hand in card 33. What does GenServer add that makes it production-grade?",
  back: "Everything around the loop: a standard client/server split, synchronous calls with timeouts and correct failure propagation, supervisor integration, `:sys` introspection (`:sys.get_state/1`, tracing, statistics), code upgrade hooks, and proper error reports. You implement `init/1` plus `handle_call/3` / `handle_cast/2` / `handle_info/2`; OTP implements the other 90%.",
  philosophy: {
    lead: "A GenServer is your card-33 loop with thirty years of operational experience wrapped around it.",
    body: [
      "The most valuable habit GenServer teaches is the **client/server split**. The public functions at the top of the module (`Counter.increment/0`) run in the CALLER's process; the `handle_*` callbacks run in the SERVER's process. Keeping them clearly separated in the file, with a comment between, is standard Elixir style and it prevents an entire class of confusion about where code executes.",
      "`init/1` runs inside the new process before `start_link` returns, so a slow init blocks your whole supervision tree at boot. The fix is `{:ok, state, {:continue, :setup}}`: return fast, then do the expensive work in `handle_continue/2` before any other message is processed. That is the correct way to warm a cache or connect to something at startup.",
      "And because it is a behaviour (card 26), your module is just a set of callbacks. The state is threaded through every one of them exactly like the accumulator in a reduce — which is what a GenServer fundamentally is: a reduce over an infinite stream of messages.",
    ],
    diagram: `sequenceDiagram
    autonumber
    participant C as CLIENT side<br/>(runs in the CALLER's process)
    participant S as SERVER side<br/>(runs in the GenServer process)
    Note over S: init(arg)
    C->>S: Counter.increment() → GenServer.cast(pid, :inc)
    Note over S: handle_cast(:inc, state)<br/>{:noreply, new_state}
    C->>S: Counter.value() → GenServer.call(pid, :get)
    Note over S: handle_call(:get, from, state)
    S-->>C: {:reply, value, state}
    C->>S: send(pid, :tick) — any raw message
    Note over S: handle_info(:tick, state)
    Note over S: terminate(reason, state)
    Note over C,S: RETURN VALUES YOU CAN GIVE BACK<br/>{:reply, reply, state} · {:noreply, state}<br/>{:reply, reply, state, timeout} · {:noreply, state, {:continue, term}}<br/>{:stop, reason, reply, state} · {:stop, reason, state}
    Note over S: SLOW BOOT FIX<br/>def init(arg), do: {:ok, %{}, {:continue, :load}}  ← returns instantly<br/>def handle_continue(:load, state), do: {:noreply, expensive(state)}`,
    takeaway:
      "Client functions run in the caller; callbacks run in the server. init must be fast — use handle_continue.",
  },
  codeSamples: [
    {
      title: "The canonical GenServer",
      note: "Paste the whole thing into iex -S mix.",
      code: `defmodule Counter do
  use GenServer

  # ============ CLIENT (runs in the caller) ============
  def start_link(initial \\\\ 0) do
    GenServer.start_link(__MODULE__, initial, name: __MODULE__)
  end

  def increment(by \\\\ 1), do: GenServer.cast(__MODULE__, {:inc, by})
  def value,              do: GenServer.call(__MODULE__, :value)
  def reset,              do: GenServer.call(__MODULE__, :reset)
  def stop,               do: GenServer.stop(__MODULE__)

  # ============ SERVER (runs in the GenServer) ==========
  @impl true
  def init(initial), do: {:ok, %{count: initial, history: []}}

  @impl true
  def handle_cast({:inc, by}, state) do
    {:noreply, %{state | count: state.count + by, history: [by | state.history]}}
  end

  @impl true
  def handle_call(:value, _from, state), do: {:reply, state.count, state}
  def handle_call(:reset, _from, state), do: {:reply, :ok, %{state | count: 0}}

  @impl true
  def terminate(reason, state) do
    IO.puts("stopping (#{inspect(reason)}) with count=#{state.count}")
    :ok
  end
end

{:ok, _pid} = Counter.start_link(10)
Counter.increment()
Counter.increment(5)
Counter.value()          # 16
:sys.get_state(Counter)  # peek at the whole state — GenServer gives you this
Counter.reset()
Counter.stop()`,
    },
    {
      title: "handle_continue for slow startup",
      note: "Boot fast, warm up after.",
      code: `defmodule Warm do
  use GenServer

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)
  def data, do: GenServer.call(__MODULE__, :data)

  @impl true
  def init(:ok) do
    IO.puts("init returns immediately")
    {:ok, %{ready?: false, data: nil}, {:continue, :load}}
  end

  @impl true
  def handle_continue(:load, state) do
    IO.puts("loading expensive data…")
    Process.sleep(1_000)
    {:noreply, %{state | ready?: true, data: %{loaded: true}}}
  end

  @impl true
  def handle_call(:data, _from, state), do: {:reply, state.data, state}
end

{:ok, _} = Warm.start_link(nil)   # returns instantly
Warm.data()                        # blocks until handle_continue is done`,
    },
    {
      title: "Introspection you get for free",
      note: "None of this existed in your hand-rolled loop.",
      code: `{:ok, _} = Counter.start_link(0)
Counter.increment(7)

:sys.get_state(Counter)
:sys.get_status(Counter)
:sys.statistics(Counter, true)
Counter.increment(1)
:sys.statistics(Counter, :get)

# live message tracing:
:sys.trace(Counter, true)
Counter.increment(1)
Counter.value()
:sys.trace(Counter, false)`,
    },
  ],
};
