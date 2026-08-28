export default {
  front:
    "What is `:ok`, and why does nearly every Elixir function you will ever call return something like `{:ok, value}`?",
  back: "`:ok` is an **atom** — a constant whose name is its own value, like a symbol or enum member. Atoms are compared in O(1) by pointer, never allocated twice, and read beautifully. Elixir uses them as tags: `:ok`, `:error`, `:noreply`, `:infinity`, `true`/`false`/`nil` are themselves atoms. Tagging results makes success and failure pattern-matchable instead of exception-driven.",
  philosophy: {
    lead: "An atom is a name that means only itself. It is the cheapest possible way to say 'this thing is of this kind'.",
    body: [
      "Elixir's scalar types are few and honest: integers (arbitrary precision — no overflow, ever), floats (64-bit), booleans, atoms, binaries (strings), and nil. Booleans are secretly atoms; `true == :true`. So is `nil`. This uniformity means one mechanism, pattern matching, can inspect everything.",
      "Atoms shine as *tags*. Instead of returning null, or throwing, an Elixir function returns `{:ok, user}` or `{:error, :not_found}`. The caller pattern-matches the tag and both paths are visible in the code. Errors stop being invisible control flow and become ordinary data you can pipe, log, and match on.",
      "One caution that matters in real services: atoms are never garbage collected, and the table caps around 1,048,576. Never call `String.to_atom/1` on user input — an attacker could exhaust the table and kill the node. Use `String.to_existing_atom/1` instead. This is a genuine production footgun worth memorising now.",
    ],
    diagram: `flowchart TB
  types["TYPES YOU WILL USE HOURLY<br/><br/>integer — 42, 1_000_000 — arbitrary precision<br/>float — 3.14, 1.0e-3 — always 64-bit<br/>atom — :ok :error nil — constant, name IS the value<br/>boolean — true false — these ARE atoms<br/>binary — #quot;hello#quot; — UTF-8 bytes"]:::code
  types ~~~ ins["Repo.insert(user)"]:::hot
  subgraph tagged["THE TAGGED RESULT — the spine of every Elixir API"]
    direction LR
    ins --> okk["{:ok, user}"]:::ok
    ins --> errr["{:error, changeset}"]:::bad
  end
  okk --> match["you MATCH on the tag<br/>you do not catch an exception"]:::hot
  errr --> match`,
    takeaway: "Atoms are free constants. Tagged tuples turn errors into data.",
  },
  codeSamples: [
    {
      title: "Meet the types",
      note: "",
      code: `i 42
i 3.14
i :ok
i true            # secretly an atom
is_atom(true)     # true
is_atom(nil)      # true

# integers never overflow:
2 ** 200

# division always returns a float; use div/rem for integers
7 / 2      # 3.5
div(7, 2)  # 3
rem(7, 2)  # 1`,
    },
    {
      title: "The tagged-tuple habit",
      note: "You will write hundreds of these.",
      code: `result = {:ok, %{id: 1, name: "Ada"}}

case result do
  {:ok, user}      -> "welcome " <> user.name
  {:error, reason} -> "failed: " <> inspect(reason)
end`,
    },
    {
      title: "The atom-table footgun",
      note: "Remember this before you ever parse JSON keys into atoms.",
      code: `String.to_atom("safe_now")            # creates an atom forever

# NEVER on user input. Do this instead:
String.to_existing_atom("ok")         # :ok
# String.to_existing_atom("hax0r")    # raises ArgumentError ✓

:erlang.system_info(:atom_count)      # you have ~1M total, ever`,
    },
  ],
};
