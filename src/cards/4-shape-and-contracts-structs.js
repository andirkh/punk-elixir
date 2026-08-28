export default {
  front:
    "A plain map lets any key in. How do you define a User with a fixed set of fields that fails loudly on typos?",
  back: '`defstruct` inside a module. `%User{name: "Ada"}` creates a map with a hidden `__struct__: User` key and ONLY the declared fields — a typo is a compile-time error. Structs are still maps, so all Map functions work, but they have no `Access` behaviour by default (`user[:name]` fails; use `user.name`) and they carry a type you can pattern-match on.',
  philosophy: {
    lead: "A struct is a map plus a name plus a closed set of fields — enough structure to catch mistakes, still plain data.",
    body: [
      "The `__struct__` key is what makes `%User{}` matchable in a function head. That single trick gives Elixir type-based dispatch without objects: `def notify(%User{} = u)` and `def notify(%Admin{} = a)` are two clauses distinguished by struct name. Ecto schemas, Plug.Conn, Ecto.Changeset, DateTime — everything you will touch in the web stack is a struct.",
      "Field defaults are declared once and `@enforce_keys` makes chosen fields mandatory at construction time. Combined, they let a struct express a real invariant: a User without an email cannot be built by accident.",
      "Because a struct is still a map, updating uses the same `%{user | field: v}` syntax you already know — and that form checks that the field exists, so a typo in an update also fails immediately.",
    ],
    diagram: `flowchart TB
  def0["defmodule User do<br/>  @enforce_keys [:email]<br/>  defstruct [:email, :name, role: :member, active: true]<br/>end"]:::code
  def0 --> made["%User{email: 'a@b.c'}<br/>⇒ %User{__struct__: User, email: 'a@b.c', name: nil, role: :member, active: true}"]:::ok
  made --> tag["__struct__ is the hidden TYPE TAG<br/>this is what you match on"]:::hot
  tag --> checks["%User{typo: 1}     ⇒ COMPILE ERROR: unknown key ✓<br/>%User{}            ⇒ ERROR: the following keys must be given: [:email]<br/>%{user ¦ role: :x} ⇒ ok, the field exists<br/>%{user ¦ rle: :x}  ⇒ KeyError ✓"]:::warn
  checks --> nat["a struct IS a map — Map.from_struct(u), Map.put(u, :name, 'x')<br/>a struct is NOT Access — u.name ✓ but u[:name] ✗ unless you derive it"]:::muted
  nat --> disp["DISPATCH BY STRUCT NAME<br/>def notify(%User{}),  do: :email<br/>def notify(%Admin{}), do: :pager"]:::code`,
    takeaway:
      "defstruct = named map with fixed fields. The struct name is a type you can match.",
  },
  codeSamples: [
    {
      title: "Define and construct",
      note: "",
      code: `defmodule User do
  @enforce_keys [:email]
  defstruct [:email, :name, role: :member, active: true]
end

u = %User{email: "ada@x.dev", name: "Ada"}
u.role
%{u | role: :admin}
Map.from_struct(u)
# %User{}                    # error: :email is required
# %User{email: "a", nam: 1}  # compile error: unknown key :nam`,
    },
    {
      title: "Dispatch on struct type",
      note: "Polymorphism without inheritance.",
      code: `defmodule Admin, do: defstruct([:email, pager: true])

defmodule Notifier do
  def notify(%User{email: e}),  do: "email to #{e}"
  def notify(%Admin{email: e}), do: "PAGE #{e} immediately"
  def notify(other), do: "cannot notify #{inspect(other)}"
end

Notifier.notify(%User{email: "ada@x.dev"})
Notifier.notify(%Admin{email: "ops@x.dev"})`,
    },
    {
      title: "Constructor + smart defaults",
      note: "The pattern real codebases use.",
      code: `defmodule Account do
  defstruct [:id, :owner, balance: 0, created_at: nil, status: :open]

  def new(owner, opts \\\\ []) do
    %Account{
      id: System.unique_integer([:positive]),
      owner: owner,
      balance: Keyword.get(opts, :balance, 0),
      created_at: DateTime.utc_now()
    }
  end

  def deposit(%Account{status: :open} = a, amount) when amount > 0,
    do: {:ok, %{a | balance: a.balance + amount}}
  def deposit(%Account{status: :open}, _), do: {:error, :invalid_amount}
  def deposit(%Account{}, _), do: {:error, :account_closed}
end

acc = Account.new("Ada", balance: 100)
Account.deposit(acc, 50)
Account.deposit(%{acc | status: :closed}, 50)`,
    },
    {
      title: "Structs you already use",
      note: "",
      code: `d = DateTime.utc_now()
d.__struct__
r = Range.new(1, 5)
i = %Version{major: 1, minor: 2, patch: 3}
is_struct(d)                 # true
is_struct(d, DateTime)       # true`,
    },
  ],
};
