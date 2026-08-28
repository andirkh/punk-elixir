export default {
  front:
    "Your Elixir service has been up for three weeks and memory is climbing steadily. Name the four usual suspects.",
  back: "(1) A **growing mailbox** — a process receiving faster than it handles, usually because someone used `cast`. (2) **ETS with no expiry** — a cache that only ever inserts. (3) **Atom leak** — `String.to_atom/1` on user input. (4) **Binary leak** — large binaries referenced by a long-lived process that rarely garbage-collects. All four are visible in one minute with `:recon` or `Process.info/2`.",
  philosophy: {
    lead: "Elixir removes whole categories of bugs, so the ones that remain are worth memorising — they are few, specific, and diagnosable.",
    body: [
      "Notice what is NOT on the list: race conditions on shared state, null pointer errors, most deadlocks, and one bad request taking down the server. The BEAM's design eliminated those. What is left is mostly about unbounded growth and blocked processes, which is why the diagnostic toolkit is small: look at mailbox lengths, look at memory per process, look at ETS sizes, look at the pool.",
      "The one that surprises people most is the blocked GenServer. A single process doing a slow synchronous call inside `handle_call` makes every client wait, and because Elixir is otherwise so concurrent, the symptom (one endpoint gets slow, the rest are fine) does not look like a concurrency problem. `:recon.proc_count(:message_queue_len, 5)` finds it in seconds.",
      "The best defence is design: prefer `call` over `cast` (card 40), bound every cache, never atomise external input, and keep the read path out of single processes (card 42). The second-best defence is knowing these five commands well enough to type them under pressure.",
    ],
    diagram: `flowchart TB
  sym["SYMPTOM → LIKELY CAUSE → HOW YOU FIND IT"]:::hot
  sym --> f1["memory climbs forever → mailbox growth, from cast<br/>:recon.proc_count(:message_queue_len, 5)"]:::warn
  f1 --> f2["memory climbs forever → ETS never expires<br/>:ets.info(t, :size)"]:::warn
  f2 --> f3["memory climbs, then dies → an atom leak, from to_atom<br/>:erlang.system_info(:atom_count)"]:::warn
  f3 --> f4["memory high, GC does not help → a binary leak<br/>:recon.bin_leak(5)"]:::warn
  f4 --> f5["one endpoint slow, the others fine → a blocked GenServer, a slow handle_call<br/>:recon.proc_count(:message_queue_len, 5)"]:::warn
  f5 --> f6["intermittent 500s under load → pool exhaustion<br/>telemetry queue_time · DBConnection errors"]:::warn
  f6 --> f7["works locally, fails in prod → compile-time config in config/prod.exs<br/>move Application.get_env into runtime.exs"]:::warn
  f7 --> f8["the node dies at 3am → an unbounded queue somewhere<br/>all of the above"]:::bad
  f8 --> five["THE FIVE COMMANDS TO KNOW BY HEART<br/>:recon.proc_count(:message_queue_len, 5)   who is drowning<br/>:recon.proc_count(:memory, 5)              who is fat<br/>:erlang.memory()                           where memory lives overall<br/>:sys.get_state(pid_or_name)                what a GenServer is holding<br/>:observer.start()                          the whole picture, in dev"]:::code
  five --> prev["PREVENTION<br/>✓ call over cast   ✓ bound every cache   ✓ to_existing_atom only<br/>✓ keep hot reads out of single processes   ✓ timeouts on everything"]:::ok`,
    takeaway:
      "Almost every Elixir production problem is unbounded growth or a blocked process. Five commands find all of them.",
  },
  codeSamples: [
    {
      title: "Reproduce and find a mailbox leak",
      note: "Run it, then find the culprit as you would in production.",
      code: `defmodule Drowning do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, 0, name: __MODULE__)
  @impl true
  def init(s), do: {:ok, s}
  @impl true
  def handle_cast(:work, s) do
    Process.sleep(10)         # slower than the producers
    {:noreply, s + 1}
  end
end

{:ok, pid} = Drowning.start_link(nil)
for _ <- 1..20_000, do: GenServer.cast(Drowning, :work)

# DIAGNOSE — exactly what you would type in production:
Process.info(pid, :message_queue_len)
Process.info(pid, :memory)

Process.list()
|> Enum.map(fn p -> {p, Process.info(p, :message_queue_len)} end)
|> Enum.reject(fn {_, i} -> is_nil(i) end)
|> Enum.sort_by(fn {_, {_, len}} -> -len end)
|> Enum.take(3)

# with recon: :recon.proc_count(:message_queue_len, 5)
# FIX: use call/3 so producers are throttled (card 40)`,
    },
    {
      title: "Atom, ETS and binary leaks",
      note: "Three quick checks.",
      code: `# --- atoms ---
:erlang.system_info(:atom_count)
:erlang.system_info(:atom_limit)
# simulate the leak (do NOT do this in production):
for i <- 1..1_000, do: String.to_atom("leaked_#{i}")
:erlang.system_info(:atom_count)      # permanently higher
# FIX: String.to_existing_atom/1, or keep them as strings

# --- ETS growth ---
:ets.all()
|> Enum.map(fn t -> {(:ets.info(t, :name)), :ets.info(t, :size), :ets.info(t, :memory)} end)
|> Enum.sort_by(fn {_, _, mem} -> -(mem || 0) end)
|> Enum.take(5)
# FIX: a TTL + periodic sweep (card 47)

# --- binaries ---
:erlang.memory(:binary) |> div(1024*1024)
# FIX: :erlang.garbage_collect(pid), or hibernate idle processes,
#      or use :binary.copy/1 when keeping a small slice of a big binary
big = :crypto.strong_rand_bytes(10_000_000)
slice = binary_part(big, 0, 10)          # still REFERENCES all 10MB!
safe  = :binary.copy(binary_part(big, 0, 10))   # 10 bytes ✓`,
    },
    {
      title: "Blocked GenServer and pool exhaustion",
      note: "The two most common latency mysteries.",
      code: `# --- a GenServer blocked on slow work ---
defmodule Blocker do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  def slow, do: GenServer.call(__MODULE__, :slow, 30_000)
  def fast, do: GenServer.call(__MODULE__, :fast, 1_000)
  @impl true
  def init(s), do: {:ok, s}
  @impl true
  def handle_call(:slow, _f, s) do
    Process.sleep(3_000)                # ← blocks EVERY other client
    {:reply, :done, s}
  end
  def handle_call(:fast, _f, s), do: {:reply, :quick, s}
end

{:ok, _} = Blocker.start_link(nil)
spawn(fn -> Blocker.slow() end)
Process.sleep(100)
{t, _} = :timer.tc(fn -> Blocker.fast() end)
div(t, 1000)     # ~2900ms for a "fast" call 😱
# FIX: reply later from a Task (card 40), or move the work out entirely

# --- pool exhaustion signature ---
# ** (DBConnection.ConnectionError) connection not available and
#    request was dropped from queue after 1000ms
# ⇒ raise pool_size, shorten queries, or stop holding connections in
#   long transactions. Watch telemetry queue_time (card 94).`,
    },
    {
      title: "A pre-production checklist",
      note: "Run through this before your first deploy.",
      code: `# CONFIG
# [ ] every secret and URL is in config/runtime.exs, not prod.exs
# [ ] no Application.get_env at module top level

# PROCESSES
# [ ] every GenServer has a catch-all handle_info/2
# [ ] cast is used only where losing the message is acceptable
# [ ] no slow/blocking work inside handle_call
# [ ] every cache and ETS table has an expiry policy
# [ ] String.to_atom never touches external input

# DATABASE
# [ ] indexes on every column you filter or sort by
# [ ] preloads everywhere you render associations
# [ ] keyset pagination on large lists
# [ ] pool_size × nodes < postgres max_connections
# [ ] migrations are backwards-compatible with the running release

# WEB
# [ ] auth is on a pipeline, not per-controller
# [ ] every context function scopes by the actor
# [ ] rate limiting on public endpoints
# [ ] JSON views whitelist fields (no password_hash in responses)

# OPS
# [ ] /health/live and /health/ready endpoints
# [ ] telemetry + LiveDashboard behind admin auth
# [ ] graceful shutdown grace period > longest request
# [ ] mix test, mix format --check-formatted, mix credo, mix dialyzer in CI

# verify a few of these right now:
:erlang.system_info(:atom_count)
:ets.all() |> length()
Application.get_all_env(:shop) |> Keyword.keys()`,
    },
  ],
};
