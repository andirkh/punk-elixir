export default {
  front:
    "Where does the very first process come from, and what does `mix.exs`'s `mod:` key actually do?",
  back: "`mod: {Shop.Application, []}` tells the BEAM to call `Shop.Application.start/2` when the application boots. That callback returns `Supervisor.start_link(children, strategy: :one_for_one)` — the ROOT supervisor. Everything else in your service hangs off it. Applications also declare dependencies, so starting yours starts Ecto, Logger, Phoenix and the rest in the right order.",
  philosophy: {
    lead: "An OTP application is a unit of start-up, shutdown and dependency — and your whole service is one node running a set of them.",
    body: [
      "This is the top of everything you have learned. Processes hold state, supervisors restart them, and the Application is the single supervisor that owns them all. When the BEAM boots a release it starts each application in dependency order, and `Application.start/2` builds your tree. When you deploy, `stop/1` and the reverse shutdown order let things drain cleanly.",
      "Reading `application.ex` should be the first thing you do in an unfamiliar Elixir codebase: it lists every long-running thing in the system, in dependency order. Writing a good one is likewise the first thing you do in a new service.",
      "Two practical hooks live here. `Application.get_env/3` reads the config from card 28. And `config_change/3` lets a hot-upgraded release react to new config, which is niche but explains why the callback exists.",
    ],
    diagram: `flowchart TB
  mix0["mix.exs — def application, do: [mod: {Shop.Application, []}, …]"]:::code
  mix0 --> app["lib/shop/application.ex<br/>def start(_type, _args) do<br/>  children = [ … ]<br/>  Supervisor.start_link(children,<br/>    strategy: :one_for_one, name: Shop.Supervisor)<br/>end"]:::code
  app --> root["Shop.Supervisor — THE ROOT"]:::hot
  root --> infra["Telemetry · Shop.Repo (the pg pool) · PubSub · Registry"]:::ok
  root --> dyn["DynamicSupervisor"]:::ok
  root --> ep["Endpoint — started LAST"]:::ok
  dyn --> rooms["room1 · room2 · … one process per entity"]:::muted
  ep --> boot["BOOT ORDER — dependency apps first (logger, ecto, phoenix),<br/>then yours, then your children left to right.<br/>SHUTDOWN is exactly the reverse."]:::warn
  boot --> api["Application.started_applications()   what is running<br/>Application.ensure_all_started(:shop)  start it and its deps<br/>Application.stop(:shop)                graceful, reverse order"]:::code`,
    takeaway:
      "Application.start builds the root supervisor. application.ex is the map of your entire running system.",
  },
  codeSamples: [
    {
      title: "A realistic application.ex",
      note: "lib/shop/application.ex — this is your service, declared.",
      code: `defmodule Shop.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # 1. observability first, so everything after is measured
      Shop.Telemetry,

      # 2. the database pool — nothing that queries can start before it
      Shop.Repo,

      # 3. process-addressing infrastructure
      {Registry, keys: :unique, name: Shop.Registry},
      {Phoenix.PubSub, name: Shop.PubSub},

      # 4. background machinery
      {Task.Supervisor, name: Shop.TaskSupervisor},
      {DynamicSupervisor, name: Shop.SessionSupervisor, strategy: :one_for_one},
      Shop.RateLimiter,

      # 5. accept traffic LAST
      ShopWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Shop.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # called on hot config change in a release
  @impl true
  def config_change(changed, _new, removed) do
    ShopWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end`,
    },
    {
      title: "Inspect the running system",
      note: "Run in iex -S mix inside any project.",
      code: `Application.started_applications() |> Enum.take(10)
Application.spec(:elixir, :vsn)
Application.get_application(Enum)

# the whole supervision tree of a running app:
Supervisor.which_children(Shop.Supervisor)

# or visually — this opens a GUI with the live tree:
# :observer.start()`,
    },
    {
      title: "Build a tiny application by hand",
      note: "Works in plain iex, no project needed.",
      code: `defmodule Demo.Worker do
  use GenServer
  def start_link(name), do: GenServer.start_link(__MODULE__, name, name: name)
  @impl true
  def init(n), do: {:ok, %{name: n, count: 0}}
  @impl true
  def handle_call(:ping, _f, s), do: {:reply, {:pong, s.name}, %{s | count: s.count + 1}}
end

children = [
  {Registry, keys: :unique, name: Demo.Registry},
  Supervisor.child_spec({Demo.Worker, :api}, id: :api),
  Supervisor.child_spec({Demo.Worker, :jobs}, id: :jobs),
  {Task.Supervisor, name: Demo.TaskSup}
]

{:ok, root} = Supervisor.start_link(children, strategy: :one_for_one, name: Demo.Supervisor)

GenServer.call(:api, :ping)
Supervisor.which_children(Demo.Supervisor)
Supervisor.count_children(Demo.Supervisor)`,
    },
    {
      title: "Graceful shutdown order",
      note: "Watch reverse-order termination.",
      code: `defmodule Loud do
  use GenServer
  def start_link(n), do: GenServer.start_link(__MODULE__, n)
  @impl true
  def init(n) do
    Process.flag(:trap_exit, true)
    IO.puts("  start #{n}")
    {:ok, n}
  end
  @impl true
  def terminate(_r, n) do
    IO.puts("  stop  #{n}")
    :ok
  end
end

kids = for n <- [:first, :second, :third],
       do: Supervisor.child_spec({Loud, n}, id: n)

{:ok, s} = Supervisor.start_link(kids, strategy: :one_for_one)
Supervisor.stop(s)     # third, second, first — reverse ✓`,
    },
  ],
};
