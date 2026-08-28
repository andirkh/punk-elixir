export default {
  front:
    "You are done with iex snippets. What command creates a real application, and what does the `--sup` flag add that matters enormously?",
  back: "`mix new my_app --sup`. Mix is build tool, task runner, dependency manager and test runner in one. The `--sup` flag generates an **Application** module with a supervision tree — the root of everything long-running in your service. Without it you have a library; with it you have a service that can hold processes, connection pools and a web server.",
  philosophy: {
    lead: "Everything from here on lives in a Mix project, because a real backend needs dependencies, config, tests and a supervision tree.",
    body: [
      "`mix.exs` is a normal Elixir module, not a config file format. `deps/0` returns a list, `application/0` declares which module starts your tree, and you can compute any of it in code. Dependencies are fetched into `deps/`, compiled into `_build/`, and locked in `mix.lock` — commit that file.",
      "The task system is extensible: `mix ecto.migrate`, `mix phx.server`, `mix test` are all just modules named `Mix.Tasks.Something`. You can write your own in `lib/mix/tasks/` and it appears in `mix help` immediately. Aliases in `mix.exs` chain tasks together, which is how projects define a single `mix setup`.",
      "Three commands you will type daily: `mix deps.get`, `iex -S mix` (start the shell WITH your app running — this is where you will test everything from now on), and `mix test`.",
    ],
    diagram: `flowchart TB
  gen["mix new my_app --sup"]:::hot
  gen --> t1
  subgraph tree["my_app/"]
    direction TB
    t1["mix.exs — project definition: deps, app, aliases"]:::code
    t2["mix.lock — exact dependency versions · COMMIT THIS"]:::warn
    t3["config/config.exs — compile-time, all envs<br/>config/dev.exs · prod.exs · test.exs<br/>config/runtime.exs — RUNTIME, reads env vars — card 28"]:::code
    t4["lib/my_app.ex<br/>lib/my_app/application.ex — the supervision tree root, from --sup"]:::code
    t5["test/"]:::muted
    t6["_build/ and deps/ — generated, gitignored"]:::muted
    t1 ~~~ t2 ~~~ t3 ~~~ t4 ~~~ t5 ~~~ t6
  end
  t6 --> cmds["DAILY COMMANDS<br/>mix deps.get — fetch dependencies<br/>iex -S mix — a shell WITH your app and deps loaded ★<br/>mix test · mix format<br/>mix compile --warnings-as-errors<br/>mix help — every task available to you"]:::ok`,
    takeaway:
      "mix new --sup gives you a supervised application. iex -S mix is your new home.",
  },
  codeSamples: [
    {
      title: "Create the project you will use for the rest of the deck",
      note: "Run these in your terminal, not in iex.",
      code: `mix new shop --sup
cd shop
mix deps.get
mix test
iex -S mix

# inside that iex session:
# Shop.hello()
# recompile()`,
    },
    {
      title: "mix.exs is just Elixir",
      note: "Open lib/../mix.exs and compare.",
      code: `defmodule Shop.MixProject do
  use Mix.Project

  def project do
    [app: :shop, version: "0.1.0", elixir: "~> 1.16",
     elixirc_paths: elixirc_paths(Mix.env()),
     start_permanent: Mix.env() == :prod,
     aliases: aliases(), deps: deps()]
  end

  # this is what --sup added: your supervision tree root
  def application do
    [extra_applications: [:logger], mod: {Shop.Application, []}]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  defp deps do
    [
      {:jason, "~> 1.4"},
      {:ecto_sql, "~> 3.11"},
      {:postgrex, ">= 0.0.0"},
      {:plug_cowboy, "~> 2.6"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false}
    ]
  end

  defp aliases do
    [setup: ["deps.get", "ecto.setup"],
     "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
     test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]]
  end
end`,
    },
    {
      title: "Write your own mix task",
      note: "Save as lib/mix/tasks/shop.stats.ex, then run mix shop.stats",
      code: `defmodule Mix.Tasks.Shop.Stats do
  use Mix.Task

  @shortdoc "Prints some project statistics"
  @impl Mix.Task
  def run(_args) do
    Mix.Task.run("app.start")      # boot the supervision tree first
    files = Path.wildcard("lib/**/*.ex")
    IO.puts("modules: #{length(files)}")
  end
end`,
    },
    {
      title: "Version requirements",
      note: "How to read the operators in deps.",
      code: `Version.match?("1.4.2", "~> 1.4")     # true  — >= 1.4.0 and < 2.0.0
Version.match?("1.4.2", "~> 1.4.1")   # true  — >= 1.4.1 and < 1.5.0
Version.match?("2.0.0", "~> 1.4")     # false
Version.compare("1.2.0", "1.10.0")    # :lt`,
    },
  ],
};
