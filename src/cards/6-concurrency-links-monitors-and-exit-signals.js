export default {
  front:
    "Process A spawned B. B crashes. What happens to A — and how do you choose the answer?",
  back: "With `spawn/1`: nothing, A never hears about it. With `spawn_link/1`: an **exit signal** propagates and A dies too (unless it traps exits). With `Process.monitor/1`: A stays alive and receives a `{:DOWN, ref, :process, pid, reason}` message. Links are bidirectional and fatal by default; monitors are one-directional and informational. Supervisors are built on links plus `trap_exit`.",
  philosophy: {
    lead: "Elixir gives you two different relationships between processes, and picking the right one is how you design fault tolerance.",
    body: [
      "A **link** says: our fates are shared. If either dies abnormally, so does the other. That sounds harsh until you see the purpose: it lets a group of processes that only make sense together die together, leaving no orphans and no half-finished state. A worker and its connection, a request and its helpers.",
      "A **monitor** says: tell me when you die, but I will survive it. That is what you want when you are waiting on something you do not own — a Task you spawned, a client you are serving, a process you looked up in a registry.",
      "`Process.flag(:trap_exit, true)` changes the rules for a process: incoming exit signals become ordinary `{:EXIT, pid, reason}` messages in the mailbox instead of killing it. That is the entire mechanism a Supervisor uses to notice a child died and restart it. Trapping exits in your own workers is usually a mistake — it makes them harder to kill and defeats the supervisor.",
    ],
    diagram: `flowchart TB
  subgraph nolink["NO LINK — spawn"]
    direction LR
    a1["A"]:::ok -->|spawns| b1["B ✗ crashes"]:::bad
    b1 -.->|nothing happens| a1
  end
  subgraph link["LINK — spawn_link · bidirectional and FATAL"]
    direction LR
    a2["A ✗ dies too<br/>same exit reason"]:::bad <-->|linked| b2["B ✗ crashes"]:::bad
  end
  subgraph trap["LINK + trap_exit — Process.flag(:trap_exit, true)"]
    direction LR
    a3["A survives and DECIDES what to do<br/>this is what a SUPERVISOR is"]:::ok <-->|linked| b3["B ✗ crashes"]:::bad
    b3 -.->|"{:EXIT, pid, reason} becomes a MESSAGE"| a3
  end
  subgraph mon["MONITOR — one-way and informational · ref = Process.monitor(b)"]
    direction LR
    a4["A survives<br/>Process.demonitor(ref, [:flush])"]:::ok -->|watches| b4["B ✗ crashes"]:::bad
    b4 -.->|"{:DOWN, ref, :process, pid, reason}"| a4
  end
  nolink ~~~ link
  link ~~~ trap
  trap ~~~ mon
  mon --> notes["a :normal exit does NOT kill a linked process<br/>Process.exit(pid, :kill) is untrappable — the nuclear option"]:::warn`,
    takeaway:
      "Links share fate; monitors just notify. trap_exit turns death into a message — that is a supervisor.",
  },
  codeSamples: [
    {
      title: "Link is fatal",
      note: "Do this in a THROWAWAY iex — it kills your shell process.",
      code: `# unlinked: shell survives, learns nothing
spawn(fn -> raise "boom" end)
self()

# linked: the shell process itself dies and restarts (you keep the session,
# but note the new PID and that all your bindings are gone)
self()
spawn_link(fn -> raise "boom" end)
self()          # different PID — your shell was killed and restarted`,
    },
    {
      title: "Monitor is safe",
      note: "You get a message, not a death.",
      code: `{pid, ref} = spawn_monitor(fn -> Process.sleep(200); raise "nope" end)

receive do
  {:DOWN, ^ref, :process, ^pid, reason} -> {:it_died, reason}
after
  2_000 -> :still_running
end`,
    },
    {
      title: "trap_exit — build a mini supervisor",
      note: "This is the core of OTP supervision, in 20 lines.",
      code: `defmodule MiniSup do
  def start(worker_fun) do
    spawn(fn ->
      Process.flag(:trap_exit, true)
      loop(worker_fun, spawn_link(worker_fun), 0)
    end)
  end

  defp loop(fun, pid, restarts) do
    receive do
      {:EXIT, ^pid, :normal} ->
        IO.puts("worker finished normally, stopping supervisor")
        :ok

      {:EXIT, ^pid, reason} ->
        IO.puts("worker died (#{inspect(reason)}) — restart ##{restarts + 1}")
        Process.sleep(200)
        loop(fun, spawn_link(fun), restarts + 1)
    end
  end
end

MiniSup.start(fn ->
  Process.sleep(500)
  raise "flaky worker"
end)
# watch it restart over and over`,
    },
    {
      title: "Cleaning up and killing",
      note: "",
      code: `p = spawn(fn -> Process.sleep(:infinity) end)
ref = Process.monitor(p)
Process.exit(p, :shutdown)        # trappable
receive do msg -> msg after 500 -> :none end

q = spawn(fn -> Process.flag(:trap_exit, true); Process.sleep(:infinity) end)
Process.exit(q, :shutdown)        # trapped: becomes a message, q survives
Process.alive?(q)
Process.exit(q, :kill)            # :kill is NEVER trappable
Process.alive?(q)

Process.info(self(), :links)
Process.info(self(), :monitors)`,
    },
  ],
};
