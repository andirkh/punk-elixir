export default {
  front:
    "Why does `Repo.all(query, timeout: 5_000, log: false)` use a keyword list rather than a map?",
  back: "Keyword lists are lists of `{atom, value}` tuples. They are **ordered**, allow **duplicate keys**, and have literal syntax that can drop the brackets when last in a call. That makes them the canonical way to pass OPTIONS. Maps are for data; keyword lists are for options and for DSLs like Ecto queries, where order and repetition matter (`where:` can appear twice).",
  philosophy: {
    lead: "Two dictionary types exist because options and data have genuinely different requirements.",
    body: [
      "Options are read once, are few, arrive in source order, and sometimes repeat. A keyword list is literally `[{:timeout, 5000}, {:log, false}]` — a plain list you can pattern-match, prepend defaults to, and merge with `Keyword.merge/2`. Because Elixir lets you omit the square brackets for a trailing keyword list, `foo(a, b: 1, c: 2)` reads like named arguments in other languages.",
      "That same sugar is what makes Elixir DSLs possible without macro magic in the call site. `if cond do ... else ... end` is really `if(cond, [do: ..., else: ...])`. Ecto's `from u in User, where: ..., order_by: ...` is a keyword list. Once you see the trick, the language stops looking like it has special syntax.",
      "Rule: if you are looking things up by key, use a map. If you are configuring a call, use a keyword list.",
    ],
    diagram: `flowchart TB
  sugar["[timeout: 5_000, log: false]<br/>is literally<br/>[{:timeout, 5000}, {:log, false}]<br/>a LIST of 2-tuples"]:::code
  sugar --> cmp
  subgraph cmp["keyword list vs map"]
    direction LR
    kw["KEYWORD LIST<br/>ordered — yes<br/>duplicate keys — yes<br/>lookup — O(n)<br/>used for OPTIONS and DSLs"]:::hot
    mp["MAP<br/>ordered — no<br/>duplicate keys — no<br/>lookup — O(log n)-ish<br/>used for DATA, state, records"]:::ok
  end
  cmp --> why["foo(x, a: 1, b: 2) ≡ foo(x, [{:a,1},{:b,2}])<br/><br/>which is why<br/>if x do y else z end ≡ if(x, do: y, else: z)"]:::code`,
    takeaway:
      "Keyword lists = options and DSLs. Maps = data. The bracket-dropping sugar is why Elixir DSLs read so well.",
  },
  codeSamples: [
    {
      title: "They are just lists of tuples",
      note: "",
      code: `opts = [timeout: 5_000, log: false]
opts == [{:timeout, 5_000}, {:log, false}]   # true

Keyword.get(opts, :timeout)          # 5000
Keyword.get(opts, :retries, 3)       # 3 (default)
Keyword.put(opts, :retries, 5)
Keyword.merge([timeout: 1, log: true], opts)`,
    },
    {
      title: "The options pattern you will write in every module",
      note: "",
      code: `defmodule Fetcher do
  @defaults [timeout: 5_000, retries: 3, log: true]

  def fetch(url, opts \\\\ []) do
    opts = Keyword.merge(@defaults, opts)
    {url, opts[:timeout], opts[:retries]}
  end
end

Fetcher.fetch("http://x.dev")
Fetcher.fetch("http://x.dev", timeout: 100)`,
    },
    {
      title: "Duplicates and order — why Ecto needs them",
      note: "",
      code: `q = [where: "age > 18", where: "active = true", order_by: "name"]
Keyword.get_values(q, :where)   # ["age > 18", "active = true"]

# a map would have silently dropped the first where clause`,
    },
    {
      title: "do/end is sugar",
      note: "Peek behind the curtain.",
      code: `if true, do: "yes", else: "no"

if true do
  "yes"
else
  "no"
end
# identical: both call if/2 with a keyword list`,
    },
  ],
};
