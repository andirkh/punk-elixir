export default {
  front:
    "Given `%{user: %{name: name, roles: [primary | _]}} = payload`, what did you just extract in one line?",
  back: "Both the user's name AND their first role, while simultaneously asserting that `payload` has a `:user` key, that the user has `:name` and `:roles`, and that `roles` is a non-empty list. One line, one shape, many guarantees. Map patterns are **partial** — extra keys are allowed and ignored — while list and tuple patterns are exact.",
  philosophy: {
    lead: "Real payloads are nested. Pattern matching lets you reach into them declaratively, describing the shape you need instead of navigating it step by step.",
    body: [
      "Notice the asymmetry, because it is deliberate. A map pattern says 'this map must contain at least these keys'. That makes it perfect for JSON payloads, options and structs, where new fields appear over time and old code should keep working. A tuple pattern says 'exactly this many elements'; a list pattern with `[a, b]` means exactly two.",
      "This is Elixir's answer to the endless `payload && payload.user && payload.user.roles && payload.user.roles[0]` dance. You write the shape you require. If reality disagrees, you find out immediately and precisely.",
      "Everywhere you go next — parsing HTTP params, reading a database row, handling a websocket frame — this exact skill is what you will use.",
    ],
    diagram: `flowchart TB
  payload["payload = %{<br/>  user: %{name: 'Ada', roles: ['admin','dev'], email: 'a@b.c'},<br/>  meta: %{ip: '1.2.3.4'}<br/>}"]:::code
  payload --> pat["%{user: %{name: name, roles: [primary ¦ rest]}} = payload"]:::hot
  pat --> n1["name = 'Ada'"]:::ok
  pat --> n2["primary = 'admin'"]:::ok
  pat --> n3["rest = ['dev']"]:::ok
  pat --> n4[":meta and :email are simply ignored"]:::muted
  rules["MAPS %{a: 1} — partial, matches ANY map containing :a ✓ open<br/>TUPLES {a, b} — exact, must be exactly 2 elements ✗ closed<br/>LISTS [a, b] — exact 2 · [a ¦ rest] — one or more"]:::code
  n4 ~~~ rules`,
    takeaway:
      "Describe the shape you need. Maps are open, tuples and lists are exact.",
  },
  codeSamples: [
    {
      title: "Reach in deep",
      note: "",
      code: `payload = %{
  user: %{name: "Ada", roles: ["admin", "dev"], email: "a@b.c"},
  meta: %{ip: "1.2.3.4"}
}

%{user: %{name: name, roles: [primary | rest]}} = payload
name; primary; rest`,
    },
    {
      title: "Open vs closed",
      note: "",
      code: `%{a: x} = %{a: 1, b: 2, c: 3}    # ok, maps are partial
x

# [a, b] = [1, 2, 3]             # MatchError — lists are exact
[a, b | rest] = [1, 2, 3, 4]     # ok
rest                             # [3, 4]`,
    },
    {
      title: "Real-world: HTTP params",
      note: "Exactly how you will read Phoenix params later.",
      code: `params = %{"page" => %{"size" => 25, "num" => 2}, "q" => "elixir"}

%{"page" => %{"size" => size}, "q" => q} = params
{size, q}

# string keys and atom keys are DIFFERENT keys — a classic first bug
%{"q" => _} = params      # ok
# %{q: _} = params        # MatchError`,
    },
  ],
};
