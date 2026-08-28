export default {
  front:
    "There is no `while`. How do you keep doing something until a condition changes — and why is this not a stack overflow risk?",
  back: "You write a function that calls itself with new arguments, and a clause that stops. When the recursive call is the LAST expression in the body, the BEAM performs **tail-call optimisation**: it reuses the same stack frame, so the loop can run forever in constant memory. That is literally how every long-running process on the BEAM works.",
  philosophy: {
    lead: "Recursion is not an exotic technique here. It is the loop primitive, and tail calls make an infinite loop a legitimate, memory-safe program.",
    body: [
      "Because there is no mutable loop counter, state must be passed along as arguments. That constraint forces you to name what actually changes between iterations, and the result reads like a small state machine. The accumulator pattern — carry the result so far as an extra argument — is the recursion equivalent of Enum.reduce.",
      "The tail-call rule is precise: the self-call must be the last thing evaluated. `[h | recurse(t)]` is NOT a tail call (the cons happens after), while `recurse(t, [h | acc])` is. Body-recursion is fine and often faster for short lists; tail recursion is essential for unbounded loops.",
      "Now hold this thought, because it is the bridge into concurrency. In card 33 you will write a process whose entire body is `receive a message, compute new state, call myself with it`. An infinite tail-recursive loop IS a stateful server on the BEAM. GenServer is that loop, generalised and given a name.",
    ],
    diagram: `flowchart TB
  subgraph body["BODY RECURSION — the stack GROWS"]
    direction TB
    bcode["def sum([]), do: 0<br/>def sum([h ¦ t]), do: h + sum(t)"]:::code
    bcode --> bstack["sum([1,2,3])<br/>  1 + sum([2,3])<br/>      2 + sum([3])<br/>          3 + sum([])"]:::bad
    bstack --> bbad["unbounded input ⇒ stack overflow ✗"]:::bad
  end
  subgraph tail["TAIL RECURSION — the stack is FLAT"]
    direction TB
    tcode["def sum(l), do: sum(l, 0)<br/>defp sum([], acc), do: acc<br/>defp sum([h ¦ t], acc), do: sum(t, h + acc)"]:::code
    tcode --> tstack["sum([1,2,3], 0)<br/>sum([2,3], 1)   ← the SAME frame is reused<br/>sum([3], 3)<br/>sum([], 6)"]:::ok
    tstack --> tgood["runs forever in constant memory ✓"]:::ok
  end
  bbad ~~~ tcode
  tgood --> bridge["THE BRIDGE TO CONCURRENCY — card 33<br/><br/>defp loop(state) do<br/>  receive do msg -&gt; loop(handle(msg, state)) end   ← a tail call<br/>end<br/><br/>an infinite tail-recursive loop IS a stateful SERVER"]:::hot`,
    takeaway:
      "Recursion + accumulator = loop. A tail call reuses the frame, which is why BEAM servers can loop forever.",
  },
  codeSamples: [
    {
      title: "Both styles, side by side",
      note: "",
      code: `defmodule Sum do
  # body recursion — stack grows
  def naive([]), do: 0
  def naive([h | t]), do: h + naive(t)

  # tail recursion — constant stack
  def tail(list), do: do_tail(list, 0)
  defp do_tail([], acc), do: acc
  defp do_tail([h | t], acc), do: do_tail(t, h + acc)
end

Sum.naive(Enum.to_list(1..1000))
Sum.tail(Enum.to_list(1..5_000_000))     # fine ✓`,
    },
    {
      title: "State machine by recursion",
      note: "Countdown with a stop clause.",
      code: `defmodule Countdown do
  def run(0), do: IO.puts("liftoff!")
  def run(n) when n > 0 do
    IO.puts(n)
    run(n - 1)
  end
end

Countdown.run(5)`,
    },
    {
      title: "Rebuilding Enum functions",
      note: "Proves Enum is not magic.",
      code: `defmodule Mine do
  def map([], _f), do: []
  def map([h | t], f), do: [f.(h) | map(t, f)]

  def filter([], _f), do: []
  def filter([h | t], f) do
    if f.(h), do: [h | filter(t, f)], else: filter(t, f)
  end

  def reduce([], acc, _f), do: acc
  def reduce([h | t], acc, f), do: reduce(t, f.(h, acc), f)

  def reverse(list), do: reduce(list, [], fn x, acc -> [x | acc] end)
end

Mine.map([1,2,3], &(&1 * 2))
Mine.filter(1..10 |> Enum.to_list(), &(rem(&1,2)==0))
Mine.reduce([1,2,3], 0, &+/2)
Mine.reverse([1,2,3])`,
    },
    {
      title: "A retry loop — real backend code",
      note: "",
      code: `defmodule Retry do
  def call(fun, attempts \\\\ 3, delay \\\\ 100)
  def call(fun, 1, _delay), do: fun.()
  def call(fun, attempts, delay) do
    case fun.() do
      {:ok, v} -> {:ok, v}
      {:error, _} ->
        Process.sleep(delay)
        call(fun, attempts - 1, delay * 2)     # exponential backoff
    end
  end
end

counter = :counters.new(1, [])
Retry.call(fn ->
  :counters.add(counter, 1, 1)
  if :counters.get(counter, 1) < 3, do: {:error, :flaky}, else: {:ok, :worked}
end)`,
    },
  ],
};
