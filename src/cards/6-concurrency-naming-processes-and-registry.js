export default {
  front:
    "PIDs change on every restart. How does the rest of your code find a process after its supervisor restarts it?",
  back: "By NAME. `name: __MODULE__` registers a process under an atom, globally on the node — perfect for singletons. For thousands of dynamic processes (one per user, one per game room) you use a **Registry**: `{:via, Registry, {MyReg, key}}` maps arbitrary terms to PIDs, is stored in ETS, is concurrent-read, and cleans itself up automatically when a process dies.",
  philosophy: {
    lead: "Restarts mean PIDs are ephemeral. Names are the stable address, and the Registry is how you address a million of them.",
    body: [
      "Atom names are the right tool for the handful of singleton processes in an app: your Repo, your PubSub, your rate limiter, a supervisor. Do not use them for dynamic entities — remember card 4, atoms are never garbage collected, so registering one atom per user is a slow memory leak and a security hazard.",
      "Registry solves that properly. Keys can be any term (a user id, a tuple, a string), lookups are lock-free reads from ETS across all cores, and when the process dies its entry vanishes without any cleanup code. `:unique` mode gives you a name lookup; `:duplicate` mode gives you a local pub/sub where many processes register under the same key and you dispatch to all of them.",
      "The `{:via, ...}` tuple is a general OTP convention: anywhere a name is expected, you can pass that tuple and OTP will use the given module to register and resolve. GenServer, Supervisor and DynamicSupervisor all accept it — which is exactly how you get one supervised process per user in card 45.",
    ],
    diagram: `flowchart TB
  subgraph single["SINGLETONS — an atom name, one per node"]
    direction TB
    s1["GenServer.start_link(Mod, arg, name: __MODULE__)<br/>GenServer.call(Mod, :req)   ← no PID needed anywhere ✓<br/>Process.whereis(Mod)        ← resolve to a PID if you must"]:::code
  end
  s1 --> dyn["MANY DYNAMIC PROCESSES — use a Registry<br/>{Registry, keys: :unique, name: Shop.Registry}   ← in your supervisor"]:::hot
  dyn --> via["def via(user_id), do: {:via, Registry, {Shop.Registry, {:session, user_id}}}<br/>GenServer.start_link(Session, id, name: via(user_id))<br/>GenServer.call(via(user_id), :get)"]:::code
  via --> r1
  subgraph table["Registry — ETS backed, concurrent, self-cleaning"]
    direction TB
    r1["{:session, 1} → a live pid"]:::ok
    r2["{:session, 2} → pid ✗ dies ⇒ the entry is removed automatically"]:::warn
    r3["{:session, 3} → a live pid"]:::ok
    r1 ~~~ r2 ~~~ r3
  end
  r3 --> kinds[":unique — one pid per key ⇒ addressing<br/>:duplicate — many pids per key ⇒ local pub/sub, dispatch to all"]:::hot
  kinds --> never["✗ NEVER String.to_atom('user_' &lt;&gt; id) as a process name<br/>atoms are never garbage collected — that is a leak and a DoS"]:::bad`,
    takeaway:
      "Atoms name singletons. Registry names multitudes, keyed by any term, self-cleaning.",
  },
  codeSamples: [
    {
      title: "Named singleton",
      note: "",
      code: `{:ok, _} = Agent.start_link(fn -> %{} end, name: Settings)

Agent.update(Settings, &Map.put(&1, :theme, "dark"))
Agent.get(Settings, & &1)
Process.whereis(Settings)
Process.registered() |> Enum.take(10)`,
    },
    {
      title: "A Registry of sessions",
      note: "This is the exact shape of per-user processes.",
      code: `{:ok, _} = Registry.start_link(keys: :unique, name: Shop.Registry)

defmodule Session do
  use Agent

  def via(user_id), do: {:via, Registry, {Shop.Registry, {:session, user_id}}}

  def start(user_id) do
    Agent.start_link(fn -> %{user_id: user_id, views: 0} end, name: via(user_id))
  end

  def visit(user_id), do: Agent.update(via(user_id), &%{&1 | views: &1.views + 1})
  def state(user_id),  do: Agent.get(via(user_id), & &1)
end

Session.start(1)
Session.start(2)
Session.visit(1); Session.visit(1)
Session.state(1)
Registry.lookup(Shop.Registry, {:session, 1})
Registry.count(Shop.Registry)`,
    },
    {
      title: "Self-cleaning",
      note: "Kill the process; the entry disappears with no cleanup code.",
      code: `[{pid, _}] = Registry.lookup(Shop.Registry, {:session, 2})
Process.exit(pid, :kill)
Process.sleep(50)
Registry.lookup(Shop.Registry, {:session, 2})    # []  ✓
Registry.count(Shop.Registry)`,
    },
    {
      title: "Duplicate keys = local pub/sub",
      note: "Phoenix.PubSub is built on this idea.",
      code: `{:ok, _} = Registry.start_link(keys: :duplicate, name: Shop.Events)

for i <- 1..3 do
  spawn(fn ->
    Registry.register(Shop.Events, "orders", %{worker: i})
    receive do msg -> IO.puts("worker #{i} got #{inspect(msg)}") end
  end)
end
Process.sleep(50)

Registry.dispatch(Shop.Events, "orders", fn entries ->
  for {pid, _meta} <- entries, do: send(pid, {:order_created, 42})
end)
Process.sleep(50)`,
    },
  ],
};
