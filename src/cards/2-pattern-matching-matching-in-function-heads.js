export default {
  front:
    "How do you write a function that behaves differently for `{:ok, v}` and `{:error, r}` without a single `if`?",
  back: "Write it twice. Elixir lets you define **multiple clauses** of the same function, each with its own pattern in the head. The runtime tries them top to bottom and runs the first that matches. This turns branching into declaration: the shape of the input selects the code, so conditionals largely disappear from idiomatic Elixir.",
  philosophy: {
    lead: "This is the payoff card for module 2 — pattern matching moves from an operator you use to the way you structure code.",
    body: [
      "Every branch you would write as an if/else in another language becomes a clause here. The benefit is not brevity, it is exhaustiveness and locality: each case sits at the top level of its own function body, at the same indentation, with its own name in the stack trace. Deeply nested conditionals are structurally hard to write in Elixir, which is a large part of why Elixir codebases stay flat and readable.",
      "It also gives you honest failure. If no clause matches, you get FunctionClauseError naming the function and the arguments — a far better error than a nil that surfaces three modules later. Add a catch-all clause only when you genuinely want to handle the unknown case.",
      "Order matters: clauses are tried in source order, so specific patterns must come before general ones. The compiler warns you when a clause can never match.",
    ],
    diagram: `flowchart TB
  input["input: {:error, :timeout}"]:::hot
  input --> c1["clause 1 — handle({:ok, value})"]:::muted
  c1 -->|no match| c2["clause 2 — handle({:error, reason})"]:::ok
  c2 -->|MATCH · reason = :timeout| body["run this body<br/>later clauses are never tried"]:::ok
  c2 -.->|if it had not matched| c3["clause 3 — handle(other) · the catch-all"]:::muted
  c3 -.->|no clause matches at all| boom["** FunctionClauseError<br/>no function clause matching in Mod.handle/1"]:::bad
  body --> rule["ORDER MATTERS — specific clauses ABOVE general ones"]:::warn`,
    takeaway:
      "Multiple clauses replace if/else. The input's shape chooses the code path.",
  },
  codeSamples: [
    {
      title: "Branching by shape",
      note: "Paste the whole module into iex — it compiles in memory.",
      code: `defmodule Result do
  def describe({:ok, value}),        do: "success: #{inspect(value)}"
  def describe({:error, :timeout}),  do: "the server was too slow"
  def describe({:error, reason}),    do: "failed: #{inspect(reason)}"
  def describe(other),               do: "unknown: #{inspect(other)}"
end

Result.describe({:ok, 42})
Result.describe({:error, :timeout})
Result.describe({:error, :nope})
Result.describe(:banana)`,
    },
    {
      title: "Recursion falls out naturally",
      note: "The empty-list clause is the base case.",
      code: `defmodule MyList do
  def sum([]),             do: 0
  def sum([head | tail]),  do: head + sum(tail)

  def map([], _f),            do: []
  def map([h | t], f),        do: [f.(h) | map(t, f)]
end

MyList.sum([1,2,3,4])
MyList.map([1,2,3], fn x -> x * x end)`,
    },
    {
      title: "Matching maps in the head",
      note: "This is exactly how Phoenix controllers read params.",
      code: `defmodule Router do
  def route(%{"action" => "show", "id" => id}), do: "showing #{id}"
  def route(%{"action" => "index"}),            do: "listing all"
  def route(%{"action" => a}),                  do: "no such action: #{a}"
end

Router.route(%{"action" => "show", "id" => "7"})
Router.route(%{"action" => "index", "page" => "2"})`,
    },
  ],
};
