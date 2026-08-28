export default {
  front:
    "You start one Elixir program on a 8-core laptop and it happily runs 200,000 concurrent chat users. What is actually running them?",
  back: "The BEAM virtual machine. It runs ONE operating-system process, but inside it schedules millions of tiny **BEAM processes** — each ~2KB, each with its own heap and garbage collector, each preemptively scheduled. They share no memory; they only send messages. That is why one crashing user's connection cannot corrupt or freeze the other 199,999.",
  philosophy: {
    lead: "Elixir is not a language that got concurrency added later. Concurrency is the material it is made of.",
    body: [
      "Most backend languages give you one big shared heap and then hand you locks, mutexes and thread pools so you can carefully avoid stepping on your own toes. Elixir refuses the premise. There is no shared memory to protect. A BEAM process owns its data completely, and if another process wants that data it must be sent a copy as a message.",
      "This sounds wasteful until you see what it buys. Each process gets its own garbage collector, so a GC pause is 40 microseconds on one tiny heap instead of a stop-the-world freeze. Each process is preemptively scheduled by the BEAM (about every 4000 reductions), so one process running an infinite loop cannot starve the others — unlike Node.js, where one blocking loop freezes the whole server.",
      "And because processes are isolated, a crash is local. In most stacks a crash is a catastrophe you must prevent. On the BEAM a crash is a routine event you supervise and recover from. That single inversion — 'let it crash' — is the philosophy every later card builds on.",
    ],
    diagram: `flowchart TB
  subgraph beam["ONE OS process — the BEAM VM"]
    direction TB
    subgraph s1["Scheduler 1 — one per CPU core"]
      direction LR
      p1["p1"]:::hot <-->|message, a copy| p2["p2"]:::hot
    end
    subgraph s2["Scheduler 2"]
      direction LR
      p3["p3"]:::hot ~~~ p4["p4 ✗ crashes"]:::bad
    end
    s1 ~~~ s2
  end
  beam -->|p4 dies alone — nobody else notices| alive["the other 199,999 processes<br/>keep running"]:::ok
  alive --> proc["every process: ~2KB · own heap · own GC · no shared memory<br/>preemptively scheduled, about every 4000 reductions"]:::muted
  proc --> cmpA["Java / Node — 1 heap + N threads + locks<br/>⇒ a crash is GLOBAL"]:::bad
  cmpA --> cmpB["BEAM — N heaps + N processes + messages only<br/>⇒ a crash is LOCAL"]:::ok`,
    takeaway:
      "Isolation first, messages second, crashes are normal. Everything else in Elixir is a consequence.",
  },
  codeSamples: [
    {
      title: "Prove it in iex",
      note: "Start iex in a terminal, then paste. You are spawning 200k real processes.",
      code: `# terminal:  iex
:erlang.system_info(:process_count)      # how many live right now
:erlang.system_info(:logical_processors)  # schedulers = cores

# spawn 200_000 processes that each just sleep
for _ <- 1..200_000, do: spawn(fn -> Process.sleep(10_000) end)
:erlang.system_info(:process_count)      # look at the number now`,
    },
    {
      title: "Memory per process",
      note: "Compare this to an OS thread (~1MB) or a Go goroutine (~4KB).",
      code: `pid = spawn(fn -> Process.sleep(:infinity) end)
Process.info(pid, :memory)   # {:memory, ~2600} bytes
Process.info(pid, :status)`,
    },
  ],
};
