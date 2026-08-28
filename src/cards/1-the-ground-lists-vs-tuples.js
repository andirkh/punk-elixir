export default {
  front:
    "You have a collection of 10,000 orders, and separately a return value `{:ok, order}`. Which is a list and which is a tuple — and why is that not arbitrary?",
  back: "The 10,000 orders are a **list**: a singly-linked list, cheap to prepend (O(1)) and to walk, expensive to index or append (O(n)). `{:ok, order}` is a **tuple**: contiguous in memory, O(1) access by index, cheap to pattern-match — but copied whole when changed. Rule of thumb: lists for *many of the same thing*, tuples for *a few related things of different kinds*.",
  philosophy: {
    lead: "The two collection types encode two different intentions, and Elixir's whole style follows from picking the right one.",
    body: [
      "A list is a chain of cons cells: each cell holds a value and a pointer to the rest. That is why `[head | tail]` is the most natural pattern in the language, why prepending is instant, and why `length/1` has to walk the entire chain. If you find yourself indexing a list by position, you almost always wanted a different structure.",
      "A tuple is a fixed-size record laid out contiguously. It has no natural 'rest'. That makes it perfect for small, known shapes — coordinates `{x, y}`, results `{:ok, value}`, GenServer replies `{:reply, answer, state}`. Because the size and shape are fixed, pattern matching against a tuple is essentially free.",
      "Once you internalise this, you can read unfamiliar Elixir at a glance: a tuple in a signature says 'this has a known shape, match it', a list says 'this repeats, fold over it'.",
    ],
    diagram: `flowchart TB
  subgraph lst["LIST [1, 2, 3] — singly linked, grows at the FRONT"]
    direction LR
    l1["1 · ●"]:::code --> l2["2 · ●"]:::code --> l3["3 · ●"]:::code --> nil0["[]"]:::muted
  end
  lst --> lcost["[0 ¦ list] is O(1) ✓<br/>list ++ [4] is O(n) ✗<br/>Enum.at(list, 900) is O(n) ✗"]:::warn
  subgraph tup["TUPLE {:ok, user} — contiguous, fixed size"]
    direction LR
    t0[":ok"]:::code --- t1["user"]:::code
  end
  lcost ~~~ tup
  tup --> tcost["elem(t, 0) is O(1) ✓<br/>put_elem copies the WHOLE tuple"]:::warn
  tcost --> rule["LISTS: many homogeneous items you iterate<br/>TUPLES: a few heterogeneous fields you match"]:::hot`,
    takeaway:
      "Lists repeat and are walked. Tuples have a shape and are matched.",
  },
  codeSamples: [
    {
      title: "List mechanics",
      note: "Feel the head/tail structure.",
      code: `list = [1, 2, 3]
hd(list)          # 1
tl(list)          # [2, 3]
[0 | list]        # [0,1,2,3]   fast
list ++ [4]       # [1,2,3,4]   slow, walks the whole list
length(list)      # walks the list — O(n)

[head | tail] = [10, 20, 30]
head   # 10
tail   # [20, 30]`,
    },
    {
      title: "Tuple mechanics",
      note: "",
      code: `t = {:ok, "payload", 200}
elem(t, 0)          # :ok
tuple_size(t)       # 3
put_elem(t, 2, 404) # a NEW tuple

{status, body, code} = t
status  # :ok`,
    },
    {
      title: "Why the guideline is real",
      note: "Benchmark the wrong choice once and you will never forget it.",
      code: `big = Enum.to_list(1..200_000)

# fast: prepend
:timer.tc(fn -> [0 | big] end) |> elem(0)          # microseconds ~1

# slow: append
:timer.tc(fn -> big ++ [0] end) |> elem(0)         # thousands of µs

# idiomatic: build reversed, then reverse once
Enum.reduce([1,2,3], [], fn x, acc -> [x | acc] end) |> Enum.reverse()`,
    },
  ],
};
