export default {
  front:
    "Two BEAM nodes connect. What suddenly becomes possible that would need Kafka or gRPC elsewhere?",
  back: 'Transparent message passing. `send({:name, :"b@host"}, msg)` and `GenServer.call({Worker, node}, :req)` work exactly like local calls — the VM handles serialisation and transport. That is why `Phoenix.PubSub`, `Presence` and `:global` work cluster-wide with no extra infrastructure. In production, `libcluster` forms the cluster automatically from DNS, Kubernetes or gossip.',
  philosophy: {
    lead: "Distribution is built into the runtime rather than bolted on, which makes small clusters almost free — and makes it important to know the limits.",
    body: [
      "What you get cheaply: PubSub across nodes, Presence as a CRDT, `Node.spawn/2` to run a function elsewhere, `:erpc` for remote calls, and a cluster-wide process registry via `:global` or Horde. For a realtime app spread across three to twenty nodes, this removes an entire category of infrastructure.",
      "What you must not assume: the network is not reliable, and BEAM distribution is not magic. A netsplit gives you two halves that each think the other died; when they heal, you need a merge strategy. `:global` is a single-registry design that does not partition well. Distributed Erlang is also fully-meshed, so it does not scale to hundreds of nodes without `hidden` nodes or a different topology. And by default the cluster trusts itself completely — a shared cookie is the only authentication, so distribution must run on a private network, with TLS distribution if it crosses anything else.",
      "The pragmatic position most teams land on: use clustering for realtime fan-out (PubSub, Presence) and keep durable state in Postgres. Do not build a distributed database out of GenServers unless that is genuinely your product.",
    ],
    diagram: `flowchart TB
  subgraph nodes["iex --sname a --cookie secret   ·   iex --sname b --cookie secret"]
    direction LR
    na["node a"]:::hot <-->|"Node.connect · fully meshed"| nb["node b"]:::hot
  end
  nodes --> works["NOW THESE JUST WORK<br/>Node.list()                        send({:worker, node}, msg)<br/>:rpc.call(node, Mod, :fun, args)   GenServer.call({Mod, node}, :req)<br/>Node.spawn(node, fun)              :erpc.call(node, fun)<br/>Phoenix.PubSub broadcast — cluster-wide, automatically ✓<br/>Phoenix.Presence — CRDT merge across nodes ✓"]:::ok
  works --> auto["AUTOMATIC FORMATION — libcluster<br/>config :libcluster, topologies: [<br/>  k8s: [strategy: Cluster.Strategy.Kubernetes.DNS,<br/>        config: [service: 'shop-headless', application_name: 'shop']]<br/>]"]:::code
  auto --> l1
  subgraph limits["THE LIMITS — know these BEFORE you rely on it"]
    direction TB
    l1["netsplit — both halves think the other died. Plan the merge."]:::bad
    l2[":global — a single registry, and it partitions badly"]:::bad
    l3["mesh — N² connections. Not for hundreds of nodes."]:::bad
    l4["security — a shared COOKIE is the WHOLE auth model.<br/>Private network only, or TLS distribution."]:::bad
    l5["state — durable data belongs in Postgres, not in a cluster of GenServers"]:::bad
    l1 ~~~ l2 ~~~ l3 ~~~ l4 ~~~ l5
  end`,
    takeaway:
      "Nodes pass messages transparently — great for realtime fan-out, not a substitute for a database.",
  },
  codeSamples: [
    {
      title: "Cluster two shells on your Mac",
      note: "Open two terminals and run one command in each.",
      code: `# terminal 1:
iex --sname a --cookie devcookie

# terminal 2:
iex --sname b --cookie devcookie

# then, in terminal 1 (replace 'yourmac' with the name shown in your prompt):
Node.self()
Node.connect(:"b@yourmac")
Node.list()

# run code on the OTHER node:
Node.spawn(:"b@yourmac", fn -> IO.puts("hello from #{inspect(Node.self())}") end)
:erpc.call(:"b@yourmac", fn -> :erlang.system_info(:process_count) end)
:rpc.call(:"b@yourmac", System, :cmd, ["hostname", []])`,
    },
    {
      title: "A GenServer called from another node",
      note: "Start this in node b, call it from node a.",
      code: `# --- in node b ---
defmodule Remote do
  use GenServer
  def start_link(_), do: GenServer.start_link(__MODULE__, 0, name: __MODULE__)
  @impl true
  def init(s), do: {:ok, s}
  @impl true
  def handle_call(:where, _from, s), do: {:reply, {Node.self(), s}, s + 1}
end

{:ok, _} = Remote.start_link(nil)

# --- in node a (paste the module there too so it compiles) ---
GenServer.call({Remote, :"b@yourmac"}, :where)
# {:"b@yourmac", 0}   ← ran on the other machine, same API ✓

send({Remote, :"b@yourmac"}, :hello)`,
    },
    {
      title: "Cluster-wide PubSub and monitoring",
      note: "This is what makes multi-node Phoenix realtime work.",
      code: `# both nodes:
{:ok, _} = Phoenix.PubSub.Supervisor.start_link(name: Demo.PubSub)

# node a:
Phoenix.PubSub.subscribe(Demo.PubSub, "global")

# node b:
Phoenix.PubSub.broadcast(Demo.PubSub, "global", {:hello, Node.self()})

# node a:
flush()      # the message crossed the network with no extra code ✓

# watch nodes come and go:
:net_kernel.monitor_nodes(true)
# now stop node b and:
flush()      # {:nodedown, :"b@yourmac"}`,
    },
    {
      title: "libcluster in production",
      note: "Add to deps and to your supervision tree.",
      code: `# mix.exs: {:libcluster, "~> 3.3"}

# config/runtime.exs
config :libcluster,
  topologies: [
    k8s: [
      strategy: Elixir.Cluster.Strategy.Kubernetes.DNS,
      config: [
        service: "shop-headless",
        application_name: "shop",
        polling_interval: 5_000
      ]
    ]
  ]

# lib/shop/application.ex — FIRST child, before PubSub
def start(_type, _args) do
  topologies = Application.get_env(:libcluster, :topologies) || []

  children = [
    {Cluster.Supervisor, [topologies, [name: Shop.ClusterSupervisor]]},
    Shop.Repo,
    {Phoenix.PubSub, name: Shop.PubSub},
    ShopWeb.Presence,
    ShopWeb.Endpoint
  ]

  Supervisor.start_link(children, strategy: :one_for_one, name: Shop.Supervisor)
end

# also needed for nodes to find each other in a release:
# rel/env.sh.eex
#   export RELEASE_DISTRIBUTION=name
#   export RELEASE_NODE="shop@$(hostname -i)"`,
    },
  ],
};
