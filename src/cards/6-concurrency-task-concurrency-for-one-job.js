export default {
  front:
    "A request needs data from three slow APIs. How do you fetch them in parallel and collect all three results?",
  back: "`Task.async/1` for each, then `Task.await/2` on the list — or `Task.async_stream/3` when you have many items and want bounded concurrency. A Task is a process that computes one value and sends it back. It is linked and monitored for you, so failures propagate correctly instead of hanging forever.",
  philosophy: {
    lead: "Task is the smallest useful abstraction over spawn: one process, one result, correct failure semantics.",
    body: [
      "The critical detail is `async_stream`. Naively spawning one Task per item in a list of 100,000 will melt your database connection pool or the API you are calling. `Task.async_stream/3` takes `max_concurrency` and processes lazily, giving you a controlled parallel map with backpressure. That is the function you will actually reach for in production, combined with `Stream` from card 18.",
      "Use `Task.Supervisor` for fire-and-forget work. A bare `Task.start/1` is unsupervised and invisible; `Task.Supervisor.start_child/2` puts it under a supervisor so it is counted, traceable and shut down cleanly on deploy. `async_nolink` additionally means a crashing task does not take your caller down — essential inside a web request or a GenServer.",
      "Rule of thumb: Task for a computation with an end. GenServer for something that lives. Do not use a Task to hold state.",
    ],
    diagram: `flowchart TB
  subgraph one["Task — concurrency for ONE job"]
    direction LR
    ta["Task.async"]:::hot -->|spawn_link + monitor| work["compute"]:::hot -->|sends the result back| aw["Task.await(task, 5_000)<br/>raises on timeout or crash — which is what you want"]:::ok
  end
  one --> cmp
  subgraph cmp["three API calls"]
    direction TB
    seq["SEQUENTIAL<br/>a = api_a()  300ms<br/>b = api_b()  400ms<br/>c = api_c()  200ms<br/>total = 900ms"]:::bad
    con["CONCURRENT<br/>ta = Task.async(&amp;api_a/0)<br/>tb = Task.async(&amp;api_b/0)<br/>tc = Task.async(&amp;api_c/0)<br/>[a,b,c] = Task.await_many([ta,tb,tc])<br/>total = 400ms ✓"]:::ok
  end
  cmp --> many["MANY ITEMS — bound the concurrency or you WILL melt something<br/>items<br/>¦&gt; Task.async_stream(&amp;work/1, max_concurrency: 20, timeout: 5_000,<br/>                     on_timeout: :kill_task, ordered: false)<br/>¦&gt; Enum.reduce(...)   ⇒ [{:ok, r} ¦ {:exit, reason}]"]:::code
  many --> fnf["FIRE AND FORGET, supervised<br/>Task.Supervisor.start_child(MyApp.TaskSup, fn -&gt; send_email() end)<br/>Task.Supervisor.async_nolink(...)   ← the caller survives a task crash"]:::warn`,
    takeaway:
      "Task = one process, one result. async_stream with max_concurrency is the production workhorse.",
  },
  codeSamples: [
    {
      title: "Three slow calls, in parallel",
      note: "",
      code: `slow = fn name, ms -> fn -> Process.sleep(ms); {name, ms} end end

{time, results} = :timer.tc(fn ->
  [
    Task.async(slow.(:users, 300)),
    Task.async(slow.(:orders, 400)),
    Task.async(slow.(:prices, 200))
  ]
  |> Task.await_many(5_000)
end)

{div(time, 1000), results}     # ~400ms total, not 900`,
    },
    {
      title: "async_stream — bounded parallel map",
      note: "The one you will use most.",
      code: `1..50
|> Task.async_stream(
     fn i -> Process.sleep(100); i * i end,
     max_concurrency: 10,
     timeout: 5_000,
     on_timeout: :kill_task,
     ordered: false
   )
|> Enum.reduce({[], []}, fn
     {:ok, v}, {oks, errs}    -> {[v | oks], errs}
     {:exit, r}, {oks, errs}  -> {oks, [r | errs]}
   end)`,
    },
    {
      title: "Handling failure honestly",
      note: "await raises; yield lets you decide.",
      code: `t = Task.async(fn -> Process.sleep(5_000); :never end)

case Task.yield(t, 300) || Task.shutdown(t, :brutal_kill) do
  {:ok, result} -> {:done, result}
  {:exit, reason} -> {:crashed, reason}
  nil -> {:too_slow, :gave_up}
end

crash = Task.async(fn -> raise "nope" end)
try do
  Task.await(crash)
rescue
  e -> {:rescued, Exception.message(e)}
catch
  :exit, reason -> {:exited, reason}
end`,
    },
    {
      title: "Supervised, fire-and-forget",
      note: "Add the supervisor to your application tree (card 46).",
      code: `{:ok, sup} = Task.Supervisor.start_link(name: Shop.TaskSupervisor)

Task.Supervisor.start_child(Shop.TaskSupervisor, fn ->
  Process.sleep(100)
  IO.puts("email sent in the background")
end)

# a crash here will NOT kill the caller:
task = Task.Supervisor.async_nolink(Shop.TaskSupervisor, fn -> raise "boom" end)
receive do
  {:DOWN, _ref, :process, _pid, reason} -> {:task_failed, elem(reason, 0)}
after
  1_000 -> :nothing
end`,
    },
  ],
};
