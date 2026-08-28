export default {
  front:
    "Your JSON parser hits malformed input from one client. Should you wrap it in try/rescue?",
  back: "Usually no. Let that request's process crash. It affects only that one client, the supervisor restarts a clean process, the error is logged with a full stack trace, and your code stays free of defensive noise. You write the happy path; the runtime handles the rest. You DO handle errors you can meaningfully act on — retryable timeouts, validation failures shown to the user.",
  philosophy: {
    lead: "This is a philosophy, not a shortcut, and it only works because of everything in the last four cards: isolation, links, trapping, and cheap restarts.",
    body: [
      "Joe Armstrong's argument was that defensive programming multiplies the states your code can be in. Every `if result != nil` creates a branch that must itself be correct, and after enough of them nobody can reason about the system. Meanwhile the true cause of most production bugs is unexpected state — precisely the thing your defensive code is trying to limp through.",
      "The alternative is to make the failure region tiny and the recovery automatic. A crash resets the process to a known-good initial state. This is the software equivalent of turning it off and on again, applied at a granularity of one user, one request, one connection — hundreds of times a second if necessary, with nobody noticing.",
      "The discipline that makes it work: keep dangerous work in a process that owns nothing important, keep durable state elsewhere (the database, ETS, a supervised process that does not do risky work), and make `init` cheap so restarts are fast. Crash for bugs; return tagged tuples for expected domain outcomes (card 23).",
    ],
    diagram: `flowchart TB
  subgraph styles["two ways to meet bad input"]
    direction LR
    def0["DEFENSIVE<br/>if valid?(input) do<br/>  case parse(input) do<br/>    {:ok, v} -&gt; if v.id != nil do … 3 more levels …<br/><br/>every branch is a new state<br/>nobody can reason about it"]:::bad
    crash["LET IT CRASH<br/>def handle(input) do<br/>  %{'id' =&gt; id} = input   ← match, or crash<br/>  process(id)<br/>end<br/><br/>1 user affected · 0 lines of handling<br/>a full stack trace in the logs"]:::ok
  end
  styles --> sup["Supervisor<br/>restart strategy + limits"]:::hot
  sup --> c1["conn1<br/>unaffected"]:::ok
  sup --> c2["conn2 ✗ crashes<br/>↻ restarted with FRESH state"]:::warn
  sup --> c3["conn3<br/>unaffected"]:::ok
  c2 --> know["users 1 and 3 never knew"]:::ok
  know --> when0["CRASH FOR — bugs, impossible state, broken invariants, bad config<br/>HANDLE — timeouts you retry, validation you show the user,<br/>404s, business rules. These are DATA, not crashes."]:::warn`,
    takeaway:
      "Shrink the blast radius and automate recovery instead of defending every line.",
  },
  codeSamples: [
    {
      title: "Defensive vs. matching",
      note: "Both are correct; the second is idiomatic and shorter.",
      code: `defensive = fn payload ->
  if is_map(payload) do
    case Map.fetch(payload, "user") do
      {:ok, user} when is_map(user) ->
        case Map.fetch(user, "id") do
          {:ok, id} when is_integer(id) -> {:ok, id}
          _ -> {:error, :bad_id}
        end
      _ -> {:error, :bad_user}
    end
  else
    {:error, :not_a_map}
  end
end

crashy = fn %{"user" => %{"id" => id}} when is_integer(id) -> id end

defensive.(%{"user" => %{"id" => 1}})
crashy.(%{"user" => %{"id" => 1}})
# crashy.(%{"user" => %{}})   # FunctionClauseError — loud, precise, local`,
    },
    {
      title: "Watch isolation in action",
      note: "One worker in ten explodes; the other nine finish.",
      code: `parent = self()

for i <- 1..10 do
  spawn(fn ->
    if i == 4, do: raise("worker #{i} exploded")
    send(parent, {:ok, i})
  end)
end

Process.sleep(300)
results = for _ <- 1..9, do: (receive do {:ok, i} -> i after 100 -> nil end)
Enum.sort(results)     # 1,2,3,5,6,7,8,9,10 — the system kept working ✓`,
    },
    {
      title: "Restart cost is trivial",
      note: "How fast is 'turn it off and on again' at this granularity?",
      code: `{micros, _} = :timer.tc(fn ->
  for _ <- 1..10_000 do
    pid = spawn(fn -> Process.sleep(:infinity) end)
    Process.exit(pid, :kill)
    spawn(fn -> Process.sleep(:infinity) end)
  end
end)

IO.puts("10k crash+restart cycles in #{Float.round(micros / 1000, 1)} ms")`,
    },
    {
      title: "Where NOT to let it crash",
      note: "Expected domain outcomes stay as data.",
      code: `defmodule Orders do
  # domain outcome -> data
  def find(id) when is_integer(id) and id > 0 do
    case id do
      1 -> {:ok, %{id: 1, total: 500}}
      _ -> {:error, :not_found}
    end
  end
  # programmer error -> crash (no clause for a string id)
end

Orders.find(1)
Orders.find(99)
# Orders.find("1")   # FunctionClauseError — a bug in the CALLER`,
    },
  ],
};
