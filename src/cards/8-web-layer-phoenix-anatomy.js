export default {
  front:
    "You run `mix phx.new shop --no-html --no-assets`. What are the layers a request passes through, top to bottom?",
  back: "**Endpoint** (a plug pipeline: logging, parsers, sessions) → **Router** (pipelines + route matching) → **Controller** (an action function) → **Context** (your business logic and Ecto calls) → **View/JSON** (rendering). Underneath, every single request is handled by its own supervised process — Phoenix is a thin, well-organised layer over Plug and OTP.",
  philosophy: {
    lead: "Phoenix's real contribution is not the HTTP handling — it is the discipline of separating the web layer from your domain.",
    body: [
      "Notice the shape: Endpoint, Router and Controller are all Plug pipelines, so everything from card 48 applies unchanged. The Endpoint is itself a supervised process in your tree (card 46), which is why it goes last in the children list.",
      "The layer that matters most for your architecture is the **context**. Phoenix deliberately generates `lib/shop/accounts.ex` (business logic) separately from `lib/shop_web/controllers/` (HTTP). The controller's job is to translate HTTP into a function call and translate the result back into a response. If your controller contains Ecto queries or business rules, you have merged two layers that should be able to change independently — and your tests now need HTTP to exercise domain logic.",
      "One request equals one process is the other structural fact. A slow request cannot block others, a crashing request kills only itself, and Phoenix can hold hundreds of thousands of open connections on one box because each is a 2KB process.",
    ],
    diagram: `flowchart TB
  subgraph domain["lib/shop/ — YOUR DOMAIN · no HTTP words in here, ever"]
    direction TB
    a1["accounts.ex — context: create_user/1, authenticate/2"]:::ok
    a2["accounts/user.ex — an Ecto schema"]:::ok
    a3["orders.ex — context"]:::ok
    a4["repo.ex — the database"]:::ok
    a5["application.ex — the supervision tree"]:::ok
    a1 ~~~ a2 ~~~ a3 ~~~ a4 ~~~ a5
  end
  subgraph web["lib/shop_web/ — THE WEB LAYER · translation only"]
    direction TB
    b1["endpoint.ex — the plug pipeline: logger, parsers, session"]:::hot
    b2["router.ex — pipelines and routes"]:::hot
    b3["controllers/ — params in, one context call, render out"]:::hot
    b4["channels/ — websockets"]:::hot
    b5["plugs/ — auth, rate limit, request id"]:::hot
    b1 ~~~ b2 ~~~ b3 ~~~ b4 ~~~ b5
  end
  b5 --> a1
  a5 --> req
  subgraph req["ONE REQUEST = ONE SUPERVISED PROCESS"]
    direction TB
    r1["socket"]:::muted --> r2["Endpoint<br/>plugs"]:::hot --> r3["Router<br/>pipelines"]:::hot --> r4["Controller<br/>action"]:::hot --> r5["Context<br/>domain"]:::ok
  end
  req --> crash["a crash anywhere in that line kills ONLY this request"]:::warn
  crash --> rule["controller: params → a context function → {:ok, x} ¦ {:error, y} → render<br/>context: everything else. It must not know that HTTP exists."]:::hot`,
    takeaway:
      "Endpoint → Router → Controller → Context → render. Keep HTTP out of the domain.",
  },
  codeSamples: [
    {
      title: "Create a JSON API project",
      note: "Terminal. This is the shape used for the rest of the deck.",
      code: `mix archive.install hex phx_new
mix phx.new shop --no-html --no-assets --no-mailer --binary-id
cd shop

# configure Postgres in config/dev.exs, then:
mix ecto.create
mix phx.server            # or: iex -S mix phx.server
# visit http://localhost:4000/dev/dashboard`,
    },
    {
      title: "The Endpoint, annotated",
      note: "lib/shop_web/endpoint.ex — a plug pipeline, nothing more.",
      code: `defmodule ShopWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :shop

  @session_options [store: :cookie, key: "_shop_key", signing_salt: "changeme"]

  socket "/socket", ShopWeb.UserSocket,
    websocket: true, longpoll: false

  plug Plug.Static, at: "/", from: :shop, gzip: false
  plug Phoenix.LiveDashboard.RequestLogger,
    param_key: "request_logger", cookie_key: "request_logger"

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()

  plug Plug.MethodOverride
  plug Plug.Head
  plug Plug.Session, @session_options
  plug ShopWeb.Router          # ← the router is the LAST plug
end`,
    },
    {
      title: "Feel the layers in iex",
      note: "iex -S mix phx.server, then paste.",
      code: `# every route in the app:
ShopWeb.Router.__routes__() |> Enum.map(&{&1.verb, &1.path, &1.plug})

# the endpoint is a supervised process:
Process.whereis(ShopWeb.Endpoint)
Supervisor.which_children(Shop.Supervisor)

# config it is running with:
ShopWeb.Endpoint.config(:http)
ShopWeb.Endpoint.url()

# how many processes is Phoenix using right now?
:erlang.system_info(:process_count)`,
    },
    {
      title: "Prove one-request-one-process",
      note: "Add this route and hit it twice at once.",
      code: `# in a controller:
def whoami(conn, _params) do
  json(conn, %{
    pid: inspect(self()),
    processes: :erlang.system_info(:process_count)
  })
end

# curl localhost:4000/api/whoami & curl localhost:4000/api/whoami
# → two different PIDs. Each request had its own isolated process.`,
    },
  ],
};
