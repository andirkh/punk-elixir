export default {
  front:
    "You write `list = [1,2,3]` then `Enum.map(list, & &1 * 2)`. What is `list` afterwards, and why does that matter for concurrency?",
  back: "`list` is still `[1,2,3]`. Data in Elixir is immutable — functions never mutate their arguments, they return NEW values. You may rebind the NAME (`list = [9]` is legal), but the old value is untouched, and anyone else holding it still sees the original. That is precisely what makes it safe to share values between processes without locks.",
  philosophy: {
    lead: "A variable in Elixir is a label you can move. The thing it labels can never change.",
    body: [
      "This is the single biggest mental shift coming from Python, Java or JavaScript. There, `list.append(4)` reaches into an object and changes it, and every other reference to that object silently changes too. That is the source of most 'spooky action at a distance' bugs, and it is why concurrent code needs locks — two threads must not touch the same object at once.",
      "In Elixir, `Enum.map` cannot modify anything. It reads the old value and builds a new one. Since nobody can mutate a value, two processes reading the same value can never race. Concurrency safety is not something you add with discipline; it falls out of the data model.",
      "Rebinding is allowed and idiomatic — `conn = Plug.Conn.put_status(conn, 404)` reads naturally and is everywhere in Phoenix. Just hold the distinction: the *name* moved, the *value* did not change. (And rebinding is scoped — a name rebound inside an `if` does not leak out, which trips up every newcomer exactly once.)",
    ],
    diagram: `flowchart TB
  subgraph mut["MUTABLE world — Python / JS"]
    direction LR
    ma["a"]:::muted --> mlist["[1,2,3] → append(4) → [1,2,3,4]"]:::bad
    mb["b"]:::muted --> mlist
    mlist --> oops["a AND b are both [1,2,3,4]<br/>b never asked for that"]:::bad
  end
  subgraph imm["IMMUTABLE world — Elixir"]
    direction LR
    ia["a"]:::muted --> frozen["[1,2,3] frozen forever"]:::ok
    ib["b"]:::muted --> frozen
    ia -.->|rebinding moves the LABEL| nine["[9]"]:::hot
    frozen --> safe["b still sees [1,2,3]<br/>sharing is always safe"]:::ok
  end
  mut ~~~ imm
  imm --> why["no shared mutable state<br/>⇒ no locks<br/>⇒ concurrency is free"]:::hot`,
    takeaway:
      "Functions return new data. Rebinding moves a name, never a value.",
  },
  codeSamples: [
    {
      title: "Watch the value survive",
      note: "Nothing you do to `list` changes `list`.",
      code: `list = [1, 2, 3]
doubled = Enum.map(list, fn n -> n * 2 end)

list      # [1, 2, 3]   <- untouched
doubled   # [2, 4, 6]

map = %{name: "Ada"}
map2 = Map.put(map, :age, 36)
map       # %{name: "Ada"}
map2      # %{age: 36, name: "Ada"}`,
    },
    {
      title: "Rebinding is fine — and scoped",
      note: "The classic beginner trap is at the bottom.",
      code: `x = 1
x = x + 1
x           # 2  (the name moved twice)

# but rebinding inside a block does NOT leak out:
y = 1
if true do
  y = 99      # warning: this will be unused
end
y           # still 1  !!

# do this instead — return the value:
y = if true, do: 99, else: 1
y           # 99`,
    },
  ],
};
