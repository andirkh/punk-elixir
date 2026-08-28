export default {
  front:
    'When do you write `%{name: "Ada"}` versus `%{"name" => "Ada"}`, and how do you update a key safely?',
  back: 'Atom keys (`%{name: ...}`) are for data YOU control — structs, internal state, options. String keys (`%{"name" => ...}`) are for data from OUTSIDE — JSON bodies, HTTP params, database rows before casting. Update with `%{map | key: v}` (raises if the key is missing — good for state) or `Map.put/3` (adds it). Read with `map.key` (raises) or `map[:key]` (returns nil).',
  philosophy: {
    lead: "The map is Elixir's default container for a labelled record, and its two key styles mark a real trust boundary.",
    body: [
      'The atom/string distinction is not stylistic — it is a security posture. Data arriving from the network must never be blindly converted to atoms (card 4: the atom table is finite and never collected). So Phoenix hands you `%{"email" => ...}` with string keys, and you convert to atoms only through an explicit whitelist — which is exactly what an Ecto changeset does in card 82. When you see string keys, you are looking at untrusted input.',
      "The two access styles matter too. `map.key` is a strict access that raises if the key is absent, which is what you want for internal state where a missing key is a bug. `map[:key]` is a lenient access returning nil, which is what you want for optional data. Picking deliberately turns a class of nil-propagation bugs into immediate crashes.",
      "Maps are implemented as flat arrays under 32 keys and as HAMTs above that, so they are fast at both sizes. They are also the substrate for structs (card 24), GenServer state (card 39) and Ecto schemas (card 81).",
    ],
    diagram: `flowchart TB
  subgraph outside["OUTSIDE WORLD — untrusted"]
    direction TB
    src["JSON · params · CSV"]:::muted
    sk["%{'email' =&gt; 'a@b.c'}<br/>STRING keys"]:::warn
    src ~~~ sk
  end
  subgraph inside["YOUR APPLICATION — trusted"]
    direction TB
    ak["%{email: 'a@b.c'}<br/>ATOM keys"]:::ok
    dst["structs · process state"]:::ok
    ak ~~~ dst
  end
  src --> sk
  sk -->|cast + validate · the changeset does this| ak
  ak --> dst
  api["READ<br/>map.email — raises if absent<br/>map[:email] — nil if absent<br/>Map.fetch(map, :email) — {:ok, v} or :error<br/><br/>UPDATE<br/>%{map ¦ email: v} — raises if the key is absent<br/>Map.put(map, :e, v) — insert or replace<br/>Map.update(map, :n, 0, fun) · Map.merge(a, b)"]:::code
  dst ~~~ api`,
    takeaway:
      "String keys = untrusted input. Atom keys = your own data. Choose strict or lenient access on purpose.",
  },
  codeSamples: [
    {
      title: "Building and reading",
      note: "",
      code: `user = %{name: "Ada", age: 36}
user.name              # "Ada"
user[:name]            # "Ada"
user[:nope]            # nil
# user.nope            # ** (KeyError)
Map.fetch(user, :age)  # {:ok, 36}
Map.fetch(user, :x)    # :error`,
    },
    {
      title: "Updating",
      note: "The pipe-friendly forms are what you use inside GenServers.",
      code: `user = %{name: "Ada", age: 36}

%{user | age: 37}                    # strict update, key must exist
Map.put(user, :email, "a@b.c")       # add or replace
Map.update(user, :age, 0, &(&1 + 1)) # transform with default
Map.merge(user, %{age: 40, tz: "UTC"})
Map.delete(user, :age)
Map.keys(user); Map.values(user)`,
    },
    {
      title: "Nested updates",
      note: "put_in / update_in save you from rebuilding by hand.",
      code: `state = %{users: %{1 => %{name: "Ada", visits: 3}}}

put_in(state, [:users, 1, :name], "Ada L.")
update_in(state, [:users, 1, :visits], &(&1 + 1))
get_in(state, [:users, 1, :visits])   # 3`,
    },
    {
      title: "Crossing the boundary",
      note: "Never String.to_atom on keys from the wire.",
      code: `params = %{"name" => "Ada", "age" => "36", "is_admin" => "true"}

# a hand-rolled whitelist (Ecto changesets automate this):
allowed = ~w(name age)
Enum.reduce(allowed, %{}, fn k, acc ->
  case Map.fetch(params, k) do
    {:ok, v} -> Map.put(acc, String.to_existing_atom(k), v)
    :error   -> acc
  end
end)
# %{age: "36", name: "Ada"}   — is_admin was dropped ✓`,
    },
  ],
};
