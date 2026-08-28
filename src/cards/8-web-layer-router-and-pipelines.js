export default {
  front:
    "Public endpoints need no auth; `/api/admin` needs auth plus an admin check. How do you express that without repeating plugs on every route?",
  back: '**Pipelines**. `pipeline :api do plug :accepts, ["json"] end`, `pipeline :authed do plug ShopWeb.Auth end`, then `scope "/api" do pipe_through [:api, :authed] ... end`. A scope groups routes under a path prefix and a set of pipelines; `resources/2` generates the seven RESTful routes at once. Everything compiles down to pattern-matched function clauses — routing is O(1)-ish, not a list scan.',
  philosophy: {
    lead: "The router is where the plug pipeline meets pattern matching: it is a big multi-clause function generated at compile time.",
    body: [
      "Because routes compile into function heads (card 12), matching a path is as fast as any other pattern match, and a typo produces a compile-time-visible route list rather than a runtime surprise. `mix phx.routes` prints the whole table, which is the fastest way to understand an unfamiliar Phoenix app.",
      "Pipelines exist so that cross-cutting concerns are declared once, next to the routes they protect. This is a security property, not just tidiness: an auth plug attached to a pipeline covers every route in the scope, including ones added later by someone who forgets. Attaching auth per-controller is how endpoints end up accidentally public.",
      'Scopes also carry an alias, so `scope "/api", ShopWeb do` lets you write `get "/orders", OrderController, :index` without repeating the namespace. Nest scopes for versioning: `/api/v1` and `/api/v2` with different controller modules and shared pipelines.',
    ],
    diagram: `flowchart TB
  subgraph pipes["pipelines — reusable stacks of plugs"]
    direction TB
    q1[":api — plug :accepts, ['json'] · plug ShopWeb.Plugs.RequestId"]:::hot
    q2[":authed — plug ShopWeb.Plugs.Auth · halts 401 for the whole scope"]:::hot
    q3[":admin — plug ShopWeb.Plugs.RequireRole, :admin"]:::hot
    q1 ~~~ q2 ~~~ q3
  end
  q3 --> s1
  subgraph scopes["scopes nest, and so does authorisation"]
    direction TB
    s1["scope '/api' · pipe_through :api — PUBLIC<br/>post '/login' · get '/health'"]:::ok
    s2["scope '/' · pipe_through :authed — everything below needs a user<br/>resources '/orders' · get '/me'"]:::ok
    s3["scope '/admin' · pipe_through :admin — plus a role check<br/>resources '/users'"]:::ok
    s1 --> s2 --> s3
  end
  s3 --> res["resources '/orders', OrderController generates<br/>GET /api/orders → :index          GET /api/orders/:id → :show<br/>POST /api/orders → :create        PATCH ¦ PUT /:id → :update<br/>DELETE /api/orders/:id → :delete"]:::code
  res --> tools["mix phx.routes — print the whole table<br/>~p'/api/orders/#{id}' — verified routes: a typo is a COMPILE error"]:::warn`,
    takeaway:
      "Pipelines attach cross-cutting plugs to a whole scope. Routes compile to pattern matches.",
  },
  codeSamples: [
    {
      title: "A complete API router",
      note: "lib/shop_web/router.ex",
      code: `defmodule ShopWeb.Router do
  use ShopWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
    plug ShopWeb.Plugs.RequestId
  end

  pipeline :authed do
    plug ShopWeb.Plugs.Auth
  end

  pipeline :admin do
    plug ShopWeb.Plugs.RequireRole, role: :admin
  end

  scope "/api", ShopWeb do
    pipe_through :api

    get  "/health", HealthController, :show
    post "/login",  SessionController, :create

    scope "/" do
      pipe_through :authed

      get "/me", UserController, :me
      resources "/orders", OrderController, except: [:new, :edit] do
        resources "/items", OrderItemController, only: [:index, :create]
      end

      scope "/admin", Admin, as: :admin do
        pipe_through :admin
        resources "/users", UserController
      end
    end
  end

  if Application.compile_env(:shop, :dev_routes) do
    import Phoenix.LiveDashboard.Router
    scope "/dev" do
      pipe_through [:fetch_session, :protect_from_forgery]
      live_dashboard "/dashboard", metrics: ShopWeb.Telemetry
    end
  end
end`,
    },
    {
      title: "The auth plug the pipeline uses",
      note: "lib/shop_web/plugs/auth.ex",
      code: `defmodule ShopWeb.Plugs.Auth do
  @behaviour Plug
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user} <- Shop.Accounts.user_from_token(token) do
      assign(conn, :current_user, user)
    else
      _ ->
        conn
        |> put_status(:unauthorized)
        |> json(%{error: "unauthorized"})
        |> halt()
    end
  end
end

defmodule ShopWeb.Plugs.RequireRole do
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  def init(opts), do: Keyword.fetch!(opts, :role)

  def call(%{assigns: %{current_user: %{role: role}}} = conn, role), do: conn
  def call(conn, _role) do
    conn |> put_status(:forbidden) |> json(%{error: "forbidden"}) |> halt()
  end
end`,
    },
    {
      title: "Inspect and test routes",
      note: "",
      code: `# terminal
mix phx.routes
mix phx.routes | grep orders

# iex -S mix
ShopWeb.Router.__routes__()
|> Enum.map(fn r -> "#{r.verb |> to_string() |> String.upcase()} #{r.path} -> #{inspect(r.plug)}##{r.plug_opts}" end)
|> Enum.each(&IO.puts/1)`,
    },
    {
      title: "Forwarding and catch-alls",
      note: "Mount other plugs, and shape 404s.",
      code: `# inside the router:
# forward "/metrics", ShopWeb.MetricsPlug
# forward "/webhooks/stripe", ShopWeb.StripeWebhookPlug

scope "/api", ShopWeb do
  pipe_through :api
  match :*, "/*path", FallbackController, :not_found
end

# lib/shop_web/controllers/fallback_controller.ex
defmodule ShopWeb.FallbackController do
  use ShopWeb, :controller

  def not_found(conn, _), do: conn |> put_status(404) |> json(%{error: "not found"})

  # this is also where you translate context errors into HTTP:
  def call(conn, {:error, :not_found}),
    do: conn |> put_status(404) |> json(%{error: "not found"})
  def call(conn, {:error, %Ecto.Changeset{} = cs}),
    do: conn |> put_status(422) |> json(%{errors: ShopWeb.ChangesetJSON.errors(cs)})
end`,
    },
  ],
};
