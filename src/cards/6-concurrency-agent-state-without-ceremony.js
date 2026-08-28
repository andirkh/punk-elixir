export default {
  front:
    "You want the counter from card 33 but do not want to write a receive loop. What is the one-liner?",
  back: "`Agent`. `Agent.start_link(fn -> 0 end)` creates a process holding a value; `Agent.get(pid, & &1)` reads it, `Agent.update(pid, &(&1 + 1))` transforms it. The functions you pass are executed INSIDE the agent's process. It is a GenServer with only state and no behaviour — perfect for simple shared state, wrong the moment you need logic.",
  philosophy: {
    lead: "Agent is the training-wheels version of the loop you wrote by hand, and knowing its limits tells you when you actually need a GenServer.",
    body: [
      "The key mental model: the anonymous function you pass runs in the agent's process, not yours. That is why it is safe, and also why passing a slow function blocks every other client of that agent. `Agent.get_and_update/2` exists so you can read-and-write atomically in one trip — using separate get then update is a genuine race condition, since another process can interleave between them.",
      "Agent is right for a cache of config values, a counter, a small registry — things where the process is a box and all the logic lives in the caller. It becomes wrong as soon as you want the process itself to do something: react to timers, handle crashes, talk to other processes, enforce invariants. That is a GenServer.",
      "A useful production caveat: any single process is a serialisation point. If a hot code path funnels through one agent, you have built a bottleneck. Card 42 covers what to do about it.",
    ],
    diagram: `flowchart TB
  st["Agent.start_link(fn -&gt; %{} end, name: Cache)"]:::hot
  st --> o1
  subgraph ops["YOUR PROCESS calls · the AGENT PROCESS runs your function on its state"]
    direction TB
    o1["Agent.get(Cache, fun) → runs fun on the state → a value"]:::ok
    o2["Agent.update(Cache, fun) → state = fun.(state)"]:::ok
    o3["Agent.get_and_update(C, fun) → {reply, new_state} = fun.(state) · ATOMIC"]:::ok
    o4["Agent.cast(Cache, fun) → fire and forget, no reply"]:::warn
    o1 ~~~ o2 ~~~ o3 ~~~ o4
  end
  o4 --> race
  subgraph race["the race you will write once"]
    direction LR
    bad0["✗ TWO round trips — another client can interleave<br/>n = Agent.get(c, fun)<br/>Agent.update(c, fn _ -&gt; n + 1 end)<br/>⇒ lost updates"]:::bad
    good0["✓ ONE round trip<br/>Agent.get_and_update(c, fn n -&gt; {n, n + 1} end)"]:::ok
  end
  race --> pick["AGENT when the process is just a BOX — state only<br/>GENSERVER when the process must ACT — logic, timers, crashes,<br/>invariants, talking to other processes"]:::hot`,
    takeaway:
      "Agent holds state and runs your function inside itself. Use get_and_update for atomicity.",
  },
  codeSamples: [
    {
      title: "The counter, again",
      note: "Compare to the 25 lines in card 33.",
      code: `{:ok, counter} = Agent.start_link(fn -> 0 end)

Agent.update(counter, &(&1 + 1))
Agent.update(counter, &(&1 + 10))
Agent.get(counter, & &1)             # 11

# atomic read-modify-write
Agent.get_and_update(counter, fn n -> {n, n * 2} end)   # returns 11
Agent.get(counter, & &1)                                # 22`,
    },
    {
      title: "A named cache module",
      note: "Wrap the Agent so callers never see it — good API hygiene.",
      code: `defmodule Cache do
  use Agent

  def start_link(_opts \\\\ []), do: Agent.start_link(fn -> %{} end, name: __MODULE__)

  def get(key),        do: Agent.get(__MODULE__, &Map.get(&1, key))
  def put(key, value), do: Agent.update(__MODULE__, &Map.put(&1, key, value))
  def delete(key),     do: Agent.update(__MODULE__, &Map.delete(&1, key))
  def keys,            do: Agent.get(__MODULE__, &Map.keys/1)

  def fetch_or_compute(key, fun) do
    Agent.get_and_update(__MODULE__, fn state ->
      case Map.fetch(state, key) do
        {:ok, v} -> {v, state}
        :error   -> v = fun.(); {v, Map.put(state, key, v)}
      end
    end)
  end
end

Cache.start_link()
Cache.put(:lang, "Elixir")
Cache.get(:lang)
Cache.fetch_or_compute(:slow, fn -> Process.sleep(300); :computed end)
Cache.fetch_or_compute(:slow, fn -> :never_runs_again end)
Cache.keys()`,
    },
    {
      title: "Prove the race is real",
      note: "Run both blocks and compare the numbers.",
      code: `{:ok, a} = Agent.start_link(fn -> 0 end)
for _ <- 1..500 do
  spawn(fn ->
    n = Agent.get(a, & &1)          # ← two trips
    Agent.update(a, fn _ -> n + 1 end)
  end)
end
Process.sleep(500)
Agent.get(a, & &1)                  # usually LESS than 500 😱

{:ok, b} = Agent.start_link(fn -> 0 end)
for _ <- 1..500 do
  spawn(fn -> Agent.get_and_update(b, fn n -> {n, n + 1} end) end)
end
Process.sleep(500)
Agent.get(b, & &1)                  # exactly 500 ✓`,
    },
    {
      title: "Where an Agent bottlenecks",
      note: "Slow functions run inside the agent and block everyone.",
      code: `{:ok, slow} = Agent.start_link(fn -> 0 end)

# this occupies the agent for a full second — all other clients wait:
spawn(fn -> Agent.update(slow, fn n -> Process.sleep(1_000); n + 1 end) end)
Process.sleep(50)

{time, _} = :timer.tc(fn -> Agent.get(slow, & &1) end)
div(time, 1000)      # ~950ms of waiting for an unrelated read`,
    },
  ],
};
