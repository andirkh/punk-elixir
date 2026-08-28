export default {
  front:
    "Elixir is dynamically typed. What gives you type checking, dead-code detection and style enforcement anyway?",
  back: "`@spec` typespecs plus **Dialyzer** (success typing — it only reports what it can PROVE wrong), **Credo** for style and consistency, `mix format` for formatting (settled by the language, not by debate), and `@doc`/`@moduledoc` for documentation that ships inside the bytecode and powers `h`, ExDoc and doctests.",
  philosophy: {
    lead: "Types are optional annotations here, and the tooling is built to be useful without ever demanding full coverage.",
    body: [
      "Dialyzer works by success typing: it infers what CAN succeed and complains only when a contract is definitely impossible — an unreachable clause, a function that can never return what its spec claims, a call that will always fail. It never forces you to annotate everything, and it never reports a false positive by design. The trade-off is that it is slower to catch things than a real type checker. Elixir is actively gaining a proper set-theoretic type system, which will land gradually in future releases.",
      "Specs pay for themselves as documentation of intent at module boundaries, especially in a service where a context module is the public API of a domain. Put specs on public functions, skip them on obvious private ones.",
      "`mix format` deserves its own note: Elixir has an official formatter, so formatting is not a team discussion. Add `.formatter.exs`, run it in CI with `--check-formatted`, and never think about it again.",
    ],
    diagram: `flowchart TB
  docs["@moduledoc and @doc are stored IN the .beam file"]:::hot
  docs --> powers["they power h Mod.fun · the ExDoc website · doctests"]:::ok
  powers --> specs["@spec total([integer()]) :: integer()<br/>@type cents :: non_neg_integer()<br/>@opaque token :: binary()"]:::code
  specs --> g1
  subgraph tools["THE TOOLCHAIN"]
    direction TB
    g1["dialyzer — proves impossible code paths, wrong specs, unreachable clauses · never false positives"]:::ok
    g2["credo — style, complexity, consistency, code smells"]:::ok
    g3["format — the official formatter · no style debates"]:::ok
    g4["sobelow — a security scanner for Phoenix apps"]:::ok
    g5["ex_doc — generates the docs website from @doc"]:::ok
    g1 ~~~ g2 ~~~ g3 ~~~ g4 ~~~ g5
  end
  g5 --> ci["A CI PIPELINE WORTH COPYING<br/>mix format --check-formatted<br/>mix compile --warnings-as-errors<br/>mix credo --strict<br/>mix dialyzer<br/>mix test --cover"]:::code`,
    takeaway:
      "Specs + Dialyzer prove what is impossible; format and credo remove the arguments.",
  },
  codeSamples: [
    {
      title: "A well-annotated module",
      note: "",
      code: `defmodule Shop.Pricing do
  @moduledoc """
  Pricing rules. All money is integer cents; never use floats for money.
  """

  @type cents :: non_neg_integer()
  @type line  :: %{sku: String.t(), qty: pos_integer(), price: cents()}

  @doc """
  Total for a list of lines.

      iex> Shop.Pricing.subtotal([%{sku: "a", qty: 2, price: 500}])
      1000
  """
  @spec subtotal([line()]) :: cents()
  def subtotal(lines) do
    Enum.reduce(lines, 0, fn %{qty: q, price: p}, acc -> acc + q * p end)
  end

  @spec apply_tax(cents(), float()) :: cents()
  def apply_tax(amount, rate) when rate >= 0.0, do: round(amount * (1 + rate))
end

Shop.Pricing.subtotal([%{sku: "a", qty: 2, price: 500}])`,
    },
    {
      title: "Setting up the toolchain",
      note: "Add to deps in mix.exs, then run these.",
      code: `# deps:
#   {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
#   {:dialyxir, "~> 1.4", only: [:dev], runtime: false},
#   {:ex_doc, "~> 0.31", only: :dev, runtime: false}

# terminal:
mix format
mix format --check-formatted
mix credo --strict
mix dialyzer          # first run builds a PLT, takes a few minutes
mix docs              # generates doc/index.html`,
    },
    {
      title: "Introspect specs at runtime",
      note: "Docs and specs live in the compiled module.",
      code: `Code.fetch_docs(Enum)
{:ok, specs} = Code.Typespec.fetch_specs(Enum)
h Enum.reduce/3
i Enum

# what does this module export?
Shop.Pricing.__info__(:functions)`,
    },
    {
      title: "A .formatter.exs worth copying",
      note: "",
      code: `# .formatter.exs
[
  inputs: ["{mix,.formatter}.exs", "{config,lib,test}/**/*.{ex,exs}"],
  line_length: 98,
  import_deps: [:ecto, :ecto_sql, :phoenix],
  subdirectories: ["priv/*/migrations"]
]`,
    },
  ],
};
