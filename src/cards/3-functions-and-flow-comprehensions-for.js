export default {
  front:
    "`for` in Elixir is not a loop. What is it, and what do `into:` and the filter position do?",
  back: "`for` is a **comprehension**: it draws elements from one or more generators, keeps only those matching the generator pattern and any filters, transforms each, and collects results — into a list by default, or into anything with `into:`. It is Enum.map + Enum.filter + Enum.into with pattern matching built in, and multiple generators nest as a cartesian product.",
  philosophy: {
    lead: "A comprehension is a declarative description of a set: take these, where this holds, produce that.",
    body: [
      "The under-appreciated feature is that a generator pattern that does not match simply SKIPS the element — no crash, no separate filter step. `for {:ok, value} <- results` is the cleanest way in the language to keep only successes from a list of tagged tuples. You will use that exact line when processing batches of database or HTTP results.",
      "`into:` makes the output shape explicit, which is how you build a map, a binary or even write into a file stream directly. And `reduce:` (Elixir 1.8+) turns a comprehension into a fold when you need an accumulator.",
      "Use `for` when the shape of the transformation is set-like and readable; use pipelines of Enum when it is a sequence of stages. Both compile to efficient code.",
    ],
    diagram: `flowchart TB
  src["for x &lt;- 1..3,          ← generator, you may have several<br/>    y &lt;- [:a, :b],      ← nested ⇒ cartesian product<br/>    x != 2,             ← filter, any boolean expression<br/>    do: {x, y}          ← the element to emit"]:::code
  src --> out["⇒ [{1,:a}, {1,:b}, {3,:a}, {3,:b}]"]:::ok
  out --> pat["A PATTERN IN THE GENERATOR IS AN AUTOMATIC FILTER<br/>for {:ok, v} &lt;- [{:ok,1}, {:error,:x}, {:ok,3}], do: v   ⇒ [1, 3]<br/>the non-matching element is silently skipped — no crash ✓"]:::hot
  pat --> into["into: chooses the container<br/>for {k, v} &lt;- [a: 1, b: 2], into: %{}, do: {k, v * 10}   ⇒ %{a: 10, b: 20}<br/>for c &lt;- ~w(a b c), into: '', do: String.upcase(c)       ⇒ 'ABC'"]:::code
  into --> red["reduce: turns it into a fold<br/>for x &lt;- 1..5, reduce: 0 do acc -&gt; acc + x end          ⇒ 15"]:::code`,
    takeaway:
      "for = generators + patterns-as-filters + into:. Non-matching elements are skipped, not fatal.",
  },
  codeSamples: [
    {
      title: "Basics and cartesian product",
      note: "",
      code: `for x <- 1..5, do: x * x
for x <- 1..3, y <- [:a, :b], do: {x, y}
for x <- 1..10, rem(x, 3) == 0, do: x

# a deck of cards in one line
for rank <- ~w(A K Q J), suit <- ~w(♠ ♥ ♦ ♣), do: rank <> suit`,
    },
    {
      title: "Pattern-as-filter — the one you will really use",
      note: "",
      code: `results = [{:ok, 1}, {:error, :timeout}, {:ok, 3}, {:error, :nope}]

for {:ok, v} <- results, do: v            # [1, 3]
for {:error, r} <- results, do: r         # [:timeout, :nope]

users = [%{name: "Ada", age: 36}, %{name: "Kid", age: 9}]
for %{name: n, age: a} <- users, a >= 18, do: n`,
    },
    {
      title: "into: and reduce:",
      note: "",
      code: `for {k, v} <- [a: 1, b: 2, c: 3], into: %{}, do: {k, v * 10}
for c <- ~w(e l i x i r), into: "", do: String.upcase(c)

for x <- 1..5, reduce: 0 do
  acc -> acc + x
end

# group into a map with reduce:
for w <- ~w(apple avocado banana), reduce: %{} do
  acc ->
    key = String.first(w)
    Map.update(acc, key, [w], &[w | &1])
end`,
    },
    {
      title: "Bitstring generators",
      note: "Parse binary formats declaratively.",
      code: `pixels = <<255, 0, 0,  0, 255, 0,  0, 0, 255>>
for <<r::8, g::8, b::8 <- pixels>>, do: {r, g, b}`,
    },
  ],
};
