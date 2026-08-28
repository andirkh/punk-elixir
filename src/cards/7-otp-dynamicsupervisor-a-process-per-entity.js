export default {
  front:
    "Chat rooms are created at runtime by users. A Supervisor needs its children listed up front. What supervises processes you cannot know in advance?",
  back: "`DynamicSupervisor`. You start it empty with `strategy: :one_for_one` and add children at runtime via `DynamicSupervisor.start_child/2`. Combined with a Registry for naming (card 38), this is THE pattern for one supervised process per user, per room, per game, per connection — the shape most real Elixir services are built on.",
  philosophy: {
    lead: "This is where the BEAM's cheap processes turn into an architecture: model each live entity in your domain as its own supervised process.",
    body: [
      "Think about what that buys you. Each chat room has its own state with no locking. Each room crashes independently, taking down exactly one room. Each room can hold in-memory state that would be absurd to round-trip to Postgres on every message. And a million rooms cost you a few gigabytes and no design complexity at all — the same code that runs one runs a million.",
      "The standard trio is DynamicSupervisor + Registry + a `start_or_find` helper. The helper tries to start the child and gracefully handles `{:error, {:already_started, pid}}`, so any caller can lazily materialise the entity without coordination. Add `Process.send_after` idle timeouts so rooms that go quiet shut themselves down, and you have automatic memory management for your entire domain.",
      "One caution: these processes are volatile by design. Anything that must survive a crash belongs in Postgres or ETS; the process holds the hot working set and rebuilds it from the database in `init` (or better, in `handle_continue`).",
    ],
    diagram: `flowchart TB
  ds["DynamicSupervisor<br/>starts EMPTY · children added at runtime<br/>strategy: :one_for_one — the only option<br/>max_children: :infinity or n"]:::hot
  ds --> r1["room 1"]:::ok
  ds --> r2["room 2"]:::ok
  ds --> r3["room 3"]:::ok
  ds -.-> rn["… a million of these"]:::muted
  r2 --> own["each one: own state, own mailbox, own crash"]:::ok
  own --> trio["THE STANDARD TRIO<br/>Registry — name lookup by any term · {:via, Registry, {R, id}}<br/>DynamicSupervisor — lifecycle and restarts<br/>start_or_find/1 — lazily materialise on first use"]:::hot
  trio --> code0["def start_or_find(id) do<br/>  case DynamicSupervisor.start_child(Sup, {Room, id}) do<br/>    {:ok, pid} -&gt; pid<br/>    {:error, {:already_started, pid}} -&gt; pid   ← the key line<br/>  end<br/>end"]:::code
  code0 --> idle["IDLE SHUTDOWN keeps memory honest<br/>init → {:ok, state, @idle_ms}   ·   handle_info(:timeout, s) → {:stop, …}"]:::ok
  idle --> vol["⚠ process state is VOLATILE<br/>durable data lives in Postgres or ETS<br/>the process rebuilds its working set in init or handle_continue"]:::warn`,
    takeaway:
      "DynamicSupervisor + Registry = one supervised, addressable process per live entity.",
  },
  codeSamples: [
    {
      title: "Chat rooms, the full pattern",
      note: "This is production-shaped code. Paste it all.",
      code: `defmodule Room do
  use GenServer, restart: :transient

  @idle_ms 30_000

  def via(id), do: {:via, Registry, {Chat.Registry, {:room, id}}}

  def start_link(id), do: GenServer.start_link(__MODULE__, id, name: via(id))

  def post(id, user, text), do: GenServer.call(via(id), {:post, user, text})
  def history(id),          do: GenServer.call(via(id), :history)

  @impl true
  def init(id) do
    IO.puts("room #{id} starting in #{inspect(self())}")
    {:ok, %{id: id, messages: []}, @idle_ms}
  end

  @impl true
  def handle_call({:post, user, text}, _from, state) do
    msg = %{user: user, text: text, at: System.system_time(:second)}
    {:reply, :ok, %{state | messages: [msg | state.messages]}, @idle_ms}
  end

  def handle_call(:history, _from, state),
    do: {:reply, Enum.reverse(state.messages), state, @idle_ms}

  @impl true
  def handle_info(:timeout, state) do
    IO.puts("room #{state.id} idle — shutting down")
    {:stop, :normal, state}
  end
  def handle_info(_msg, state), do: {:noreply, state, @idle_ms}
end

defmodule Chat do
  def child_specs do
    [
      {Registry, keys: :unique, name: Chat.Registry},
      {DynamicSupervisor, name: Chat.RoomSupervisor, strategy: :one_for_one}
    ]
  end

  def open(id) do
    case DynamicSupervisor.start_child(Chat.RoomSupervisor, {Room, id}) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      other -> other
    end
  end

  def rooms do
    DynamicSupervisor.which_children(Chat.RoomSupervisor) |> length()
  end
end

{:ok, _} = Supervisor.start_link(Chat.child_specs(), strategy: :one_for_one)`,
    },
    {
      title: "Use it",
      note: "",
      code: `Chat.open("elixir")
Chat.open("elixir")            # idempotent — same pid
Room.post("elixir", "ada", "hello everyone")
Room.post("elixir", "grace", "hi ada")
Room.history("elixir")

Chat.open("erlang")
Chat.rooms()
Registry.count(Chat.Registry)`,
    },
    {
      title: "Independent failure",
      note: "Crash one room; every other room is untouched.",
      code: `Chat.open("a"); Chat.open("b"); Chat.open("c")
Room.post("a", "u", "keep me")
Room.post("b", "u", "I will die")

[{b_pid, _}] = Registry.lookup(Chat.Registry, {:room, "b"})
Process.exit(b_pid, :kill)
Process.sleep(100)

Room.history("a")               # still there ✓
Registry.lookup(Chat.Registry, {:room, "b"})   # [] — gone, not restarted
Chat.open("b")                  # trivially recreated
Room.history("b")               # [] — state was volatile, as designed`,
    },
    {
      title: "Scale check",
      note: "Ten thousand supervised entities.",
      code: `{t, _} = :timer.tc(fn ->
  for i <- 1..10_000, do: Chat.open("room_#{i}")
end)

IO.puts("10k supervised rooms in #{div(t, 1000)} ms")
Chat.rooms()
:erlang.memory(:processes) |> div(1024 * 1024)   # MB used by all processes`,
    },
  ],
};
