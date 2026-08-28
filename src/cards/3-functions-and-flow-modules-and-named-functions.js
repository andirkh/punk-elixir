export default {
  front:
    "What is `Enum.map/2` — and what do the dot and the slash-2 actually mean?",
  back: "`Enum` is a **module** (a namespace of functions, compiled into one BEAM file). `map` is a public function inside it, defined with `def`. `/2` is its **arity** — the number of arguments. In Elixir, name+arity is the identity of a function: `map/2` and `map/3` are entirely different functions. `defp` makes a function private to its module.",
  philosophy: {
    lead: "Elixir has no objects. It has modules holding functions, and data passed between them. That is the whole organising principle.",
    body: [
      "Coming from OOP, the instinct is to look for the class that owns the data. There is none. A `%User{}` map has no methods; `Accounts.deactivate(user)` is a function in a module that takes a user and returns a new one. Data and behaviour are deliberately separated, which is what makes it safe to send data to another process — you are sending values, never live objects with hidden state.",
      "Arity being part of the name is more important than it sounds. It is why you see `&Enum.map/2` in captures, `{Mod, :fun, 2}` in stack traces, and why default arguments generate several arities from one definition. When someone says 'implement `handle_call/3`', they are naming an exact contract.",
      "Modules nest by convention only: `MyApp.Accounts.User` is one flat atom with dots in it, not a hierarchy. Nesting communicates intent to humans and nothing to the compiler.",
    ],
    diagram: `flowchart TB
  mod["defmodule MyApp.Accounts do<br/>  def create(attrs), do: ...<br/>  def create(attrs, opts), do: ...<br/>  defp validate(attrs), do: ...   ← private, invisible outside<br/>end"]:::code
  mod --> atom["a module name is just an atom<br/>:'Elixir.MyApp.Accounts'"]:::muted
  atom --> arity["MyApp.Accounts.create/1 and create/2 are DIFFERENT functions<br/>name + arity = identity"]:::hot
  arity --> cmp
  subgraph cmp["the shift you have to make"]
    direction LR
    oop["OOP<br/>user.deactivate()<br/>data owns behaviour<br/>an object holds state"]:::warn
    ex["ELIXIR<br/>Accounts.deactivate(user)<br/>data is inert, modules act<br/>value in → new value out"]:::ok
  end`,
    takeaway:
      "Modules group functions; data is inert. name/arity is the true function name.",
  },
  codeSamples: [
    {
      title: "Define one in iex",
      note: "Whole modules can be pasted straight into the shell.",
      code: `defmodule Math do
  @moduledoc "Small maths helpers."

  @doc "Squares a number."
  def square(n), do: n * n

  def cube(n) do
    n * square(n)
  end

  defp secret, do: :hidden
end

Math.square(5)
Math.cube(3)
# Math.secret()      # ** (UndefinedFunctionError) — defp is private
h Math.square`,
    },
    {
      title: "Arity is identity",
      note: "",
      code: `defmodule Greeter do
  def hello(name), do: "hi #{name}"
  def hello(name, title), do: "hi #{title} #{name}"
end

Greeter.hello("Ada")
Greeter.hello("Ada", "Dr.")
function_exported?(Greeter, :hello, 1)   # true
function_exported?(Greeter, :hello, 3)   # false`,
    },
    {
      title: "Default arguments generate arities",
      note: "Note the double backslash.",
      code: `defmodule Pager do
  def page(items, num \\\\ 1, size \\\\ 10) do
    Enum.slice(items, (num - 1) * size, size)
  end
end

Pager.page(Enum.to_list(1..30))
Pager.page(Enum.to_list(1..30), 2)
Pager.page(Enum.to_list(1..30), 2, 5)
# one definition, three arities: page/1, page/2, page/3`,
    },
  ],
};
