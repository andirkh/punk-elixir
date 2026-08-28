export default {
  front:
    "Rewrite `Enum.sum(Enum.filter(Enum.map(list, &(&1*2)), &(&1>4)))` so a human can read it.",
  back: "`list |> Enum.map(&(&1*2)) |> Enum.filter(&(&1>4)) |> Enum.sum()`. The pipe takes the value on its left and injects it as the FIRST argument of the function on its right. This is why every Elixir standard-library function takes its subject first — the whole library is designed to be piped.",
  philosophy: {
    lead: "The pipe turns nested calls inside-out, so code reads in the order it executes: data first, then each transformation.",
    body: [
      "This is more than sugar. It shapes API design across the entire ecosystem. `Enum.map(list, fun)`, `Map.put(map, k, v)`, `Plug.Conn.put_status(conn, 404)`, `Ecto.Changeset.cast(changeset, attrs, fields)` — the subject is always first, precisely so it can flow. When you write your own modules, follow the same rule or your functions will feel foreign.",
      "A pipeline is also a picture of a data transformation, which is what a backend request really is. In card 48 you will see a Phoenix request as `conn |> parse |> authenticate |> authorize |> handle |> render` — the same shape, at the level of a whole web framework.",
      "Two habits keep pipelines honest: start from a plain value, not a function call, and keep every step returning the same kind of thing. When a step could fail, you want `with` (card 22) instead.",
    ],
    diagram: `flowchart TB
  nested["NESTED — read inside-out, right to left<br/>Enum.sum(Enum.filter(Enum.map(list, f), g))"]:::bad
  nested --> piped["PIPED — read top to bottom, in execution order<br/>list<br/>¦&gt; Enum.map(f)<br/>¦&gt; Enum.filter(g)<br/>¦&gt; Enum.sum()"]:::ok
  piped --> flow
  subgraph flow["x ¦&gt; f(a, b) ≡ f(x, a, b) — x always goes FIRST"]
    direction LR
    n1["list"]:::hot --> n2["map"]:::hot --> n3["filter"]:::hot --> n4["sum"]:::hot --> n5["18"]:::ok
  end
  flow --> rule["this is why every Elixir API puts the SUBJECT first"]:::warn`,
    takeaway:
      "x |> f(a) is f(x, a). Design your own functions subject-first so they pipe.",
  },
  codeSamples: [
    {
      title: "Flatten a nest",
      note: "",
      code: `list = [1, 2, 3, 4, 5]

Enum.sum(Enum.filter(Enum.map(list, &(&1 * 2)), &(&1 > 4)))

list
|> Enum.map(&(&1 * 2))
|> Enum.filter(&(&1 > 4))
|> Enum.sum()`,
    },
    {
      title: "A realistic text pipeline",
      note: "Word frequency in 6 readable steps.",
      code: `"""
the quick brown fox jumps over the lazy dog
the dog barks and the fox runs
"""
|> String.downcase()
|> String.split(~r/[^a-z]+/, trim: true)
|> Enum.frequencies()
|> Enum.sort_by(fn {_word, count} -> -count end)
|> Enum.take(5)`,
    },
    {
      title: "Piping into your own subject-first API",
      note: "",
      code: `defmodule Cart do
  def new(), do: %{items: [], total: 0}
  def add(cart, name, price) do
    %{cart | items: [name | cart.items], total: cart.total + price}
  end
  def discount(cart, pct), do: %{cart | total: round(cart.total * (1 - pct/100))}
end

Cart.new()
|> Cart.add("book", 1200)
|> Cart.add("pen", 300)
|> Cart.discount(10)`,
    },
    {
      title: "Pipe pitfalls",
      note: "Two rules that save real debugging time.",
      code: `# 1. start from a value, not a call
# BAD:  String.split("a b") |> Enum.count()
# GOOD:
"a b" |> String.split() |> Enum.count()

# 2. anonymous functions need then/2 (or the capture form)
[1,2,3]
|> Enum.sum()
|> then(fn total -> "total is #{total}" end)

# tap/2 lets you peek without breaking the chain
[1,2,3]
|> tap(&IO.inspect(&1, label: "before"))
|> Enum.map(&(&1 * 10))
|> IO.inspect(label: "after")`,
    },
  ],
};
