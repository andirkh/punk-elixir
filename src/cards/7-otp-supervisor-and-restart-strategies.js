export default {
  front:
    "A worker crashes. Which of its siblings should be restarted with it — and how do you tell the supervisor?",
  back: "The **strategy**. `:one_for_one` restarts only the dead child (the default, and right when children are independent). `:one_for_all` restarts all of them (when they share state and must be consistent). `:rest_for_one` restarts the dead child and everything started AFTER it (when later children depend on earlier ones). Plus `max_restarts`/`max_seconds`: exceed them and the supervisor gives up and escalates to ITS supervisor.",
  philosophy: {
    lead: "A supervisor is a process whose only job is to start children, watch them via links, and restart them according to a declared policy.",
    body: [
      "The escalation rule is the part people miss and it is the heart of the design. A supervisor that cannot fix the problem by restarting — because the child keeps dying, exceeding `max_restarts` within `max_seconds` — kills its remaining children and dies itself. Its own supervisor then sees a dead child and applies its policy, restarting a larger subsystem. Failure escalates up the tree until some level of restart is big enough to actually clear the problem, and in the worst case the whole application restarts. That is a designed, bounded response to unknown failure.",
      "Choosing a strategy is domain modelling. Ask: if this child dies, is any sibling now holding stale references or inconsistent state? If yes, they must restart too. A connection pool and the process caching its handles are `:one_for_all`. Independent request handlers are `:one_for_one`.",
      "Restart *type* is the other dial: `:permanent` (always restart — the default), `:transient` (restart only on abnormal exit — right for jobs that can legitimately finish), `:temporary` (never restart — right for one-off tasks).",
    ],
    diagram: `flowchart TB
  sup["Supervisor<br/>max_restarts: 3, max_seconds: 5<br/>exceeded ⇒ the supervisor dies too ⇒ it escalates"]:::hot
  sup --> ka["A"]:::ok
  sup --> kb["B ✗"]:::bad
  sup --> kc["C"]:::ok
  kb --> s1
  subgraph strat["WHICH SIBLINGS ALSO RESTART?"]
    direction TB
    s1[":one_for_one — A ok · B ↻ · C ok — independent children"]:::ok
    s2[":one_for_all — A ↻ · B ↻ · C ↻ — they share state"]:::warn
    s3[":rest_for_one — A ok · B ↻ · C ↻ — C depends on B"]:::warn
    s1 ~~~ s2 ~~~ s3
  end
  s3 --> e1
  subgraph esc["ESCALATION — how the BEAM handles the unknown"]
    direction TB
    e1["Worker ✗ — first line: restart just this one"]:::hot
    e2["Worker Supervisor — still broken? restart the group"]:::hot
    e3["Subsystem Supervisor — still broken? restart the subsystem"]:::hot
    e4["Application Supervisor — still broken? restart the whole app"]:::hot
    e1 --> e2 --> e3 --> e4
  end
  e4 --> types["RESTART TYPES<br/>:permanent — always restart · the default, for long-lived servers<br/>:transient — restart only on an abnormal exit · jobs that may finish<br/>:temporary — never restart · fire-and-forget tasks<br/><br/>SHUTDOWN<br/>shutdown: 5_000 — ask nicely, terminate/2 runs, then brutal kill<br/>shutdown: :brutal_kill ¦ :infinity — the latter for supervisors"]:::code`,
    takeaway:
      "Strategy = which siblings share fate. Exceeding restart limits escalates failure up the tree.",
  },
  codeSamples: [
    {
      title: "A supervisor with three children",
      note: "Paste, then kill children and watch.",
      code: `defmodule Worker do
  use GenServer
  def start_link(name), do: GenServer.start_link(__MODULE__, name, name: name)
  @impl true
  def init(name) do
    IO.puts("  [start] #{name} as #{inspect(self())}")
    {:ok, %{name: name, started_at: System.monotonic_time(:millisecond)}}
  end
  @impl true
  def handle_call(:boom, _f, s), do: raise("#{s.name} exploded")
  def handle_call(:info, _f, s), do: {:reply, s, s}
end

defmodule Tree do
  use Supervisor
  def start_link(strategy), do: Supervisor.start_link(__MODULE__, strategy, name: __MODULE__)

  @impl true
  def init(strategy) do
    children = [
      Supervisor.child_spec({Worker, :alpha}, id: :alpha),
      Supervisor.child_spec({Worker, :beta},  id: :beta),
      Supervisor.child_spec({Worker, :gamma}, id: :gamma)
    ]
    Supervisor.init(children, strategy: strategy, max_restarts: 3, max_seconds: 5)
  end
end

{:ok, _} = Tree.start_link(:one_for_one)
Supervisor.which_children(Tree)`,
    },
    {
      title: "Kill one and compare strategies",
      note: "Restart Tree with a different strategy and repeat.",
      code: `# with :one_for_one — only beta restarts
try do GenServer.call(:beta, :boom) catch :exit, _ -> :crashed end
Process.sleep(100)
Supervisor.which_children(Tree)     # only beta has a new PID

Supervisor.stop(Tree)
{:ok, _} = Tree.start_link(:one_for_all)
try do GenServer.call(:beta, :boom) catch :exit, _ -> :crashed end
Process.sleep(100)
Supervisor.which_children(Tree)     # ALL three have new PIDs

Supervisor.stop(Tree)
{:ok, _} = Tree.start_link(:rest_for_one)
try do GenServer.call(:beta, :boom) catch :exit, _ -> :crashed end
Process.sleep(100)
Supervisor.which_children(Tree)     # beta and gamma restarted, alpha kept`,
    },
    {
      title: "Watch escalation happen",
      note: "Crash faster than max_restarts allows.",
      code: `{:ok, sup} = Tree.start_link(:one_for_one)

for _ <- 1..5 do
  try do GenServer.call(:beta, :boom) catch :exit, _ -> :crashed end
  Process.sleep(50)
end
Process.sleep(200)
Process.alive?(sup)
# false — max_restarts exceeded, the supervisor gave up and died.
# In a real app its OWN supervisor would now restart this whole subtree.`,
    },
    {
      title: "Restart types in practice",
      note: "",
      code: `defmodule Finisher do
  use GenServer, restart: :transient        # ← declared here
  def start_link(_), do: GenServer.start_link(__MODULE__, nil)
  @impl true
  def init(_), do: {:ok, nil, 500}
  @impl true
  def handle_info(:timeout, s), do: {:stop, :normal, s}   # a normal finish
end

{:ok, sup} = Supervisor.start_link([Finisher], strategy: :one_for_one)
Process.sleep(800)
Supervisor.which_children(sup)   # :undefined — normal exit, not restarted ✓
Supervisor.stop(sup)`,
    },
  ],
};
