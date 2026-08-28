export default {
  front:
    "You want `size/1` to work on your struct, on lists, on maps, and on anything a future library defines — without editing those types. How?",
  back: "A **protocol**: `defprotocol Size do def size(t) end`, then a separate `defimpl Size, for: MyStruct` for each type. Dispatch happens at runtime on the data's type. Crucially, anyone can add an implementation for a type they do not own — that is why `Enumerable`, `Inspect`, `String.Chars` and `Jason.Encoder` are protocols.",
  philosophy: {
    lead: "Protocols give polymorphism on DATA: the value decides which implementation runs, and implementations live wherever they are needed.",
    body: [
      "This solves the expression problem in the direction backends care about. You cannot go and add a method to Elixir's List module, but you can write `defimpl Jason.Encoder, for: MyApp.Money` in your own project and suddenly your struct serialises to JSON everywhere in your app. Every serious library exposes its extension points this way.",
      "You have been using protocols since card 17 without noticing: `Enum` works on lists, maps, ranges, streams and Ecto results because each implements `Enumerable`. `to_string/1` uses `String.Chars`. `inspect/1` uses `Inspect` — and implementing `Inspect` for a struct holding a password is how you keep secrets out of your logs.",
      "`@derive` is the shortcut: it generates a standard implementation for your struct at definition time, which is how you say 'encode this struct to JSON using these fields' in one line.",
    ],
    diagram: `flowchart TB
  proto["defprotocol Size do<br/>  def size(data)<br/>end<br/><br/>ONE function name, MANY implementations, chosen by the DATA at runtime"]:::code
  proto --> impls
  subgraph impls["defimpl Size, for: …"]
    direction LR
    i1["BitString<br/>byte_size(s)"]:::hot
    i2["Map<br/>map_size(m)"]:::hot
    i3["MyApp.Bag<br/>b.count"]:::hot
  end
  impls --> disp["Size.size(%MyApp.Bag{}) → looks at __struct__ → the Bag impl"]:::ok
  disp --> own["you can implement a protocol for a type you did NOT write,<br/>from inside your own project ✓"]:::ok
  own --> known["PROTOCOLS YOU ALREADY USE<br/>Enumerable → Enum.* and Stream.*<br/>String.Chars → to_string/1 and interpolation<br/>Inspect → inspect/1, IO.inspect — hide secrets here<br/>Collectable → Enum.into/2 and for into:<br/>Jason.Encoder → JSON serialisation of your structs"]:::code
  known --> derive["@derive {Jason.Encoder, only: [:id, :name]}   ← the one-line shortcut"]:::warn`,
    takeaway:
      "Protocol = one interface, many data types, open for extension by anyone.",
  },
  codeSamples: [
    {
      title: "Define and implement",
      note: "",
      code: `defprotocol Size do
  @doc "Returns a size for any supported term."
  def size(data)
end

defimpl Size, for: BitString, do: (def size(s), do: byte_size(s))
defimpl Size, for: List,      do: (def size(l), do: length(l))
defimpl Size, for: Map,       do: (def size(m), do: map_size(m))

Size.size("hello")
Size.size([1,2,3])
Size.size(%{a: 1, b: 2})
# Size.size(42)   # ** (Protocol.UndefinedError)`,
    },
    {
      title: "Implement for your own struct",
      note: "",
      code: `defmodule Basket do
  defstruct items: []
end

defimpl Size, for: Basket do
  def size(%Basket{items: items}), do: length(items)
end

Size.size(%Basket{items: [:apple, :pear]})

# and make it printable + enumerable-ish
defimpl String.Chars, for: Basket do
  def to_string(%Basket{items: i}), do: "Basket(#{length(i)} items)"
end

"#{%Basket{items: [1,2,3]}}"`,
    },
    {
      title: "Hide secrets from logs",
      note: "A real production habit.",
      code: `defmodule Credentials do
  defstruct [:user, :password]
end

defimpl Inspect, for: Credentials do
  import Inspect.Algebra
  def inspect(%Credentials{user: u}, _opts) do
    concat(["#Credentials<user: ", to_doc(u, %Inspect.Opts{}), ", password: [REDACTED]>"])
  end
end

IO.inspect(%Credentials{user: "ada", password: "hunter2"})`,
    },
    {
      title: "@derive — the shortcut",
      note: "How you make a struct JSON-encodable in Phoenix.",
      code: `defmodule Money do
  @derive {Inspect, only: [:amount, :currency]}
  defstruct [:amount, :currency, :internal_ref]
end

IO.inspect(%Money{amount: 100, currency: "USD", internal_ref: "secret"})

# with the Jason library in a real project:
# @derive {Jason.Encoder, only: [:id, :name, :inserted_at]}
# defstruct [:id, :name, :inserted_at, :password_hash]`,
    },
  ],
};
