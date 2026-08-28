export default {
  front:
    "`spawn/1` returns a PID. What exactly did you create, and how is it different from a thread?",
  back: "A **BEAM process**: an isolated unit with its own heap, stack, mailbox and garbage collector, scheduled preemptively by the VM. Creating one costs microseconds and ~2KB. It shares nothing with its creator. `self()` gives you your own PID; `spawn/1` returns the child's. A crashed process affects nobody unless they explicitly linked to it.",
  philosophy: {
    lead: "You already know how to write a tail-recursive loop (card 20). A process is that loop, running independently, with an inbox.",
    body: [
      "The word 'process' is chosen deliberately: they are like OS processes in their isolation, but like green threads in their cost. That combination is unusual and it is Elixir's core superpower. Because they are cheap, you do not pool them or ration them — you spawn one per connection, per user, per job, per state machine. Modelling the domain as one process per concurrent thing is the idiomatic design.",
      "Because they are isolated, failure is contained by default and concurrency needs no locks. Because they are preemptively scheduled, no process can hog a core. And because each has its own tiny heap, garbage collection never stops the world.",
      "Raw `spawn` is what everything else is built on, but you will almost never use it in production code. Task, Agent, GenServer and Supervisor all wrap it with error handling and lifecycle. Learn spawn to understand the machine, then use the abstractions.",
    ],
    diagram: `flowchart TB
  subgraph proc["A PROCESS = heap + stack + mailbox + GC + a PID"]
    direction LR
    heap["heap<br/>~2KB<br/>own garbage collector"]:::hot
    mbox["mailbox — a queue<br/>msg · msg · msg …"]:::hot
  end
  sender["send(pid, msg)"]:::muted --> mbox
  proc --> iso["shares NOTHING with any other process"]:::ok
  iso --> c1
  subgraph cmp["how big is a unit of concurrency?"]
    direction TB
    c1["OS thread — ~1MB · kernel scheduled · thousands, max"]:::bad
    c2["goroutine — ~4KB · no isolation · shared memory"]:::warn
    c3["BEAM process — ~2KB · isolated heap · MILLIONS · preemptive ✓"]:::ok
    c1 ~~~ c2 ~~~ c3
  end
  c3 --> api["spawn(fn -&gt; … end)      → a pid, fire and forget<br/>spawn_link(fn -&gt; … end) → a pid, linked — card 34<br/>self()                  → my own pid<br/>Process.alive?(pid)     → is it still running<br/>Process.list()          → every process on the node"]:::code
  api --> rule["ONE PROCESS PER CONCURRENT THING<br/>per request · per user · per socket · per job · per state machine"]:::warn`,
    takeaway:
      "Processes are cheap, isolated, preemptive. Model one per concurrent thing.",
  },
  codeSamples: [
    {
      title: "Your first processes",
      note: "",
      code: `self()
pid = spawn(fn -> IO.puts("hello from #{inspect(self())}") end)
Process.alive?(pid)      # likely false — it already finished

# a process that lives
worker = spawn(fn -> Process.sleep(60_000) end)
Process.alive?(worker)
Process.info(worker, [:memory, :message_queue_len, :status])`,
    },
    {
      title: "Cheapness, measured",
      note: "Time 100k processes.",
      code: `{micros, _} = :timer.tc(fn ->
  for _ <- 1..100_000, do: spawn(fn -> Process.sleep(5_000) end)
end)

IO.puts("spawned 100k in #{micros / 1000} ms")
:erlang.system_info(:process_count)`,
    },
    {
      title: "Isolation, demonstrated",
      note: "The child dies; your shell is untouched.",
      code: `spawn(fn -> raise "I am on fire" end)
# you see an error report printed by the logger…
self()                    # …and your shell process is perfectly fine ✓
1 + 1`,
    },
    {
      title: "Concurrency is real",
      note: "All ten run at once; total time is the slowest, not the sum.",
      code: `parent = self()

start = System.monotonic_time(:millisecond)
for i <- 1..10 do
  spawn(fn ->
    Process.sleep(1_000)
    send(parent, {:done, i})
  end)
end

# collect them (receive is the next card)
results = for _ <- 1..10 do
  receive do {:done, i} -> i after 3_000 -> :timeout end
end

{results, System.monotonic_time(:millisecond) - start}   # ~1000ms, not 10000`,
    },
  ],
};
