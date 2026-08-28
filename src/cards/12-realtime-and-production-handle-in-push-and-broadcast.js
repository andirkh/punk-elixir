export default {
  front:
    "A client sends a chat message. Trace the path from `handle_in/3` to every other connected client — including those on a different server.",
  back: '`handle_in("new_msg", payload, socket)` runs in that client\'s channel process. It calls a context function to persist, then `broadcast!/3` publishes to the topic via `Phoenix.PubSub` — which forwards to every node in the cluster. Each subscribed channel process receives it and pushes down its own websocket. Reply to the sender with `{:reply, {:ok, map}, socket}`; use `{:noreply, socket}` for fire-and-forget.',
  philosophy: {
    lead: "handle_in is the server's request handler for websocket messages, and the reply tuple is the websocket equivalent of an HTTP status code.",
    body: [
      'The reply mechanism is easy to overlook and very useful: the JS client\'s `channel.push(...).receive("ok", ...)` maps directly onto your `{:reply, {:ok, payload}, socket}`. That gives you request/response semantics over a websocket, with per-message acknowledgement — which is what you want for anything the user needs confirmation of.',
      "`broadcast!/3` goes through PubSub, so it crosses nodes automatically; `push/3` goes to this one client only; `broadcast_from!/4` skips the sender, which is the right choice when the sender already rendered the message optimistically. Choosing correctly is most of what channel code is.",
      "Two production habits. First, validate and authorise in `handle_in` — a websocket message is untrusted input exactly like an HTTP body, and the channel's assigns are the only identity you should trust. Second, rate-limit per socket: a channel is a process, so a counter in `socket.assigns` with a timestamp is a complete, correct rate limiter with no shared state.",
    ],
    diagram: `sequenceDiagram
    autonumber
    participant A as client A
    participant RA as RoomChannel<br/>process for A
    participant PS as PubSub<br/>(cluster-wide)
    participant RB as Channel for B
    participant N2 as Channel on NODE 2
    A->>RA: channel.push("new_msg",<br/>%{body: "hi"})
    Note over RA: handle_in("new_msg", payload, socket)<br/>1. authorise + validate<br/>2. Chat.create_message(...)<br/>— PERSIST FIRST<br/>3. broadcast!(socket, "new_msg", m)
    RA-->>A: {:reply, {:ok, %{id: m.id}}, socket}<br/>an ack
    RA->>PS: broadcast!
    PS->>RB: handle_info → push
    PS->>N2: handle_info → push
    Note over RA,N2: REPLY SHAPES<br/>{:reply, {:ok, map}, socket}<br/>{:reply, {:error, map}, socket}<br/>{:noreply, socket} · {:stop, reason, socket}
    Note over RA,N2: WHO RECEIVES IT<br/>push/3 — this client only<br/>broadcast!/3 — everyone on the topic<br/>broadcast_from!/4 — everyone but the sender<br/>Endpoint.broadcast/3 — from anywhere
    Note over RA: ⚠ handle_in payloads are UNTRUSTED.<br/>Validate them. Trust only socket.assigns.<br/>⚠ rate-limit per socket — the channel<br/>process is the perfect place.`,
    takeaway:
      "Persist, then broadcast, then reply. push is one client, broadcast is the whole topic across the cluster.",
  },
  codeSamples: [
    {
      title: "A complete chat channel",
      note: "Validation, authorisation, rate limiting, broadcast, reply.",
      code: `defmodule ShopWeb.RoomChannel do
  use ShopWeb, :channel
  alias Shop.Chat

  @max_per_10s 10

  @impl true
  def join("room:" <> room_id, _params, socket) do
    {:ok, socket |> assign(:room_id, room_id) |> assign(:sent, [])}
  end

  @impl true
  def handle_in("new_msg", %{"body" => body}, socket) when is_binary(body) do
    with :ok <- check_rate(socket),
         :ok <- validate(body),
         {:ok, msg} <- Chat.create_message(socket.assigns.current_user_id,
                                           socket.assigns.room_id, body) do
      broadcast!(socket, "new_msg", %{
        id: msg.id, body: msg.body, user_id: msg.user_id, at: msg.inserted_at
      })

      {:reply, {:ok, %{id: msg.id}}, record_send(socket)}
    else
      {:error, reason} -> {:reply, {:error, %{reason: to_string(reason)}}, socket}
    end
  end

  # typing indicators: no persistence, no ack, skip the sender
  def handle_in("typing", _payload, socket) do
    broadcast_from!(socket, "typing", %{user_id: socket.assigns.current_user_id})
    {:noreply, socket}
  end

  def handle_in(event, _payload, socket) do
    {:reply, {:error, %{reason: "unknown event: #{event}"}}, socket}
  end

  defp validate(body) do
    cond do
      String.trim(body) == "" -> {:error, :empty}
      String.length(body) > 2_000 -> {:error, :too_long}
      true -> :ok
    end
  end

  defp check_rate(socket) do
    cutoff = System.monotonic_time(:millisecond) - 10_000
    recent = Enum.count(socket.assigns.sent, &(&1 > cutoff))
    if recent < @max_per_10s, do: :ok, else: {:error, :rate_limited}
  end

  defp record_send(socket) do
    now = System.monotonic_time(:millisecond)
    cutoff = now - 10_000
    assign(socket, :sent, [now | Enum.filter(socket.assigns.sent, &(&1 > cutoff))])
  end
end`,
    },
    {
      title: "Broadcast from outside a channel",
      note: "Your context does not need to know channels exist.",
      code: `# from anywhere — a controller, a GenServer, a background job, iex:
ShopWeb.Endpoint.broadcast("room:lobby", "new_msg", %{body: "server announcement"})

# or via the domain event pattern from card 53:
Phoenix.PubSub.broadcast(Shop.PubSub, "orders:42", {:order_paid, order})

# and in the channel that cares:
# def handle_info({:order_paid, order}, socket) do
#   push(socket, "order_paid", %{id: order.id})
#   {:noreply, socket}
# end

# intercept lets a channel transform an outgoing broadcast per-client:
# intercept ["new_msg"]
# def handle_out("new_msg", msg, socket) do
#   if Shop.Chat.blocked?(socket.assigns.current_user_id, msg.user_id) do
#     {:noreply, socket}                 # silently drop for this client
#   else
#     push(socket, "new_msg", msg)
#     {:noreply, socket}
#   end
# end`,
    },
    {
      title: "Testing channels",
      note: "No browser required. This is why channels are testable.",
      code: `defmodule ShopWeb.RoomChannelTest do
  use ShopWeb.ChannelCase, async: true

  setup do
    {:ok, _, socket} =
      ShopWeb.UserSocket
      |> socket("user_id", %{current_user_id: 1})
      |> subscribe_and_join(ShopWeb.RoomChannel, "room:lobby")

    {:ok, socket: socket}
  end

  test "broadcasts and acks a valid message", %{socket: socket} do
    ref = push(socket, "new_msg", %{"body" => "hello"})
    assert_reply ref, :ok, %{id: _}
    assert_broadcast "new_msg", %{body: "hello"}
  end

  test "rejects an empty message", %{socket: socket} do
    ref = push(socket, "new_msg", %{"body" => "   "})
    assert_reply ref, :error, %{reason: "empty"}
  end

  test "rate limits", %{socket: socket} do
    for _ <- 1..10, do: push(socket, "new_msg", %{"body" => "spam"})
    ref = push(socket, "new_msg", %{"body" => "one too many"})
    assert_reply ref, :error, %{reason: "rate_limited"}
  end
end`,
    },
    {
      title: "Poke a live channel from iex",
      note: "iex -S mix phx.server with a browser connected.",
      code: `# every connected socket transport process:
Registry.select(ShopWeb.Endpoint.pubsub_server(), [{{:"$1", :"$2", :"$3"}, [], [{{:"$1", :"$2"}}]}])
|> Enum.take(5)

ShopWeb.Endpoint.broadcast("room:lobby", "new_msg", %{body: "hi from iex"})

# disconnect every socket for a user (UserSocket.id/1 makes this possible):
ShopWeb.Endpoint.broadcast("user_socket:42", "disconnect", %{})`,
    },
  ],
};
