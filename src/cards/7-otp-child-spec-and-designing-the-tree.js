export default {
  front:
    "You put `{MyWorker, arg}` in a children list. How does the supervisor know how to start it, and how do you run two copies?",
  back: "`use GenServer` injects a `child_spec/1` function returning `%{id: MyWorker, start: {MyWorker, :start_link, [arg]}, restart: :permanent, shutdown: 5000, type: :worker}`. The tuple is shorthand for calling it. Two copies need two distinct `:id`s — use `Supervisor.child_spec({MyWorker, arg}, id: :one)` to override. Children start in list ORDER and shut down in reverse.",
  philosophy: {
    lead: "The children list is a declaration of your application's dependency order and its failure domains. Read someone's application.ex and you know their architecture.",
    body: [
      "Order is a real contract: a supervisor starts children left to right and waits for each `start_link` to return before starting the next. So the Repo goes before anything that queries it, the Registry before the processes that register in it, the Endpoint last because it should only accept traffic once everything it needs is up. Shutdown runs in reverse for the same reason.",
      "Shaping the tree is the actual design work. Group processes that share a failure domain under their own supervisor, so a crash there restarts a coherent subsystem instead of the whole app. Give risky work (parsing untrusted input, calling flaky third parties) its own supervised process so it can crash freely. Keep durable or expensive-to-rebuild state near the top of the tree where it is restarted rarely, and volatile state at the leaves.",
      "The `shutdown` value matters at deploy time: it is how long the supervisor waits for `terminate/2` to finish before killing the child. Set it generously for processes that must flush buffers or finish in-flight requests, and remember that `terminate/2` is not guaranteed to run on brutal kills — never rely on it for correctness, only for tidiness.",
    ],
    diagram: `flowchart TB
  kids["children = [<br/>  Shop.Repo,                                      ← 1st: the database pool<br/>  {Registry, keys: :unique, name: Shop.Registry},<br/>  {Phoenix.PubSub, name: Shop.PubSub},<br/>  Shop.RateLimiter,<br/>  {Task.Supervisor, name: Shop.TaskSup},<br/>  Shop.SessionSupervisor,                         ← a subsystem, own strategy<br/>  ShopWeb.Endpoint                                ← LAST: take traffic only when ready<br/>]"]:::code
  kids --> order["START in order, top to bottom<br/>SHUT DOWN in REVERSE"]:::hot
  order --> sugar["{MyWorker, arg}  is sugar for  MyWorker.child_spec(arg) ⇒<br/>%{id: MyWorker, start: {MyWorker, :start_link, [arg]},<br/>  restart: :permanent, shutdown: 5_000, type: :worker}"]:::code
  sugar --> dup["TWO COPIES need distinct ids<br/>Supervisor.child_spec({Worker, :a}, id: :worker_a)<br/>Supervisor.child_spec({Worker, :b}, id: :worker_b)"]:::warn
  dup --> d1
  subgraph domains["SHAPING FAILURE DOMAINS — App Supervisor, :one_for_one"]
    direction TB
    d1["Repo — expensive, restart rarely ⇒ keep it at the TOP"]:::ok
    d2["CacheSupervisor — :one_for_all, the table and its writer die together"]:::ok
    d3["JobSupervisor — :one_for_one, jobs are independent"]:::ok
    d4["SessionSup (Dynamic) — volatile, crashes often ⇒ keep it at the LEAF"]:::ok
    d1 ~~~ d2 ~~~ d3 ~~~ d4
  end`,
    takeaway:
      "child_spec describes how to start, id, restart and shutdown. Order encodes dependencies; subtrees encode failure domains.",
  },
  codeSamples: [
    {
      title: "Look at a real child_spec",
      note: "",
      code: `defmodule Worker do
  use GenServer
  def start_link(arg), do: GenServer.start_link(__MODULE__, arg)
  @impl true
  def init(a), do: {:ok, a}
end

Worker.child_spec(:hello)
Agent.child_spec(fn -> 0 end)
Task.child_spec(fn -> :ok end)`,
    },
    {
      title: "Two copies of the same worker",
      note: "The id collision error is worth seeing once.",
      code: `# this FAILS — duplicate child id:
# Supervisor.start_link([{Worker, :a}, {Worker, :b}], strategy: :one_for_one)

{:ok, sup} =
  Supervisor.start_link(
    [
      Supervisor.child_spec({Worker, :a}, id: :worker_a),
      Supervisor.child_spec({Worker, :b}, id: :worker_b, restart: :transient)
    ],
    strategy: :one_for_one
  )

Supervisor.which_children(sup)
Supervisor.count_children(sup)`,
    },
    {
      title: "Override child_spec yourself",
      note: "When the injected default is not what you want.",
      code: `defmodule Flusher do
  use GenServer

  def child_spec(opts) do
    %{
      id: Keyword.get(opts, :id, __MODULE__),
      start: {__MODULE__, :start_link, [opts]},
      restart: :permanent,
      shutdown: 30_000,          # give terminate/2 30s to flush
      type: :worker
    }
  end

  def start_link(opts), do: GenServer.start_link(__MODULE__, opts)

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)     # needed for terminate/2 to run
    {:ok, %{buffer: [], opts: opts}}
  end

  @impl true
  def terminate(reason, state) do
    IO.puts("flushing #{length(state.buffer)} items before exit (#{inspect(reason)})")
    :ok
  end
end

{:ok, sup} = Supervisor.start_link([{Flusher, []}], strategy: :one_for_one)
Supervisor.stop(sup)      # watch terminate/2 run`,
    },
    {
      title: "Nested supervisors = failure domains",
      note: "A subsystem that restarts as a unit.",
      code: `defmodule CacheSup do
  use Supervisor
  def start_link(_), do: Supervisor.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    children = [
      Supervisor.child_spec({Agent, fn -> %{} end}, id: :cache_table),
      Supervisor.child_spec({Agent, fn -> 0 end},   id: :cache_stats)
    ]
    # these two must stay consistent, so they live and die together
    Supervisor.init(children, strategy: :one_for_all)
  end
end

defmodule AppSup do
  use Supervisor
  def start_link(_), do: Supervisor.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    children = [
      {Registry, keys: :unique, name: Demo.Registry},
      CacheSup,
      {Task.Supervisor, name: Demo.TaskSup}
    ]
    Supervisor.init(children, strategy: :one_for_one)
  end
end

{:ok, _} = AppSup.start_link(nil)
Supervisor.which_children(AppSup)
Supervisor.which_children(CacheSup)`,
    },
  ],
};
