export default {
  front:
    "Function clauses match on shape. How do you branch on a CONDITION, like 'only if n is a positive integer'?",
  back: "A **guard**: `def f(n) when is_integer(n) and n > 0`. Guards run after the pattern matches and must be built only from a whitelist of side-effect-free, guaranteed-to-terminate expressions (`is_*`, comparisons, arithmetic, `in`, `and/or/not`). A guard that raises simply fails the clause instead of crashing — so you can safely test things that would otherwise error.",
  philosophy: {
    lead: "Guards extend pattern matching from 'what shape is this' to 'what shape is this, and does it satisfy a cheap predicate'.",
    body: [
      "The restricted grammar is not an oversight. Guards are evaluated by the BEAM in a special context: they cannot have side effects, cannot loop forever, and are used in places like `receive` clauses where arbitrary code would be catastrophic. That is why you cannot call your own function in a guard — unless you define it with `defguard`, which macro-expands into allowed primitives.",
      "The failure semantics are elegant. `def f(x) when x.age > 18` on a non-map does not blow up; the guard just fails and the next clause is tried. This makes guards a safe filter over messy input, which is exactly what you want at the edges of a service.",
      "Guards also appear in `case`, `cond`, `with`, `for` and `receive`. Once again: learn the concept once, reuse it in six places.",
    ],
    diagram: `flowchart TB
  clause["def bucket(n) when is_integer(n) and n &lt; 0, do: :negative"]:::code
  clause --> shape{"does the<br/>SHAPE match?"}:::hot
  shape -->|no| nextc["try the NEXT clause"]:::muted
  shape -->|yes| guard{"run the GUARD<br/>is it true?"}:::hot
  guard -->|true| run["execute the body"]:::ok
  guard -->|false| nextc
  guard -->|it raised| nextc
  guard -.->|a raising guard is treated as false — it never crashes| safe["✓ guards cannot blow up your program"]:::ok
  run ~~~ allowed
  subgraph allowed["what may appear in a guard"]
    direction LR
    yes["ALLOWED<br/>is_integer / is_map / is_pid ...<br/>== != &lt; &gt; &lt;= &gt;=<br/>+ - * div rem abs<br/>in, and, or, not<br/>map_size, length, hd, tl, elem, byte_size"]:::ok
    no["NOT ALLOWED<br/>your own functions — unless defguard<br/>String.contains?/2, Enum.*, IO.*<br/>anything with side effects<br/>case / if with side effects"]:::bad
  end`,
    takeaway:
      "Guards are cheap, pure, non-crashing predicates attached to a pattern.",
  },
  codeSamples: [
    {
      title: "Classify input",
      note: "",
      code: `defmodule Bucket do
  def of(n) when is_integer(n) and n < 0,   do: :negative
  def of(0),                                 do: :zero
  def of(n) when is_integer(n) and n <= 100, do: :small
  def of(n) when is_integer(n),              do: :large
  def of(n) when is_binary(n),               do: :a_string
  def of(_),                                 do: :unknown
end

Enum.map([-5, 0, 7, 9999, "hi", :atom], &Bucket.of/1)`,
    },
    {
      title: "Guards do not crash",
      note: "A failing guard just skips the clause.",
      code: `defmodule Age do
  def adult?(%{age: age}) when age >= 18, do: true
  def adult?(_), do: false
end

Age.adult?(%{age: 30})    # true
Age.adult?(%{age: 10})    # false
Age.adult?("nonsense")    # false — no crash ✓
Age.adult?(nil)           # false`,
    },
    {
      title: "defguard — reusable, composable",
      note: "",
      code: `defmodule Checks do
  defguard is_pos_int(n) when is_integer(n) and n > 0
  defguard is_http_ok(s) when is_integer(s) and s >= 200 and s < 300

  def take(n) when is_pos_int(n), do: "taking #{n}"
  def take(_), do: "invalid"

  def handle(status) when is_http_ok(status), do: :fine
  def handle(_), do: :problem
end

Checks.take(5); Checks.take(-1); Checks.handle(204); Checks.handle(500)`,
    },
    {
      title: "in/2 and multiple guards",
      note: "Separate alternatives with a second when.",
      code: `defmodule Http do
  @redirects [301, 302, 307, 308]
  def kind(s) when s in 200..299, do: :success
  def kind(s) when s in @redirects, do: :redirect
  def kind(s) when s in 400..499 when s == 418, do: :client_error
  def kind(s) when s >= 500, do: :server_error
end

Enum.map([200, 302, 404, 503], &Http.kind/1)`,
    },
  ],
};
