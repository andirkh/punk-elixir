export default {
  front:
    "You must process a 4GB CSV and sum one column. Why does the Enum pipeline from the last card kill your server, and what replaces it?",
  back: "Enum is eager: `File.read!` loads 4GB into memory, and every `Enum.map` builds another full copy. `Stream` is lazy — it composes the operations into a single recipe and runs them one element at a time, only when a final eager function (`Enum.sum`, `Stream.run`, `Enum.to_list`) pulls. Constant memory, one pass.",
  philosophy: {
    lead: "Same vocabulary, different execution strategy: describe the pipeline first, run it element by element later.",
    body: [
      "Every `Stream` function returns a new Stream struct rather than data. Nothing happens until something demands a value. Then one element is pulled through the whole chain, emitted, and discarded before the next is read. Memory stays flat whether the source is 100 rows or 100 million.",
      "This is your first taste of a much bigger BEAM idea: **demand-driven flow**. The consumer asks, the producer supplies. That is the exact model of GenStage, Broadway and Flow, the libraries used for real data pipelines in Elixir, and it is how backpressure works — a slow consumer automatically slows the producer instead of exploding a queue.",
      "The trade-off is per-element overhead. For a few thousand items in memory, Enum is faster. Use Stream when the collection is large, infinite, or comes from I/O.",
    ],
    diagram: `flowchart TB
  subgraph eager["EAGER — Enum · every step builds a full list"]
    direction TB
    e0["1..1_000_000"]:::muted --> e1["map ⇒ 1M items in RAM"]:::bad --> e2["filter ⇒ ANOTHER list"]:::bad --> e3["sum"]:::muted
  end
  subgraph lazy["LAZY — Stream · the steps are a RECIPE"]
    direction TB
    z0["1..1_000_000"]:::muted --> z1["Stream{ops: [map, filter]}<br/>nothing has run yet"]:::hot
    z1 --> z2["Enum.sum() PULLS<br/>1 → map → filter → acc<br/>2 → map → filter → acc<br/>3 → …  one element at a time"]:::ok
    z2 --> z3["constant memory ✓"]:::ok
  end
  e3 ~~~ z0
  z3 --> verdict["4GB file + Enum ⇒ 💥      4GB file + Stream ⇒ fine<br/><br/>streams are also INFINITE-safe<br/>Stream.iterate(1, fun) ¦&gt; Enum.take(10)"]:::warn`,
    takeaway:
      "Stream builds a recipe; an eager call runs it one element at a time. Demand pulls data.",
  },
  codeSamples: [
    {
      title: "Lazy is visible",
      note: "Watch when the IO.inspect actually fires.",
      code: `stream =
  1..5
  |> Stream.map(fn x -> IO.inspect(x, label: "mapping"); x * 2 end)
  |> Stream.filter(fn x -> x > 4 end)

# nothing printed yet — it is only a recipe:
stream

# now pull:
Enum.to_list(stream)`,
    },
    {
      title: "The 4GB file, safely",
      note: "Constant memory regardless of file size.",
      code: `# create a sample file first
File.write!("/tmp/nums.csv", Enum.map_join(1..200_000, "\\n", &"row#{&1},#{&1}"))

total =
  "/tmp/nums.csv"
  |> File.stream!()                       # lazy, line by line
  |> Stream.map(&String.trim/1)
  |> Stream.map(&String.split(&1, ","))
  |> Stream.map(fn [_name, amount] -> String.to_integer(amount) end)
  |> Enum.sum()                           # only NOW does it read

total`,
    },
    {
      title: "Infinite streams",
      note: "Impossible with Enum.",
      code: `Stream.iterate(1, &(&1 * 2)) |> Enum.take(10)
Stream.cycle([:red, :green, :blue]) |> Enum.take(7)
Stream.repeatedly(fn -> :rand.uniform(100) end) |> Enum.take(5)

# fibonacci
Stream.unfold({0, 1}, fn {a, b} -> {a, {b, a + b}} end) |> Enum.take(12)`,
    },
    {
      title: "Chunked writes — the ETL shape",
      note: "Read lazily, batch, write. This is a real import job.",
      code: `"/tmp/nums.csv"
|> File.stream!()
|> Stream.map(&String.trim/1)
|> Stream.chunk_every(1_000)              # batch for the DB
|> Stream.map(fn batch -> {:inserted, length(batch)} end)
|> Enum.take(3)
# later you will replace the map with Repo.insert_all/3`,
    },
  ],
};
