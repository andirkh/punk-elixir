export default {
  front:
    "A browser opens a websocket to your Phoenix app. How many processes appear, and what are they?",
  back: "Two layers. One **Socket** process per connection — it authenticates once and multiplexes. Then one **Channel** process per topic that connection joins. So a user subscribed to three topics has one TCP connection and four processes. Each channel is an isolated GenServer with `join/3`, `handle_in/3`, `handle_info/2` and its own state — everything from module 7 applies unchanged.",
  philosophy: {
    lead: "Phoenix channels are the payoff for all of OTP: a websocket connection is just a supervised process, so a million of them is an ordinary Tuesday.",
    body: [
      "The socket/channel split is what makes this scale and stay clean. Authentication happens once per connection in `UserSocket.connect/3`, and the resulting identity is copied into every channel that connection joins. Multiplexing means one TCP connection carries many logical subscriptions, so a client watching a room, a notification feed and a presence list still costs one socket.",
      "Each channel being its own process is the important structural fact. A crash in one user's chat channel does not touch anyone else's; a slow message handler blocks only that one subscription; per-connection state (the current room, a rate-limit counter, an unsent buffer) lives in that process's state with no shared memory anywhere.",
      "And because channels are ordinary processes, they subscribe to `Phoenix.PubSub` (card 53) like anything else. Your domain broadcasts a fact, the channel receives it in `handle_info/2`, and pushes it down the wire. The domain never knows a websocket exists.",
    ],
    diagram: `flowchart TB
  br["browser"]:::muted -->|ONE websocket, one TCP connection| sock
  sock["UserSocket process<br/>connect/3 AUTHENTICATES here, once<br/>id/1 → 'user:42'"]:::hot
  sock -->|multiplexed topics| ch1["Channel 'room:123'<br/>a GenServer<br/>own state"]:::ok
  sock --> ch2["Channel 'notif:42'<br/>a GenServer<br/>own state, own crash, own mailbox"]:::ok
  sock --> ch3["Channel 'presence:123'<br/>a GenServer"]:::ok
  ch2 --> cb["CALLBACKS — a GenServer with a websocket-shaped API<br/>join(topic, params, socket)<br/>  → {:ok, socket} ¦ {:ok, reply, socket} ¦ {:error, %{reason: 'unauthorized'}}<br/>handle_in(event, payload, socket)   ← messages FROM the client<br/>handle_info(msg, socket)            ← PubSub, timers, anything<br/>terminate(reason, socket)"]:::code
  cb --> api["socket.assigns  — per-connection state, like conn.assigns<br/>push/3          — to THIS client<br/>broadcast/3     — to everyone on this topic, cluster-wide<br/>broadcast_from/3 — everyone EXCEPT the sender"]:::hot`,
    takeaway:
      "One socket process authenticates; one channel process per topic holds state and can crash alone.",
  },
  codeSamples: [
    {
      title: "The socket — authenticate once",
      note: "lib/shop_web/channels/user_socket.ex",
      code: `defmodule ShopWeb.UserSocket do
  use Phoenix.Socket

  channel "room:*",   ShopWeb.RoomChannel
  channel "notif:*",  ShopWeb.NotificationChannel

  @impl true
  def connect(%{"token" => token}, socket, _connect_info) do
    case Phoenix.Token.verify(ShopWeb.Endpoint, "user socket", token, max_age: 86_400) do
      {:ok, user_id} -> {:ok, assign(socket, :current_user_id, user_id)}
      {:error, _reason} -> :error
    end
  end

  def connect(_params, _socket, _info), do: :error

  # lets you disconnect every socket for a user (e.g. on logout / ban)
  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.current_user_id}"
end

# in endpoint.ex:
#   socket "/socket", ShopWeb.UserSocket, websocket: true, longpoll: false`,
    },
    {
      title: "A channel",
      note: "lib/shop_web/channels/room_channel.ex",
      code: `defmodule ShopWeb.RoomChannel do
  use ShopWeb, :channel
  alias Shop.Chat

  @impl true
  def join("room:" <> room_id, _params, socket) do
    user_id = socket.assigns.current_user_id

    if Chat.can_join?(user_id, room_id) do
      # load recent history AFTER join returns, so the join is fast
      send(self(), :after_join)

      socket =
        socket
        |> assign(:room_id, room_id)
        |> assign(:joined_at, System.system_time(:second))

      {:ok, %{room_id: room_id}, socket}
    else
      {:error, %{reason: "unauthorized"}}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    history = Chat.recent_messages(socket.assigns.room_id, 50)
    push(socket, "history", %{messages: history})
    {:noreply, socket}
  end

  # a domain event arriving from PubSub
  def handle_info({:message_created, msg}, socket) do
    push(socket, "new_msg", msg)
    {:noreply, socket}
  end

  def handle_info(_other, socket), do: {:noreply, socket}

  @impl true
  def terminate(reason, socket) do
    IO.puts("channel #{socket.topic} closed: #{inspect(reason)}")
    :ok
  end
end`,
    },
    {
      title: "Mint a token for the client",
      note: "Phoenix.Token is signed, not encrypted — no secrets inside.",
      code: `# server side, in a controller after login:
token = Phoenix.Token.sign(ShopWeb.Endpoint, "user socket", user.id)
# json(conn, %{token: token})

# try it in iex -S mix phx.server:
t = Phoenix.Token.sign(ShopWeb.Endpoint, "user socket", 42)
Phoenix.Token.verify(ShopWeb.Endpoint, "user socket", t, max_age: 86_400)
Phoenix.Token.verify(ShopWeb.Endpoint, "user socket", "garbage", max_age: 86_400)`,
    },
    {
      title: "The browser side",
      note: "Save as an HTML file next to your app, or paste into the console.",
      code: `import {Socket} from "phoenix"

const socket = new Socket("/socket", {params: {token: window.userToken}})
socket.connect()

const channel = socket.channel("room:lobby", {})

channel.join()
  .receive("ok",    resp => console.log("joined", resp))
  .receive("error", resp => console.log("failed", resp))

channel.on("new_msg", payload => console.log("message:", payload))
channel.on("history", payload => console.log("history:", payload.messages))

// send a message and wait for the server's reply
channel.push("new_msg", {body: "hello"}, 10000)
  .receive("ok",      r => console.log("saved", r))
  .receive("error",   r => console.log("rejected", r))
  .receive("timeout", () => console.log("server did not answer"))`,
    },
  ],
};
