export default {
  front:
    "A GenServer needs to refresh a cache every 60 seconds. Which callback receives the tick, and why must you always have a catch-all?",
  back: "`handle_info/2` receives every message that was NOT sent via `call` or `cast` — timers, monitor `:DOWN` notices, socket data, stray messages. Schedule with `Process.send_after(self(), :tick, 60_000)` and reschedule at the end of each tick. You need a catch-all `handle_info(_msg, state)` clause because an unmatched message crashes the GenServer.",
  philosophy: {
    lead: "handle_info is where a GenServer meets the rest of the world — everything that is not a request from a client.",
    body: [
      "The self-rescheduling timer is the canonical pattern, and it is better than a fixed-interval cron for one important reason: it schedules the NEXT tick after the current work finishes, so a slow refresh cannot cause ticks to pile up in the mailbox. `:timer.send_interval/2` does not have that property. Add a small random jitter when many processes tick, or they will all hit your database in the same millisecond.",
      "The catch-all clause is not optional in production. Late replies from timed-out calls, `:DOWN` messages from monitors you forgot to demonitor, TCP packets, and library messages all arrive here. Without a catch-all your server crashes on the first surprise. Log it at debug level and carry on.",
      "This callback is also where you handle the death of processes you monitor — which is how a supervisor-adjacent GenServer keeps track of workers it did not start itself.",
    ],
    diagram: `flowchart TB
  subgraph who["WHO SENDS TO handle_info?"]
    direction TB
    w1["Process.send_after(self(), :tick, 60_000) — your own timers"]:::hot
    w2["{:DOWN, ref, :process, pid, reason} — monitors"]:::hot
    w3["{:EXIT, pid, reason} — links, if you are trapping"]:::hot
    w4["{:tcp, socket, data} — sockets and ports"]:::hot
    w5["late replies from timed-out calls — the sneaky one"]:::warn
    w6["anything anyone sends with send/2"]:::hot
    w1 ~~~ w2 ~~~ w3 ~~~ w4 ~~~ w5 ~~~ w6
  end
  w6 --> pat
  subgraph pat["THE SELF-RESCHEDULING TIMER — memorise this shape"]
    direction LR
    p1["init → schedule()"]:::ok --> p2["handle_info(:tick, state)<br/>state = do_work(state)"]:::ok --> p3["schedule() the NEXT tick<br/>only AFTER the work finished"]:::ok --> p2
  end
  pat --> why["ticks can never pile up in the mailbox ✓"]:::ok
  why --> jit["defp schedule do<br/>  jitter = :rand.uniform(5_000)     ← spread the herd<br/>  Process.send_after(self(), :tick, 60_000 + jitter)<br/>end"]:::code
  jit --> catchall["⚠ ALWAYS keep a catch-all clause<br/>def handle_info(msg, state) do<br/>  Logger.debug('unexpected: ' &lt;&gt; inspect(msg))<br/>  {:noreply, state}<br/>end"]:::warn`,
    takeaway:
      "handle_info catches everything else. Reschedule after the work, and always add a catch-all.",
  },
  codeSamples: [
    {
      title: "A self-refreshing cache",
      note: "The timer pattern in full.",
      code: `defmodule RateCache do
  use GenServer
  require Logger

  @refresh_ms 3_000

  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  def rates, do: GenServer.call(__MODULE__, :rates)

  @impl true
  def init(_) do
    send(self(), :refresh)               # refresh immediately at boot
    {:ok, %{rates: %{}, refreshed_at: nil, ticks: 0}}
  end

  @impl true
  def handle_info(:refresh, state) do
    rates = %{"USD" => :rand.uniform(120) / 100, "EUR" => 1.0}
    Logger.info("rates refreshed")
    schedule()
    {:noreply, %{state | rates: rates, refreshed_at: DateTime.utc_now(), ticks: state.ticks + 1}}
  end

  # THE CATCH-ALL — never omit this
  def handle_info(msg, state) do
    Logger.debug("RateCache ignoring #{inspect(msg)}")
    {:noreply, state}
  end

  @impl true
  def handle_call(:rates, _from, state), do: {:reply, state.rates, state}

  defp schedule do
    Process.send_after(self(), :refresh, @refresh_ms + :rand.uniform(500))
  end
end

{:ok, _} = RateCache.start_link(nil)
RateCache.rates()
send(RateCache, :some_random_junk)      # survives ✓
Process.sleep(3_500)
RateCache.rates()
:sys.get_state(RateCache).ticks`,
    },
    {
      title: "Prove the catch-all matters",
      note: "Same server without it.",
      code: `defmodule Fragile do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, 0, name: __MODULE__)
  @impl true
  def init(s), do: {:ok, s}
  @impl true
  def handle_info(:tick, s), do: {:noreply, s + 1}
  # no catch-all!
end

{:ok, pid} = Fragile.start_link(nil)
send(pid, :tick)
Process.alive?(pid)      # true
send(pid, :anything_else)
Process.sleep(50)
Process.alive?(pid)      # false 💥 FunctionClauseError`,
    },
    {
      title: "Monitoring other processes",
      note: "handle_info is where DOWN messages land.",
      code: `defmodule Watcher do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  def watch(pid), do: GenServer.call(__MODULE__, {:watch, pid})
  def deaths, do: GenServer.call(__MODULE__, :deaths)

  @impl true
  def init(_), do: {:ok, %{refs: %{}, deaths: []}}

  @impl true
  def handle_call({:watch, pid}, _from, state) do
    ref = Process.monitor(pid)
    {:reply, :ok, put_in(state.refs[ref], pid)}
  end
  def handle_call(:deaths, _from, state), do: {:reply, state.deaths, state}

  @impl true
  def handle_info({:DOWN, ref, :process, pid, reason}, state) do
    {_pid, refs} = Map.pop(state.refs, ref)
    {:noreply, %{state | refs: refs, deaths: [{pid, reason} | state.deaths]}}
  end
  def handle_info(_other, state), do: {:noreply, state}
end

{:ok, _} = Watcher.start_link(nil)
victim = spawn(fn -> Process.sleep(300) end)
Watcher.watch(victim)
Process.sleep(500)
Watcher.deaths()`,
    },
    {
      title: "Idle timeouts and hibernation",
      note: "Two ways to keep idle servers cheap.",
      code: `defmodule Idle do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, nil)
  @impl true
  def init(s), do: {:ok, s, 2_000}          # :timeout after 2s of silence
  @impl true
  def handle_info(:timeout, s) do
    IO.puts("idle for 2s — shutting down to free memory")
    {:stop, :normal, s}
  end
  def handle_info(_, s), do: {:noreply, s, 2_000}
end

{:ok, p} = Idle.start_link(nil)
Process.sleep(2_500)
Process.alive?(p)     # false — it stopped itself

# :hibernate compacts the heap of a long-idle process:
# {:noreply, state, :hibernate}`,
    },
  ],
};
