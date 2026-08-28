export default {
  front:
    "Why does `1 = x` compile, and what does the `=` operator actually do?",
  back: "`=` is the **match operator**. It asserts that the left side and the right side have the same shape, binding any unbound variables on the left to make it true. `x = 1` binds x. `1 = x` succeeds if x already equals 1, and raises `MatchError` if not. It is an equation, not a command.",
  philosophy: {
    lead: "Everything you already know about lists, tuples, maps and atoms now becomes a language for describing shapes — and matching a shape is how Elixir makes decisions.",
    body: [
      "In imperative languages, `=` copies a value into a box. In Elixir `=` is closer to algebra: you write down a claim about structure, and the runtime either makes it true by binding variables, or blows up loudly because your data was not the shape you expected.",
      "That loud failure is a feature. Instead of defensively checking `if response != nil and response.status == 200`, you write `{:ok, %{status: 200, body: body}} = response` and you are done: either you have `body`, or the process crashes with a message showing exactly what it got instead. Combined with supervision (later cards), crashing on unexpected shapes is safer than limping along with bad data.",
      "From here on, almost every construct — function heads, `case`, `with`, `receive`, `for` — is just pattern matching wearing a different hat. Learn it once, get all of them.",
    ],
    diagram: `flowchart TB
  subgraph three["= asks TWO questions at once: is this the shape I expected, and give me the pieces"]
    direction LR
    c1["x = 1<br/>x is unbound<br/>⇒ BINDS x = 1"]:::ok
    c2["1 = x<br/>x already bound to 1<br/>⇒ ASSERTS they are equal"]:::ok
    c3["{a, b} = {1, 2}<br/>shapes agree<br/>⇒ BINDS a = 1, b = 2"]:::ok
  end
  three --> fail["{:ok, body} = {:error, :timeout}<br/>expected shape vs actual value"]:::warn
  fail --> boom["** (MatchError) — loud and immediate<br/>the bad shape never travels further"]:::bad`,
    takeaway:
      "= asserts a shape and binds the holes. Failure is a crash, and that is good.",
  },
  codeSamples: [
    {
      title: "Both directions",
      note: "",
      code: `x = 1        # binds
1 = x        # asserts, ok
# 2 = x      # ** (MatchError) right hand side value: 1

{a, b} = {:ok, "payload"}
a  # :ok
b  # "payload"

# _ matches anything and discards it
{_, value} = {:ignored, 42}
value`,
    },
    {
      title: "match?/2 — a boolean test",
      note: "Useful in filters and tests where you do not want a crash.",
      code: `match?({:ok, _}, {:ok, 1})       # true
match?({:ok, _}, {:error, :x})   # false

[{:ok, 1}, {:error, :nope}, {:ok, 3}]
|> Enum.filter(&match?({:ok, _}, &1))`,
    },
    {
      title: "Crash-on-surprise style",
      note: "This is idiomatic, not sloppy.",
      code: `# say this comes from an HTTP client
response = {:ok, %{status: 200, body: "hi"}}

{:ok, %{status: 200, body: body}} = response
body     # "hi"

# if the server returned 500 you get an immediate, descriptive crash
# instead of a nil sneaking three layers deeper into your code`,
    },
  ],
};
