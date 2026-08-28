export default {
  front:
    "You already have multi-clause functions. When do you still reach for case, cond or if?",
  back: "`case` when you are matching ONE value against several patterns inside a function. `cond` when you have several unrelated boolean conditions (Elixir's else-if chain). `if/unless` only for a simple true/false. All three are ordinary expressions that RETURN a value — there is no statement/expression split in Elixir.",
  philosophy: {
    lead: "These are conveniences layered on pattern matching, not new mechanisms. Reach for the smallest one that fits.",
    body: [
      "`case` is multi-clause matching scoped to a single expression, guards included. It is the right tool when the branch is local and naming a whole new function would add noise. When the branches grow bodies of more than a few lines, promote them back to function clauses — flat functions beat a case with five long arms.",
      "`cond` exists because sometimes the conditions have nothing to do with one another and no single value is being matched. It reads top to bottom and raises if nothing matches, so it usually ends with `true -> default`.",
      "Two things surprise newcomers. First, only `false` and `nil` are falsy — 0 and the empty list and the empty string are all truthy. Second, every branch returns a value, so `status = case resp do ... end` is the normal way to compute something conditionally. That is why rebinding inside an if (card 3) is a mistake: you want the return value, not a side effect.",
    ],
    diagram: `flowchart TB
  subgraph pick["which one do I reach for?"]
    direction LR
    kase["ONE value, MANY shapes ⇒ case<br/><br/>case resp do<br/>  {:ok, %{status: 200}} -&gt; :fine<br/>  {:ok, %{status: s}} when s &gt;= 500 -&gt; :retry<br/>  {:error, r} -&gt; ...<br/>  _ -&gt; :unknown<br/>end"]:::hot
    kond["MANY unrelated conditions ⇒ cond<br/><br/>cond do<br/>  score &gt; 90 -&gt; :a<br/>  attempts &gt; 3 -&gt; :locked<br/>  is_nil(user) -&gt; :anon<br/>  true -&gt; :default   ← always add this<br/>end"]:::hot
    iff["a SIMPLE boolean ⇒ if<br/><br/>if x, do: a, else: b"]:::ok
  end
  pick --> truth["TRUTHINESS<br/>falsy = false and nil — that is the ENTIRE list<br/>truthy = 0, '', [], %{}, :ok, everything else"]:::warn
  truth --> ret["EVERYTHING RETURNS A VALUE<br/>status = case resp do … end     ✓ idiomatic<br/>case resp do … end  then  status ✗ not how this works"]:::ok`,
    takeaway:
      "case matches one value, cond chains conditions, if is boolean. All return values.",
  },
  codeSamples: [
    {
      title: "case with guards",
      note: "",
      code: `resp = {:ok, %{status: 503, body: ""}}

case resp do
  {:ok, %{status: 200, body: body}} -> {:done, body}
  {:ok, %{status: s}} when s >= 500 -> {:retry, s}
  {:ok, %{status: s}}               -> {:give_up, s}
  {:error, reason}                  -> {:failed, reason}
end`,
    },
    {
      title: "cond and if",
      note: "",
      code: `score = 87
attempts = 1

cond do
  attempts > 3 -> :locked
  score >= 90  -> :excellent
  score >= 70  -> :pass
  true         -> :fail
end

max = if score > 50, do: "high", else: "low"
unless score == 0, do: "played"`,
    },
    {
      title: "Truthiness traps",
      note: "Run every line; two of them surprise people.",
      code: `if 0, do: :truthy, else: :falsy        # :truthy  (!)
if [], do: :truthy, else: :falsy       # :truthy  (!)
if "", do: :truthy, else: :falsy       # :truthy  (!)
if nil, do: :truthy, else: :falsy      # :falsy
if false, do: :truthy, else: :falsy    # :falsy

# strict boolean operators require real booleans:
true and false
# 1 and true      # ** (BadBooleanError)
1 && true         # relaxed version works on truthy values
nil || "default"`,
    },
    {
      title: "Prefer clauses when bodies grow",
      note: "Same logic, flatter and testable.",
      code: `defmodule Resp do
  def handle({:ok, %{status: 200, body: b}}), do: {:done, b}
  def handle({:ok, %{status: s}}) when s >= 500, do: {:retry, s}
  def handle({:ok, %{status: s}}), do: {:give_up, s}
  def handle({:error, r}), do: {:failed, r}
end

Resp.handle({:ok, %{status: 503}})`,
    },
  ],
};
