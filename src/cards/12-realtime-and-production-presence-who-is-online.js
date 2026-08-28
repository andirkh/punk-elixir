export default {
  front:
    "Show which users are in a chat room, across three servers, with correct cleanup when a laptop lid closes. Why is a database table the wrong answer?",
  back: "Because presence is ephemeral, high-churn, and must survive netsplits without a coordinator. `Phoenix.Presence` uses a **CRDT** replicated over PubSub: each node tracks its own processes, gossips its state, and merges without conflicts. Entries vanish automatically when the tracked process dies — no cleanup job, no stale rows, no single point of failure.",
  philosophy: {
    lead: "Presence is the clearest example of using process lifecycles as the source of truth instead of a database.",
    body: [
      "The insight is that a websocket connection already IS the fact you are trying to store. Rather than writing 'online' on connect and hoping to write 'offline' on disconnect — which fails whenever a process crashes, a node dies, or a laptop sleeps — Presence tracks the process itself. When the process ends, for any reason, the entry disappears. Correctness comes from the runtime, not from your cleanup code.",
      "The CRDT (a conflict-free replicated data type, specifically an ORSWOT) is what makes it work across nodes with no leader. Each node can accept writes independently and merges are deterministic, so a network partition heals cleanly instead of requiring a consensus protocol. That is a serious distributed-systems property you get from a two-line module.",
      "The API shape to remember: `track/3` registers this process under a key with metadata, `list/1` returns everyone on the topic grouped by key with a list of metas (one per device — the same user on phone and laptop appears once with two metas), and channels receive `presence_diff` events containing joins and leaves so clients update incrementally instead of re-fetching.",
    ],
    diagram: `flowchart TB
  subgraph cluster["Presence is a CRDT — no leader, no conflicts"]
    direction LR
    n1["NODE 1<br/>user 1 ●<br/>user 2 ●"]:::hot
    n2["NODE 2<br/>user 3 ●<br/>user 4 ●"]:::hot
    n3["NODE 3<br/>user 5 ●<br/>user 1 ●"]:::hot
    n1 <-->|gossip| n2 <-->|gossip| n3
  end
  cluster --> track["track(socket, 'user:1', %{online_at: …, device: 'laptop'})"]:::code
  track --> tied["the entry is tied to the CHANNEL PROCESS.<br/>The process dies ⇒ the entry is gone ✓<br/>crash, deploy, closed laptop, network drop — all the same thing."]:::ok
  tied --> lst["Presence.list('room:lobby') ⇒<br/>%{'user:1' =&gt; %{metas: [%{phone: …}, %{laptop: …}]},   ← 2 devices<br/>  'user:2' =&gt; %{metas: [%{...}]}}                      ← 1 device"]:::code
  lst --> diffs["THE CLIENT GETS INCREMENTAL DIFFS, not full lists<br/>'presence_state' once on join, then 'presence_diff' %{joins: …, leaves: …}"]:::hot
  diffs --> w1
  subgraph why["WHY NOT A DATABASE TABLE"]
    direction TB
    w1["✗ needs a cleanup job for crashed or partitioned connections"]:::bad
    w2["✗ write amplification on every connect and disconnect"]:::bad
    w3["✗ stale rows are indistinguishable from real ones"]:::bad
    w4["✓ Presence: the truth IS the process, and cleanup is automatic"]:::ok
    w1 ~~~ w2 ~~~ w3 ~~~ w4
  end`,
    takeaway:
      "Track the process, not a row. CRDT replication makes it correct across nodes with no coordinator.",
  },
  codeSamples: [
    {
      title: "Define the Presence module",
      note: "lib/shop_web/presence.ex — two lines plus config.",
      code: `defmodule ShopWeb.Presence do
  use Phoenix.Presence,
    otp_app: :shop,
    pubsub_server: Shop.PubSub
end

# lib/shop/application.ex children, AFTER the PubSub:
#   {Phoenix.PubSub, name: Shop.PubSub},
#   ShopWeb.Presence,`,
    },
    {
      title: "Track in a channel",
      note: "The whole feature, server side.",
      code: `defmodule ShopWeb.RoomChannel do
  use ShopWeb, :channel
  alias ShopWeb.Presence

  @impl true
  def join("room:" <> room_id, params, socket) do
    send(self(), :after_join)
    {:ok, socket |> assign(:room_id, room_id) |> assign(:device, params["device"] || "web")}
  end

  @impl true
  def handle_info(:after_join, socket) do
    user_id = socket.assigns.current_user_id

    {:ok, _ref} =
      Presence.track(socket, "user:#{user_id}", %{
        online_at: System.system_time(:second),
        device: socket.assigns.device,
        node: to_string(node())
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  def handle_info(_, socket), do: {:noreply, socket}

  @impl true
  def handle_in("set_status", %{"status" => status}, socket) do
    user_id = socket.assigns.current_user_id
    Presence.update(socket, "user:#{user_id}", fn meta -> Map.put(meta, :status, status) end)
    {:reply, :ok, socket}
  end
end`,
    },
    {
      title: "Read presence from anywhere",
      note: "Works in iex, in a controller, in a job.",
      code: `# who is in the room right now, across the whole cluster:
ShopWeb.Presence.list("room:lobby")

# count unique users (not connections)
ShopWeb.Presence.list("room:lobby") |> map_size()

# count connections (a user with 2 devices counts twice)
ShopWeb.Presence.list("room:lobby")
|> Enum.map(fn {_key, %{metas: metas}} -> length(metas) end)
|> Enum.sum()

# is a specific user online?
ShopWeb.Presence.list("room:lobby") |> Map.has_key?("user:42")

# from a controller:
# def online(conn, %{"room" => room}) do
#   json(conn, %{online: Map.keys(ShopWeb.Presence.list("room:" <> room))})
# end`,
    },
    {
      title: "The client side",
      note: "Phoenix's JS helper handles diffs for you.",
      code: `import {Socket, Presence} from "phoenix"

const socket = new Socket("/socket", {params: {token: window.userToken}})
socket.connect()

const channel = socket.channel("room:lobby", {device: "laptop"})
let presences = {}

channel.on("presence_state", state => {
  presences = Presence.syncState(presences, state)
  render()
})

channel.on("presence_diff", diff => {
  presences = Presence.syncDiff(presences, diff)
  render()
})

function render() {
  const list = Presence.list(presences, (id, {metas: [first, ...rest]}) => ({
    id,
    devices: rest.length + 1,
    online_at: first.online_at
  }))
  console.log(\`\${list.length} users online\`, list)
}

channel.join()`,
    },
  ],
};
