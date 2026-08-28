export default {
  front:
    "Why does calling an anonymous function need a dot — `f.(1)` — while a named one does not?",
  back: "Because they are different things. A named function is resolved at compile time from module+name+arity. An anonymous function is a **value** held in a variable, and the dot says explicitly 'invoke the function stored in this name' rather than 'call a local function called f'. `&Mod.fun/1` captures a named function as a value, and `&(&1 * 2)` is shorthand for a small anonymous function.",
  philosophy: {
    lead: "Functions are values you can put in lists, send to other processes, and store in state. The dot marks the moment a value becomes a call.",
    body: [
      "This ceremony is unusual but it removes real ambiguity: in Elixir you can have a variable `length` and a function `length/1` in scope at the same time, and the syntax tells you unambiguously which you meant. Erlang made the same choice for the same reason.",
      "The capture operator `&` is the workhorse. `&String.upcase/1` turns a named function into a value with zero boilerplate. `&(&1 + &2)` builds a two-argument lambda inline. You will see it constantly in pipelines, in `Enum` calls, and in supervisor child specs where you hand a function to be run in another process.",
      "Anonymous functions are closures: they capture the variables in scope when they were created. Because those values are immutable, sending a closure to another process is safe — nothing it captured can change under it.",
    ],
    diagram: `flowchart TB
  forms["double = fn n -&gt; n * 2 end     double.(21)   ← the DOT is required<br/>double = &amp;(&amp;1 * 2)                same thing, shorthand<br/>upcase = &amp;String.upcase/1         capture a NAMED function as a value<br/><br/>&amp;1 &amp;2 &amp;3 = first, second, third argument"]:::code
  forms --> d0
  subgraph dot["why the dot exists"]
    direction TB
    d0["length = fn l -&gt; :custom end"]:::muted
    d0 --> d1["length([1,2,3]) → Kernel.length/1 → 3"]:::ok
    d0 --> d2["length.([1,2,3]) → YOUR function → :custom"]:::ok
  end
  d2 --> noamb["two separate namespaces<br/>⇒ no ambiguity, ever"]:::hot
  noamb --> vals["functions are VALUES<br/>[&amp;String.upcase/1, &amp;String.reverse/1]<br/>¦&gt; Enum.reduce('hello', fn f, acc -&gt; f.(acc) end)   ⇒ 'OLLEH'"]:::code`,
    takeaway:
      "fn ... end makes a value; the dot calls it; & captures and abbreviates.",
  },
  codeSamples: [
    {
      title: "Three ways to write the same lambda",
      note: "",
      code: `a = fn n -> n * 2 end
b = &(&1 * 2)
c = fn
  n when is_integer(n) -> n * 2
  n -> n
end

a.(21); b.(21); c.(21)`,
    },
    {
      title: "Capturing named functions",
      note: "This is the form you will use most in pipelines.",
      code: `["ada", "grace", "alan"]
|> Enum.map(&String.upcase/1)
|> Enum.sort()

# capture with fixed arguments
add = &Kernel.+/2
add.(2, 3)

# &Mod.fun/arity works for your own modules too
defmodule T, do: (def shout(s), do: s <> "!")
Enum.map(["a","b"], &T.shout/1)`,
    },
    {
      title: "Closures capture values",
      note: "Safe to send to another process, because values cannot change.",
      code: `multiplier = 3
times = fn n -> n * multiplier end
multiplier = 100         # rebinding does NOT affect the closure
times.(5)                # 15  ✓

# functions as data in a map — a tiny dispatch table
ops = %{add: &+/2, sub: &-/2, mul: &*/2}
ops.add.(2, 3)
ops[:mul].(4, 5)`,
    },
  ],
};
