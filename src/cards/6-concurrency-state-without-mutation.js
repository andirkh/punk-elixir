export default {
  front:
    "Everything is immutable and there are no variables to update. So where does a running server keep its state?",
  back: "In the ARGUMENTS of an infinite tail-recursive loop inside a process. `loop(state)` receives a message, computes a NEW state, and calls `loop(new_state)`. The old state is simply garbage. The process identity (its PID) stays constant while the value it carries changes — that is mutable state built entirely out of immutable values.",
  philosophy: {
    lead: "This is the single most important idea in the deck. Read the code sample twice; every GenServer, every Phoenix channel and every connection pool is this loop.",
    body: [
      "Immutability seemed to forbid stateful servers. The resolution is to move state out of memory cells and into TIME: state is what the loop is currently holding. Nothing is overwritten; the loop just recurses with a different value. Because it is a tail call (card 20), this runs forever in constant memory.",
      "Notice what you get for free. The state is only reachable from inside that one process, so it can never be corrupted by concurrent access — the mailbox serialises every request into a queue. You have mutual exclusion without a single lock, purely as a consequence of the process model.",
      "Once you see the loop, GenServer stops being magic: it is this exact pattern with the boilerplate extracted, plus timeouts, error reporting, system introspection and supervisor integration. Write the raw version once so that you always know what is underneath.",
    ],
    diagram: `flowchart TB
  loop0["defp loop(state) do<br/>  receive do<br/>    {:put, k, v}    -&gt; loop(Map.put(state, k, v))   ← a NEW state<br/>    {:get, k, from} -&gt; send(from, Map.get(state, k))<br/>                       loop(state)                   ← the same state<br/>    :stop           -&gt; :ok                           ← the loop ends, the process dies<br/>  end<br/>end"]:::code
  loop0 --> tl
  subgraph tl["TIME — each message produces the NEXT state"]
    direction LR
    s0["loop(%{})"]:::muted -->|"{:put, :a, 1}"| s1["loop(%{a: 1})"]:::hot -->|"{:put, :b, 2}"| s2["loop(%{a: 1, b: 2})"]:::ok
  end
  tl --> garb["the old values are simply garbage<br/>the current one is unreachable from outside the process"]:::muted
  garb --> safe["WHY THIS IS SAFE WITHOUT LOCKS<br/>1000 processes send at once → all land in ONE mailbox queue<br/>the loop handles them ONE AT A TIME, in order<br/>⇒ serialised access, zero locks, zero race conditions<br/>⇒ but also ONE process = ONE bottleneck — see card 42"]:::warn`,
    takeaway:
      "State lives in the loop's arguments. The mailbox serialises access, so no locks are ever needed.",
  },
  codeSamples: [
    {
      title: "A key-value store from scratch",
      note: "No GenServer. This is the whole idea in 25 lines.",
      code: `defmodule KV do
  # ---------- client API (runs in the CALLER's process) ----------
  def start(initial \\\\ %{}), do: spawn(fn -> loop(initial) end)

  def put(pid, k, v), do: send(pid, {:put, k, v})

  def get(pid, k) do
    send(pid, {:get, k, self()})
    receive do
      {:value, v} -> v
    after
      1_000 -> {:error, :timeout}
    end
  end

  def stop(pid), do: send(pid, :stop)

  # ---------- server loop (runs in the SPAWNED process) ----------
  defp loop(state) do
    receive do
      {:put, k, v}    -> loop(Map.put(state, k, v))
      {:get, k, from} -> send(from, {:value, Map.get(state, k)}); loop(state)
      :stop           -> :ok
      other           -> IO.puts("ignoring #{inspect(other)}"); loop(state)
    end
  end
end

kv = KV.start()
KV.put(kv, :name, "Ada")
KV.put(kv, :lang, "Elixir")
KV.get(kv, :name)
KV.get(kv, :missing)`,
    },
    {
      title: "A counter, and proof of serialisation",
      note: "1000 concurrent increments, no lock, no lost updates.",
      code: `defmodule Counter do
  def start, do: spawn(fn -> loop(0) end)
  def inc(pid), do: send(pid, :inc)
  def value(pid) do
    send(pid, {:value, self()})
    receive do {:value, n} -> n after 1_000 -> :timeout end
  end

  defp loop(n) do
    receive do
      :inc            -> loop(n + 1)
      {:value, from}  -> send(from, {:value, n}); loop(n)
    end
  end
end

c = Counter.start()
for _ <- 1..1000, do: spawn(fn -> Counter.inc(c) end)
Process.sleep(200)
Counter.value(c)      # exactly 1000 ✓ — no locks were used`,
    },
    {
      title: "State machines are natural here",
      note: "The clause you are in IS the state.",
      code: `defmodule Door do
  def start, do: spawn(fn -> closed() end)

  defp closed do
    IO.puts("[closed]")
    receive do
      {:open, from}  -> send(from, :ok); open()
      {:lock, from}  -> send(from, :ok); locked()
      {_, from}      -> send(from, {:error, :invalid}); closed()
    end
  end

  defp open do
    IO.puts("[open]")
    receive do
      {:close, from} -> send(from, :ok); closed()
      {_, from}      -> send(from, {:error, :invalid}); open()
    end
  end

  defp locked do
    IO.puts("[locked]")
    receive do
      {:unlock, from} -> send(from, :ok); closed()
      {_, from}       -> send(from, {:error, :locked}); locked()
    end
  end
end

d = Door.start()
send(d, {:open, self()}); flush()
send(d, {:lock, self()}); flush()   # invalid from open`,
    },
    {
      title: "Inspect a live process",
      note: "See the state and the queue from outside.",
      code: `kv = KV.start(%{a: 1})
KV.put(kv, :b, 2)
Process.info(kv, :message_queue_len)
Process.info(kv, :current_function)
Process.info(kv, :memory)
# note: you cannot see the state — it is private to the loop.
# GenServer adds :sys.get_state/1 for exactly this reason.`,
    },
  ],
};
