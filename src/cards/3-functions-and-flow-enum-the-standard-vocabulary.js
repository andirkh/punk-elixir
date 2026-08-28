export default {
  front:
    "You need to group 10k orders by status, sum each group's total, and keep only groups over $1000. Which module, and roughly which functions?",
  back: "`Enum` — the eager, universal collection API: `group_by/2`, then `Map.new/2` with `Enum.sum`, then `Enum.filter/2`. Enum works on anything implementing the `Enumerable` protocol: lists, maps, ranges, streams, and even Ecto results. Learning ~20 of its functions covers most day-to-day Elixir.",
  philosophy: {
    lead: "Elixir has no for-loops. Enum is the loop, expressed as a vocabulary of intentions.",
    body: [
      "Each Enum function names WHAT you want rather than HOW to iterate: map means transform each, filter means keep some, reduce means fold into an accumulator, group_by means partition by a key. Because the intention is in the name, a pipeline of Enum calls is close to a plain-English description of the transformation — which is a real advantage when you return to code six months later.",
      "`reduce/3` is the primitive underneath all the others; everything else could be written with it. Learn it properly, because in card 20 you will see that reduce is itself just recursion with an accumulator, and in card 39 you will see that a GenServer is a reduce over incoming messages that never ends. It is the same idea at three scales.",
      "Enum is EAGER: every step builds a full intermediate collection. That is exactly right for a few thousand items and exactly wrong for a million-row file — which is what the next card is for.",
    ],
    diagram: `flowchart TB
  subgraph vocab["THE 20 THAT COVER 90% OF REAL CODE"]
    direction TB
    v1["TRANSFORM — map/2 · flat_map/2 · with_index/2 · zip/2"]:::hot
    v2["SELECT — filter/2 · reject/2 · take/2 · drop/2 · take_while/2 · uniq/2"]:::hot
    v3["COLLAPSE — reduce/3 · sum/1 · count/1 · min_max/1 · join/2 · frequencies/1"]:::hot
    v4["REORGANISE — sort/1 · sort_by/2 · group_by/2 · chunk_every/2 · split/2"]:::hot
    v5["ASK — any?/2 · all?/2 · find/2 · member?/2 · empty?/1"]:::hot
    v6["CONVERT — into/2 · Map.new/2 · Enum.to_list/1"]:::hot
    v1 ~~~ v2
    v2 ~~~ v3
    v3 ~~~ v4
    v4 ~~~ v5
    v5 ~~~ v6
  end
  v6 --> eng["reduce IS the engine"]:::warn
  subgraph red["[1,2,3] ¦&gt; Enum.reduce(0, fn item, acc -&gt; acc + item end)"]
    direction LR
    a0["acc = 0"]:::muted -->|item 1| a1["acc = 1"]:::muted -->|item 2| a2["acc = 3"]:::muted -->|item 3| a3["acc = 6"]:::ok
  end
  eng --> red
  red --> all["map, filter, sum, group_by … all expressible as reduce"]:::ok`,
    takeaway:
      "Name the intention, not the loop. reduce is the primitive under all of it.",
  },
  codeSamples: [
    {
      title: "The order report from the question",
      note: "",
      code: `orders = [
  %{id: 1, status: :paid,    total: 500},
  %{id: 2, status: :paid,    total: 900},
  %{id: 3, status: :pending, total: 300},
  %{id: 4, status: :refunded,total: 150},
  %{id: 5, status: :pending, total: 1200}
]

orders
|> Enum.group_by(& &1.status, & &1.total)
|> Map.new(fn {status, totals} -> {status, Enum.sum(totals)} end)
|> Enum.filter(fn {_status, sum} -> sum > 1000 end)`,
    },
    {
      title: "reduce, the engine",
      note: "Rebuild map and filter from it to prove the point.",
      code: `Enum.reduce([1,2,3,4], 0, fn x, acc -> acc + x end)

# map via reduce
Enum.reduce([1,2,3], [], fn x, acc -> [x * 2 | acc] end) |> Enum.reverse()

# a word counter via reduce
~w(a b a c b a)
|> Enum.reduce(%{}, fn w, acc -> Map.update(acc, w, 1, &(&1 + 1)) end)

# reduce_while for early exit
Enum.reduce_while(1..1_000_000, 0, fn i, acc ->
  if acc > 100, do: {:halt, acc}, else: {:cont, acc + i}
end)`,
    },
    {
      title: "The rest of the vocabulary",
      note: "",
      code: `Enum.with_index(["a","b","c"])
Enum.chunk_every(1..10, 3)
Enum.zip([1,2,3], [:a,:b,:c])
Enum.sort_by([%{n: 3},%{n: 1}], & &1.n)
Enum.join(["a","b","c"], ", ")
Enum.uniq_by([%{id: 1},%{id: 1},%{id: 2}], & &1.id)
Enum.any?([1,2,3], &(&1 > 2))
Enum.find([1,2,3], &(&1 > 1))
Enum.into([a: 1, b: 2], %{})
Enum.frequencies(~w(x y x))
Enum.min_max([5,1,9])`,
    },
    {
      title: "Enum works on more than lists",
      note: "Anything implementing Enumerable.",
      code: `Enum.map(1..5, &(&1 * &1))                 # a Range
Enum.map(%{a: 1, b: 2}, fn {k, v} -> {k, v * 10} end)   # a Map
Enum.take(Stream.cycle([:a, :b]), 5)       # an infinite Stream
File.stream!("/etc/hosts") |> Enum.take(3) # a File stream`,
    },
  ],
};
