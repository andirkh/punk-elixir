export default {
  front: "Processes share nothing. So how does one get data from another?",
  back: "Messages. `send(pid, term)` copies the term into the target's **mailbox** and returns immediately — it never blocks and never fails, even if the process is dead. `receive do pattern -> ... end` scans the mailbox for the FIRST message matching any pattern, removes it, and runs that branch; it blocks until one matches, unless you add an `after` timeout.",
  philosophy: {
    lead: "Message passing is asynchronous by nature. Everything synchronous in Elixir — including GenServer.call — is built by sending a message and then waiting for a reply.",
    body: [
      "Two details matter enormously in production. First, `receive` does **selective receive**: it walks the mailbox looking for a match, so a message nobody ever matches stays there forever. An unbounded mailbox full of unmatched messages is the classic Elixir memory leak, which is why GenServer's catch-all `handle_info/2` exists.",
      "Second, `send` is fire-and-forget. There is no delivery guarantee and no backpressure; a fast sender can flood a slow receiver. This is why you use `GenServer.call` (which waits for a reply and therefore self-limits) rather than `cast` for anything that must not pile up.",
      "The request/reply pattern — send your own PID inside the message so the other side knows where to answer — is worth writing by hand once. After that you will let GenServer do it, but you will know exactly what it is doing.",
    ],
    diagram: `sequenceDiagram
    autonumber
    participant A as Process A
    participant M as B's mailbox
    participant B as Process B
    A->>M: send(b, {:hi, self()})<br/>the message is COPIED
    Note over A: send returns immediately.<br/>It never blocks, never fails,<br/>never confirms delivery.
    M->>B: receive do<br/>{:hi, from} -> … end
    B->>A: send(from, :pong)<br/>copied back
    Note over A,B: Synchronous = send + wait for a reply.<br/>That is all GenServer.call/3 is.
    Note over M: SELECTIVE RECEIVE scans the queue<br/>IN ORDER and takes the FIRST match.<br/>mailbox: [:junk, {:job, 1}, :junk2]<br/>receive do {:job, n} -> n end<br/>takes {:job, 1} and leaves the junk.<br/>⚠ the junk stays forever — a leak.
    Note over B: ALWAYS have a timeout in real code:<br/>receive do msg -> handle(msg)<br/>after 5_000 -> :timeout end`,
    takeaway:
      "send copies and returns. receive selectively matches. Unmatched messages leak.",
  },
  codeSamples: [
    {
      title: "Send yourself a message",
      note: "Your shell is a process with a mailbox.",
      code: `send(self(), {:hello, "world"})
Process.info(self(), :message_queue_len)

receive do
  {:hello, what} -> "got #{what}"
after
  100 -> :nothing_there
end`,
    },
    {
      title: "Request / reply by hand",
      note: "This is GenServer.call, unpacked.",
      code: `server = spawn(fn ->
  receive do
    {:add, a, b, from} -> send(from, {:result, a + b})
  end
end)

send(server, {:add, 2, 3, self()})

receive do
  {:result, r} -> r
after
  1_000 -> :timeout
end`,
    },
    {
      title: "Watch selective receive leak",
      note: "Run it and watch the queue grow.",
      code: `p = spawn(fn ->
  receive do
    {:wanted, x} -> IO.puts("finally got #{x}")
  end
end)

for i <- 1..1000, do: send(p, {:ignored, i})
Process.info(p, :message_queue_len)      # 1000 messages, none matched 😱

send(p, {:wanted, :ok})
Process.info(p, :message_queue_len)      # still 1000 — the junk stays

# THE FIX: always have a catch-all clause
q = spawn(fn ->
  loop = fn loop ->
    receive do
      {:wanted, x} -> IO.puts("got #{x}"); loop.(loop)
      other        -> IO.puts("dropping #{inspect(other)}"); loop.(loop)
    end
  end
  loop.(loop)
end)
for i <- 1..3, do: send(q, {:junk, i})`,
    },
    {
      title: "Timeouts and flushing",
      note: "",
      code: `receive do
  :never_arrives -> :ok
after
  500 -> :timed_out
end

# after 0 = check the mailbox without blocking
receive do
  msg -> msg
after
  0 -> :empty
end

send(self(), :a); send(self(), :b)
flush()          # iex helper: dump and clear the mailbox`,
    },
  ],
};
