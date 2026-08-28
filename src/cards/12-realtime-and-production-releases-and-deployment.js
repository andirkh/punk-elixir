export default {
  front:
    "How do you ship an Elixir app to a server with no Erlang, no Elixir and no Mix installed?",
  back: '`MIX_ENV=prod mix release` builds a self-contained tarball: your compiled code, its dependencies, and a trimmed Erlang runtime, with `bin/shop start|stop|remote|eval`. No language runtime on the target, no Mix at runtime. Migrations run via a release task (`bin/shop eval "Shop.Release.migrate"`), and `config/runtime.exs` (card 28) supplies the environment on boot.',
  philosophy: {
    lead: "A release is the whole system — application code, dependencies, VM — packaged as one artefact, which is why Elixir deploys are unusually boring.",
    body: [
      "Two facts make production operation different from most stacks. First, the release includes `bin/shop remote`, which attaches an IEx shell to the RUNNING production node. You can inspect a GenServer's state, check a queue depth, or run a one-off query against live state. Used carefully this is extraordinary; treat it as a privileged operation and log its use.",
      "Second, graceful shutdown actually works. `SIGTERM` triggers an orderly supervision-tree shutdown in reverse order (card 46), so the Endpoint stops accepting connections first and in-flight work drains. Set `shutdown` values on children that need to finish, and give your orchestrator a `terminationGracePeriodSeconds` longer than your longest request.",
      "For Docker, use a multi-stage build: compile in an Elixir image, copy the release into a slim runtime image. Set `PHX_HOST`, `SECRET_KEY_BASE`, `DATABASE_URL` and `PORT` as environment variables; runtime.exs reads them at boot. And add a health endpoint that actually checks the database, so your load balancer knows the difference between 'the process is up' and 'the service works'.",
    ],
    diagram: `flowchart TB
  subgraph build["BUILD"]
    direction TB
    b1["MIX_ENV=prod mix deps.get --only prod"]:::code
    b2["MIX_ENV=prod mix compile"]:::code
    b3["MIX_ENV=prod mix release"]:::code
    b1 --> b2 --> b3
  end
  b3 -->|a self-contained tarball| r1
  subgraph run["RUN — _build/prod/rel/shop/"]
    direction TB
    r1["bin/shop      start ¦ stop ¦ remote ¦ eval ¦ rpc"]:::code
    r2["lib/          your beams and your deps"]:::code
    r3["erts-…/       the VM itself"]:::code
    r4["releases/…/   runtime.exs"]:::code
    r1 ~~~ r2 ~~~ r3 ~~~ r4
  end
  r4 --> nodep["no Elixir and no Erlang needed on the target machine ✓"]:::ok
  nodep --> cmds["bin/shop start     run it<br/>bin/shop remote    ★ attach an IEx shell to the LIVE node<br/>bin/shop eval 'Shop.Release.migrate'   run migrations, without Mix<br/>bin/shop rpc 'IO.inspect(:erlang.memory())'"]:::hot
  cmds --> term["SIGTERM ⇒ graceful shutdown, the supervision tree in REVERSE order<br/>Endpoint stops accepting → in-flight requests drain → Repo closes<br/>set child shutdown: values, and make the grace period longer than<br/>your longest request"]:::warn
  term --> docker["DOCKER, multi-stage<br/>FROM elixir:1.16-alpine AS build   … mix release<br/>FROM alpine:3.19                   … COPY --from=build the release only<br/>⇒ a small image, no build tools, no source<br/><br/>A HEALTH CHECK THAT MEANS SOMETHING<br/>GET /health → SELECT 1 against the pool → 200 or 503"]:::code`,
    takeaway:
      "mix release ships code + VM as one artefact, with a live remote shell and real graceful shutdown.",
  },
  codeSamples: [
    {
      title: "Release config and the migration task",
      note: "mix.exs + lib/shop/release.ex",
      code: `# mix.exs
def project do
  [
    app: :shop,
    version: "0.1.0",
    releases: [
      shop: [
        include_executables_for: [:unix],
        applications: [runtime_tools: :permanent],
        steps: [:assemble, :tar]
      ]
    ]
  ]
end

# lib/shop/release.ex — migrations without Mix
defmodule Shop.Release do
  @app :shop

  def migrate do
    load_app()
    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  def rollback(repo, version) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :down, to: version))
  end

  def seed do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(Shop.Repo, fn _repo ->
      Code.eval_file(Application.app_dir(@app, "priv/repo/seeds.exs"))
    end)
  end

  defp repos, do: Application.fetch_env!(@app, :ecto_repos)
  defp load_app, do: Application.ensure_loaded(@app)
end

# terminal:
# MIX_ENV=prod mix release
# _build/prod/rel/shop/bin/shop eval "Shop.Release.migrate"
# _build/prod/rel/shop/bin/shop start`,
    },
    {
      title: "Dockerfile",
      note: "Multi-stage; the final image has no build tools.",
      code: `FROM hexpm/elixir:1.16.2-erlang-26.2.2-alpine-3.19.1 AS build

RUN apk add --no-cache build-base git
WORKDIR /app
ENV MIX_ENV=prod

RUN mix local.hex --force && mix local.rebar --force

COPY mix.exs mix.lock ./
RUN mix deps.get --only prod && mix deps.compile

COPY config config
COPY priv priv
COPY lib lib
RUN mix compile
RUN mix release

# ---------- runtime ----------
FROM alpine:3.19.1 AS app

RUN apk add --no-cache libstdc++ openssl ncurses-libs ca-certificates
WORKDIR /app
RUN adduser -D app && chown app:app /app
USER app

COPY --from=build --chown=app:app /app/_build/prod/rel/shop ./

ENV HOME=/app PHX_SERVER=true
EXPOSE 4000

CMD ["bin/shop", "start"]`,
    },
    {
      title: "A health endpoint that tells the truth",
      note: "Distinguish 'process alive' from 'service works'.",
      code: `defmodule ShopWeb.HealthController do
  use ShopWeb, :controller

  # liveness: am I running at all? (never touches dependencies)
  def live(conn, _), do: send_resp(conn, 200, "ok")

  # readiness: can I actually serve traffic?
  def ready(conn, _) do
    checks = %{
      database: check_db(),
      migrations: check_migrations()
    }

    status = if Enum.all?(Map.values(checks), &(&1 == :ok)), do: 200, else: 503

    conn
    |> put_status(status)
    |> json(%{status: if(status == 200, do: "ok", else: "degraded"), checks: checks})
  end

  defp check_db do
    case Ecto.Adapters.SQL.query(Shop.Repo, "SELECT 1", [], timeout: 2_000) do
      {:ok, _} -> :ok
      {:error, _} -> :error
    end
  rescue
    _ -> :error
  end

  defp check_migrations do
    case Ecto.Migrator.migrations(Shop.Repo) do
      list -> if Enum.any?(list, fn {status, _, _} -> status == :down end), do: :pending, else: :ok
    end
  rescue
    _ -> :error
  end
end

# router:  get "/health/live", HealthController, :live
#          get "/health/ready", HealthController, :ready`,
    },
    {
      title: "Operating a live node",
      note: "The remote shell is the superpower. Use it carefully.",
      code: `# attach IEx to the RUNNING production node:
bin/shop remote

# then, live, in production:
:sys.get_state(Shop.Cache)
Oban.check_queue(queue: :mailers)
Shop.Repo.aggregate(Shop.Orders.Order, :count)
:erlang.memory(:total) |> div(1024*1024)
Application.get_env(:shop, :feature_flags)

# toggle a feature flag without a deploy:
Application.put_env(:shop, :feature_flags, new_checkout: true)

# one-off command without an interactive shell:
bin/shop rpc "Shop.Release.migrate()"
bin/shop eval "IO.inspect(Shop.Repo.query!(\\"SELECT count(*) FROM orders\\").rows)"

# graceful stop (same as SIGTERM):
bin/shop stop`,
    },
  ],
};
