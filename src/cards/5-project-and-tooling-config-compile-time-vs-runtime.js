export default {
  front:
    "Your DATABASE_URL is set on the production server. Why does reading it in `config/prod.exs` silently break, and where does it belong?",
  back: "`config/*.exs` files are evaluated at **compile time** — on your build machine or in Docker build, where the production env var does not exist. `config/runtime.exs` is evaluated when the release **starts**, on the actual server. Every secret and environment-dependent value goes in `runtime.exs`; only structural, build-time settings go in the others.",
  philosophy: {
    lead: "Elixir compiles configuration into the release, so knowing WHEN a config file runs is the difference between a working deploy and a mystery.",
    body: [
      "This trips up nearly every newcomer, and it is worth internalising once. `config.exs` and its per-environment siblings run during `mix compile`. They are great for things that are true about your code — which Ecto adapter, which JSON library, log level defaults. `runtime.exs` runs in the released binary at boot, so `System.get_env/1` actually sees the server's environment.",
      "The values land in the **application environment**, a per-application key-value store you read with `Application.get_env/3` (or better, `Application.compile_env/3` when the value must be fixed at compile time — it makes the compiler warn you if the two disagree).",
      "The related habit: never read config at the top level of a module body, because that captures the compile-time value forever. Read it inside a function, or fetch it once in your Application start callback and pass it into the process that needs it.",
    ],
    diagram: `flowchart TB
  subgraph timeline["THE TIMELINE OF A RELEASE"]
    direction LR
    build["ON THE BUILD MACHINE — mix compile<br/>config/config.exs ✔ runs<br/>config/prod.exs ✔ runs<br/>System.get_env('DB') ✘ nil"]:::warn
    server["ON THE SERVER — ./bin/shop start<br/>config/runtime.exs ✔ runs HERE<br/>System.get_env('DB') ✔ works"]:::ok
    build --> server
  end
  timeline --> which["config/config.exs — shared, COMPILE time — adapters, log level<br/>config/dev ¦ test ¦ prod.exs — per env, COMPILE time<br/>config/runtime.exs — EVERY secret, URL, port, pool size ★"]:::code
  which --> read["READING IT<br/>Application.get_env(:shop, :feature_flag, false)   at runtime ✓<br/>Application.compile_env(:shop, :adapter)           frozen, warns on drift<br/>Application.fetch_env!(:shop, Shop.Repo)           raises if missing"]:::code
  read --> never["✗ NEVER — @port Application.get_env(:shop, :port)<br/>a module attribute freezes the value at COMPILE time"]:::bad`,
    takeaway:
      "Secrets and env vars live in runtime.exs. Everything else compiles in.",
  },
  codeSamples: [
    {
      title: "config/runtime.exs — the real one",
      note: "This is production-shaped; copy it into a project.",
      code: `import Config

if config_env() == :prod do
  database_url =
    System.get_env("DATABASE_URL") ||
      raise "environment variable DATABASE_URL is missing"

  config :shop, Shop.Repo,
    url: database_url,
    pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
    ssl: true,
    socket_options: [:inet6]

  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise "environment variable SECRET_KEY_BASE is missing"

  config :shop, ShopWeb.Endpoint,
    url: [host: System.get_env("PHX_HOST") || "example.com", port: 443],
    http: [ip: {0, 0, 0, 0, 0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT") || "4000")],
    secret_key_base: secret_key_base,
    server: true
end`,
    },
    {
      title: "config/config.exs — compile time",
      note: "",
      code: `import Config

config :shop, ecto_repos: [Shop.Repo]
config :shop, Shop.Repo, adapter: Ecto.Adapters.Postgres
config :logger, :console, format: "$time $metadata[$level] $message\\n"
config :shop, :feature_flags, new_checkout: false

# per-environment files are imported LAST so they win:
import_config "#{config_env()}.exs"`,
    },
    {
      title: "Reading config correctly",
      note: "Try these in iex -S mix.",
      code: `Application.get_env(:shop, :feature_flags)
Application.get_env(:shop, :feature_flags, [])[:new_checkout]
Application.fetch_env!(:logger, :console)
Application.put_env(:shop, :feature_flags, new_checkout: true)   # runtime toggle
Application.get_all_env(:shop)`,
    },
    {
      title: "The freeze bug, demonstrated",
      note: "Why config belongs inside functions.",
      code: `defmodule Bad do
  @flag Application.compile_env(:shop, [:feature_flags, :new_checkout])
  def on?, do: @flag        # frozen at compile time, forever
end

defmodule Good do
  def on? do
    Application.get_env(:shop, :feature_flags, [])
    |> Keyword.get(:new_checkout, false)
  end
end

Application.put_env(:shop, :feature_flags, new_checkout: true)
Bad.on?     # still the old value
Good.on?    # true ✓`,
    },
  ],
};
