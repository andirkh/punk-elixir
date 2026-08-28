export default {
  front:
    "Put all 73 cards together. Trace one HTTP request and one websocket message through every layer you have learned, naming the process at each step.",
  back: "HTTP: a Cowboy acceptor spawns a request process → Endpoint plugs → Router pipeline (auth plug assigns the user) → Controller action → Context function (authorised, scoped) → Ecto changeset → Repo checks out a pooled connection → Postgres → PubSub broadcast → JSON view → response. Websocket: Socket process (authenticated once) → Channel process per topic → `handle_in` → same context → broadcast → every subscribed channel on every node pushes to its client. Every box is a supervised process; every crash is local.",
  philosophy: {
    lead: "The whole deck is one idea repeated at increasing scale: isolate state in a process, supervise it, pass messages, let it crash.",
    body: [
      "Look back at what stayed constant. A function clause matching a shape (card 12) became a router matching a path (card 50). A tail-recursive loop holding state (card 33) became a GenServer (card 39), then a channel (card 88), then a chat room under a DynamicSupervisor (card 45). A tagged tuple (card 4) became `with` (card 22), then a context return value (card 52), then an `action_fallback` clause (card 51). You did not learn a web framework on top of a language — you learned one set of ideas applied at every layer.",
      "The architecture that falls out is unusually simple to reason about: a supervision tree you can read in one file, a domain layer with no framework in it, a thin translation layer for HTTP and websockets, Postgres for durability, ETS for speed, and processes for everything that is alive. There is no dependency injection framework, no message broker, no cache server and no thread pool tuning, because the runtime already provides those.",
      "Where to go next: build something with real users. Then read the Ecto and Phoenix source — both are readable and both use exactly the constructs in this deck. After that, `Broadway` and `GenStage` for data pipelines, `LiveView` if you want server-rendered realtime UI, and Saša Jurić's *Elixir in Action* for the deepest treatment of OTP design.",
    ],
    diagram: `flowchart TB
  root["Shop.Supervisor — the root<br/>Telemetry · Repo(pool) · PubSub · Registry · TaskSup · Oban<br/>DynamicSupervisor(sessions) · Presence · Endpoint"]:::hot
  root --> h1
  root --> w1
  subgraph http["AN HTTP REQUEST"]
    direction TB
    h1["TCP accept → a request PROCESS"]:::ok
    h2["Endpoint plugs — log, parse, session"]:::ok
    h3["Router pipeline → Auth plug<br/>assigns current_user"]:::ok
    h4["Controller action"]:::ok
    h1 --> h2 --> h3 --> h4
  end
  subgraph wsx["A WEBSOCKET MESSAGE"]
    direction TB
    w1["Socket PROCESS — authenticated once"]:::ok
    w2["Channel PROCESS per topic"]:::ok
    w3["handle_in — validate, rate limit"]:::ok
    w1 --> w2 --> w3
  end
  h4 --> ctx["THE CONTEXT — the ONE shared core, always scoped by the actor<br/>with {:ok, x} &lt;- Context.do_thing(user, params)"]:::hot
  w3 --> ctx
  ctx --> db["Changeset → Repo → the pool → Postgres"]:::ok
  db --> bc["broadcast via PubSub → every node"]:::ok
  bc --> outs["JSON view, a whitelist → the HTTP response<br/>push → each client socket"]:::ok
  outs --> truth["EVERY box is a supervised process. Every crash is local.<br/>Every layer is the same five ideas from cards 1–47."]:::warn
  truth --> next0["WHAT TO BUILD NEXT<br/>1. SQL on SQLite, then Postgres + Ecto + auth   cards 54–87<br/>2. add a websocket channel + Presence           cards 88–91<br/>3. add Oban jobs, an ETS cache, rate limiting   cards 92–93<br/>4. add telemetry, release it, cluster it        cards 94–96"]:::hot`,
    takeaway:
      "One set of ideas — isolate, supervise, message, let it crash — applied from a function clause up to a cluster.",
  },
  codeSamples: [
    {
      title: "The complete application tree",
      note: "Everything from this deck, in one file.",
      code: `defmodule Shop.Application do
  use Application

  @impl true
  def start(_type, _args) do
    topologies = Application.get_env(:libcluster, :topologies) || []

    children = [
      # clustering first, so PubSub and Presence see their peers
      {Cluster.Supervisor, [topologies, [name: Shop.ClusterSupervisor]]},

      # observability
      Shop.Telemetry,

      # data
      Shop.Repo,

      # process infrastructure
      {Registry, keys: :unique, name: Shop.Registry},
      {Phoenix.PubSub, name: Shop.PubSub},
      ShopWeb.Presence,

      # caches (own their ETS tables)
      Shop.Cache,
      Shop.RateLimiter,

      # background work
      {Task.Supervisor, name: Shop.TaskSupervisor},
      {Oban, Application.fetch_env!(:shop, Oban)},

      # one process per live entity
      {DynamicSupervisor, name: Shop.SessionSupervisor, strategy: :one_for_one},

      # accept traffic LAST
      ShopWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: Shop.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    ShopWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end`,
    },
    {
      title: "One feature through every layer",
      note: "Place an order: HTTP in, websocket out. All 74 cards at once.",
      code: `# 1 ── ROUTER (card 50)
# scope "/api", ShopWeb do
#   pipe_through [:api, :authed]
#   resources "/orders", OrderController, only: [:create, :show, :index]
# end

# 2 ── CONTROLLER (card 51): params in, one context call, render out
defmodule ShopWeb.OrderController do
  use ShopWeb, :controller
  action_fallback ShopWeb.FallbackController

  def create(conn, %{"order" => params}) do
    with {:ok, order} <- Shop.Checkout.place(conn.assigns.current_user, params) do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/orders/#{order.id}")
      |> render(:show, order: order)
    end
  end
end

# 3 ── CONTEXT (cards 52, 85, 91, 92): authorised, transactional, durable
defmodule Shop.Checkout do
  alias Ecto.Multi
  alias Shop.{Repo, Orders.Order, Workers.ReceiptEmail}

  def place(user, params) do
    Multi.new()
    |> Multi.insert(:order, Order.changeset(%Order{user_id: user.id}, params))
    |> Multi.run(:charge, fn _repo, %{order: o} -> Shop.Billing.charge(user, o.total_cents) end)
    |> Multi.update(:paid, fn %{order: o} -> Ecto.Changeset.change(o, status: :paid) end)
    |> Oban.insert(:receipt, fn %{paid: o} -> ReceiptEmail.new(%{order_id: o.id}) end)
    |> Repo.transaction()
    |> case do
         {:ok, %{paid: order}} ->
           Shop.Cache.invalidate({:orders, user.id})
           Phoenix.PubSub.broadcast(Shop.PubSub, "user:#{user.id}", {:order_paid, order})
           {:ok, order}

         {:error, :charge, reason, _} -> {:error, {:payment_failed, reason}}
         {:error, _step, %Ecto.Changeset{} = cs, _} -> {:error, cs}
       end
  end
end

# 4 ── CHANNEL (cards 88, 89): the same event, pushed live to every device
defmodule ShopWeb.UserChannel do
  use ShopWeb, :channel

  @impl true
  def join("user:" <> id, _params, socket) do
    if to_string(socket.assigns.current_user.id) == id do
      Phoenix.PubSub.subscribe(Shop.PubSub, "user:#{id}")
      {:ok, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_info({:order_paid, order}, socket) do
    push(socket, "order_paid", %{id: order.id, total_cents: order.total_cents})
    {:noreply, socket}
  end
  def handle_info(_, socket), do: {:noreply, socket}
end`,
    },
    {
      title: "Your first project, step by step",
      note: "Do this, in this order, and you will have shipped a service.",
      code: `# 1. scaffold
mix phx.new shop --no-html --no-assets --binary-id
cd shop && mix ecto.create

# 2. auth (read the generated code — it teaches a lot)
mix phx.gen.auth Accounts User users
mix deps.get && mix ecto.migrate

# 3. a domain slice
mix phx.gen.json Orders Order orders total_cents:integer status:string \\
  user_id:references:users
# then: add the routes it prints, and write context tests FIRST

# 4. realtime
# add UserSocket + a channel + Presence  (cards 88-90)

# 5. background + cache
# add {:oban, "~> 2.17"}, a worker, and Shop.Cache  (cards 92-93)

# 6. observability
# add LiveDashboard + Shop.Telemetry  (card 94)

# 7. ship
MIX_ENV=prod mix release
# Dockerfile from card 95; DATABASE_URL + SECRET_KEY_BASE as env vars

# 8. keep learning
# - read the Ecto and Phoenix source; both are readable
# - "Elixir in Action" (Saša Jurić) for OTP design
# - "Designing Elixir Systems with OTP" for architecture
# - Broadway / GenStage for data pipelines
# - LiveView if you want server-rendered realtime UI`,
    },
    {
      title: "A parting exercise",
      note: "If you can do this from memory, you have the deck.",
      code: `# Build, in one file, in iex, without looking anything up:
#
#  1. a GenServer that holds a map of counters
#  2. named via a Registry so you can have one per user
#  3. started on demand by a DynamicSupervisor
#  4. reads served from an ETS table, writes through the GenServer
#  5. an idle timeout that shuts a counter down after 30s
#  6. supervised so a crash restarts it empty
#  7. broadcasting every increment over PubSub
#
# That single exercise uses cards 33, 38, 39, 40, 41, 42, 43, 45, 47 and 53.
# Everything else in this deck is that same machine, wearing a web layer.

IO.puts("Good luck. Now go build something.")`,
    },
  ],
};
