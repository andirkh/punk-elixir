export default {
  front:
    "An order is paid in a controller. A websocket in another process, on another machine, must react. What connects them?",
  back: '`Phoenix.PubSub`: `broadcast(Shop.PubSub, "orders:42", {:order_paid, order})` and `subscribe(Shop.PubSub, "orders:42")`. Subscribers receive the message in `handle_info/2`. It is topic-based, process-oriented, and **cluster-aware** — with the PG2/pg adapter a broadcast reaches subscribers on every connected node with no extra code or infrastructure.',
  philosophy: {
    lead: "PubSub is how parts of your system stop knowing about each other, and it is the mechanism that makes Phoenix realtime features work across a cluster.",
    body: [
      "Structurally it is the duplicate-key Registry from card 38, generalised and made distributed. Subscribers register interest in a topic string; a broadcast walks the local subscribers and forwards to other nodes. Because the delivery mechanism is `send/2`, anything with a mailbox can subscribe — a GenServer, a Channel, a LiveView, a test process.",
      "The decoupling is the point. Your `Orders` context does not import your websocket code; it broadcasts a fact. Later you can add an analytics listener, an audit logger and a cache invalidator, and the context never changes. This is the difference between a system that gets harder to change and one that does not.",
      "Two practical notes. Design topic names as a hierarchy you can reason about — `orders:#{user_id}`, `room:#{room_id}`, `user:#{id}:notifications` — because authorisation happens at subscribe time and vague topics leak data. And remember delivery is best-effort in-memory: if a subscriber must never miss an event, persist it and let the subscriber catch up on reconnect.",
    ],
    diagram: `flowchart TB
  ctx["Orders context — knows NOTHING about its consumers<br/>broadcast(Shop.PubSub, 'orders:42', {:order_paid, order})"]:::hot
  ctx --> t1
  subgraph ps["Phoenix.PubSub — a topic → subscriber-pid table"]
    direction TB
    t1["topic 'orders:42' → [pid_a, pid_c]"]:::code
    t2["topic 'room:1' → [pid_b]"]:::code
    t1 ~~~ t2
  end
  t2 -->|local delivery via send/2| sub1["Channel<br/>handle_info"]:::ok
  t2 --> sub2["GenServer<br/>handle_info"]:::ok
  t2 --> sub3["LiveView or a test process<br/>handle_info"]:::ok
  t2 -.->|the adapter forwards to every OTHER node| node2["node 2"]:::warn
  sub3 --> api["subscribe(Shop.PubSub, 'orders:42')   ← in init, or on channel join<br/>broadcast(Shop.PubSub, topic, message)  ← from anywhere<br/>broadcast_from(pubsub, self(), topic, msg) ← skip the sender<br/>local_broadcast/3                       ← this node only"]:::code
  api --> topics["TOPIC DESIGN IS AN AUTHORISATION SURFACE<br/>✓ 'orders:' &lt;&gt; user_id · 'room:' &lt;&gt; room_id<br/>✗ 'orders' — everyone sees everyone<br/>check permission at SUBSCRIBE time"]:::warn
  topics --> caveat["⚠ in-memory and best effort.<br/>Must-not-miss events ⇒ persist them and let clients catch up."]:::bad`,
    takeaway:
      "Broadcast facts to topics; anything with a mailbox can subscribe, on any node.",
  },
  codeSamples: [
    {
      title: "Try it in iex",
      note: 'Works in plain iex if you add {:phoenix_pubsub, "~> 2.1"}.',
      code: `{:ok, _} = Phoenix.PubSub.Supervisor.start_link(name: Demo.PubSub)

Phoenix.PubSub.subscribe(Demo.PubSub, "orders:42")
Phoenix.PubSub.broadcast(Demo.PubSub, "orders:42", {:order_paid, %{id: 1}})
flush()

# a second subscriber in another process
parent = self()
spawn(fn ->
  Phoenix.PubSub.subscribe(Demo.PubSub, "orders:42")
  receive do msg -> send(parent, {:child_got, msg}) end
end)
Process.sleep(50)
Phoenix.PubSub.broadcast(Demo.PubSub, "orders:42", {:order_paid, %{id: 2}})
flush()`,
    },
    {
      title: "A GenServer that reacts to domain events",
      note: "Add listeners without touching the publisher.",
      code: `defmodule Shop.AuditLog do
  use GenServer
  require Logger

  def start_link(_), do: GenServer.start_link(__MODULE__, [], name: __MODULE__)
  def entries, do: GenServer.call(__MODULE__, :entries)

  @impl true
  def init(_) do
    Phoenix.PubSub.subscribe(Demo.PubSub, "orders:42")
    {:ok, []}
  end

  @impl true
  def handle_info({:order_paid, order}, entries) do
    Logger.info("AUDIT order #{order.id} paid")
    {:noreply, [{:paid, order.id, System.system_time(:second)} | entries]}
  end
  def handle_info(_other, state), do: {:noreply, state}

  @impl true
  def handle_call(:entries, _from, entries), do: {:reply, entries, entries}
end

{:ok, _} = Shop.AuditLog.start_link(nil)
Phoenix.PubSub.broadcast(Demo.PubSub, "orders:42", {:order_paid, %{id: 99}})
Process.sleep(50)
Shop.AuditLog.entries()`,
    },
    {
      title: "Broadcast from a context",
      note: "The idiomatic wrapper that keeps callers clean.",
      code: `defmodule Shop.Events do
  @pubsub Shop.PubSub

  def subscribe(topic), do: Phoenix.PubSub.subscribe(@pubsub, topic)
  def unsubscribe(topic), do: Phoenix.PubSub.unsubscribe(@pubsub, topic)

  def broadcast({:ok, %{} = record} = ok, topic_fun, event) when is_function(topic_fun, 1) do
    Phoenix.PubSub.broadcast(@pubsub, topic_fun.(record), {event, record})
    ok
  end
  def broadcast({:error, _} = err, _topic_fun, _event), do: err
end

# used in a context pipeline:
# %Order{}
# |> Order.changeset(attrs)
# |> Repo.insert()
# |> Shop.Events.broadcast(&"orders:#{&1.user_id}", :order_created)`,
    },
    {
      title: "Testing pubsub",
      note: "The test process subscribes and asserts.",
      code: `defmodule Shop.EventsTest do
  use ExUnit.Case, async: true

  setup do
    start_supervised!({Phoenix.PubSub, name: Test.PubSub})
    :ok
  end

  test "broadcast reaches the subscriber" do
    Phoenix.PubSub.subscribe(Test.PubSub, "orders:1")
    Phoenix.PubSub.broadcast(Test.PubSub, "orders:1", {:order_created, %{id: 7}})
    assert_receive {:order_created, %{id: 7}}, 500
  end
end`,
    },
  ],
};
