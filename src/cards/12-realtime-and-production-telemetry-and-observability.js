export default {
  front:
    "Your API is slow but only sometimes. What does Elixir give you that most stacks require an APM vendor for?",
  back: "`:telemetry` events emitted by Phoenix, Ecto, Oban, Finch and your own code, plus `Telemetry.Metrics` to aggregate them and `LiveDashboard` to see everything live — request timings, query timings, process counts, memory, mailbox lengths and a full supervision tree. Attach a handler in a few lines and you can export the same events to Prometheus, StatsD or OpenTelemetry.",
  philosophy: {
    lead: "Observability on the BEAM starts from a genuinely different place: the runtime already knows everything, and telemetry is how it tells you.",
    body: [
      "Every process's memory, mailbox length, current function and reductions are queryable at runtime, in production, without a profiler or a restart. That is unusual, and it changes debugging from 'reproduce it locally' to 'go look at the running system'. Telemetry adds the application-level layer: named events with measurements and metadata, emitted by the libraries you already use.",
      "The architecture is deliberately decoupled. Libraries `:telemetry.execute/3`; you attach handlers. Nothing is coupled to a vendor, and adding metrics to your own context functions is `span/3` around the work. Because handlers run in the calling process, keep them fast — do aggregation in a reporter, not in the handler.",
      "The four things worth instrumenting on day one: request duration by route and status, database query time (especially queue time, which reveals pool exhaustion long before it becomes an outage), background job outcomes, and business events you will want to correlate later. Add `Logger.metadata/1` with a request id so logs from one request can be found together.",
    ],
    diagram: `flowchart TB
  subgraph emit["LIBRARIES EMIT — you ATTACH"]
    direction TB
    e1["[:phoenix, :endpoint, :stop]"]:::code
    e2["[:phoenix, :router_dispatch, :stop]"]:::code
    e3["[:shop, :repo, :query]"]:::code
    e4["[:oban, :job, :stop]"]:::code
    e5["[:vm, :memory] · [:vm, :total_run_queue_lengths]"]:::code
    e6["your own — :telemetry.span([:shop, :checkout], meta, fn -&gt; … end)"]:::code
    e1 ~~~ e2 ~~~ e3 ~~~ e4 ~~~ e5 ~~~ e6
  end
  e6 -->|":telemetry.attach/4 · attach_many/4"| mt["Telemetry.Metrics<br/>counter · summary · distribution · last_value<br/><br/>measurements: %{duration, queue_time, …}<br/>metadata: %{query, params, route, …}"]:::hot
  mt --> o1["LiveDashboard — live, built in, /dev/dashboard"]:::ok
  mt --> o2["PromEx / TelemetryMetricsPrometheus → Grafana"]:::ok
  mt --> o3["OpenTelemetry → traces across services"]:::ok
  e6 --> o4["your own handler — log slow queries, alert, count"]:::ok
  o3 --> intro["RUNTIME INTROSPECTION — no APM required<br/>:observer.start()               a GUI: tree, processes, memory, ETS<br/>:erlang.memory()                where the memory actually is<br/>Process.list()<br/>:recon.proc_count(:memory, 5)   the top 5 memory hogs<br/>:recon.proc_count(:message_queue_len, 5)   find the blocked process<br/>:sys.get_state(pid)             any GenServer's state, live"]:::code
  intro --> cheap["⚠ handlers run in the CALLING process. Keep them cheap."]:::bad`,
    takeaway:
      "Libraries emit telemetry events; you attach handlers and reporters. The runtime itself is fully introspectable, live.",
  },
  codeSamples: [
    {
      title: "A Telemetry module with real metrics",
      note: "lib/shop/telemetry.ex — add to your children list.",
      code: `defmodule Shop.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(arg), do: Supervisor.start_link(__MODULE__, arg, name: __MODULE__)

  @impl true
  def init(_arg) do
    children = [
      {:telemetry_poller, measurements: periodic_measurements(), period: 10_000}
      # {TelemetryMetricsPrometheus, [metrics: metrics()]}
    ]
    Supervisor.init(children, strategy: :one_for_one)
  end

  def metrics do
    [
      # HTTP
      summary("phoenix.endpoint.stop.duration",
        unit: {:native, :millisecond}, tags: [:status]),
      summary("phoenix.router_dispatch.stop.duration",
        unit: {:native, :millisecond}, tags: [:route]),
      counter("phoenix.error_rendered.count", tags: [:status]),

      # Database — queue_time is the pool-exhaustion early warning
      summary("shop.repo.query.total_time", unit: {:native, :millisecond}),
      summary("shop.repo.query.queue_time", unit: {:native, :millisecond}),
      summary("shop.repo.query.decode_time", unit: {:native, :millisecond}),

      # Background jobs
      counter("oban.job.stop.count", tags: [:queue, :worker]),
      counter("oban.job.exception.count", tags: [:queue, :worker]),
      summary("oban.job.stop.duration", unit: {:native, :millisecond}, tags: [:queue]),

      # VM health
      last_value("vm.memory.total", unit: {:byte, :megabyte}),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.system_counts.process_count"),

      # your own domain events
      counter("shop.checkout.stop.count", tags: [:result]),
      summary("shop.checkout.stop.duration", unit: {:native, :millisecond})
    ]
  end

  defp periodic_measurements do
    [
      {__MODULE__, :dispatch_process_counts, []}
    ]
  end

  def dispatch_process_counts do
    :telemetry.execute([:shop, :processes], %{count: :erlang.system_info(:process_count)}, %{})
  end
end`,
    },
    {
      title: "Instrument your own code",
      note: "span emits start/stop/exception automatically.",
      code: `defmodule Shop.Checkout do
  def place(user, params) do
    :telemetry.span(
      [:shop, :checkout],
      %{user_id: user.id},
      fn ->
        result = do_place(user, params)
        outcome = if match?({:ok, _}, result), do: :ok, else: :error
        {result, %{result: outcome}}
      end
    )
  end

  defp do_place(_user, _params) do
    Process.sleep(50)
    {:ok, %{id: 1}}
  end
end

# attach a handler and watch it fire:
:telemetry.attach_many(
  "checkout-logger",
  [[:shop, :checkout, :start], [:shop, :checkout, :stop], [:shop, :checkout, :exception]],
  fn event, measurements, metadata, _config ->
    IO.inspect({event, measurements, metadata}, label: "TELEMETRY")
  end,
  nil
)

Shop.Checkout.place(%{id: 1}, %{})`,
    },
    {
      title: "LiveDashboard",
      note: "The single highest-value thing to enable in dev.",
      code: `# mix.exs: {:phoenix_live_dashboard, "~> 0.8"}, {:telemetry_poller, "~> 1.0"}

# router.ex
import Phoenix.LiveDashboard.Router

scope "/dev" do
  pipe_through [:fetch_session, :protect_from_forgery]
  live_dashboard "/dashboard",
    metrics: Shop.Telemetry,
    ecto_repos: [Shop.Repo]
end

# visit http://localhost:4000/dev/dashboard
# tabs: Home · Metrics · Processes · Ports · Sockets · ETS · Applications
#       Request Logger · Ecto Stats

# in PRODUCTION put it behind auth:
# pipeline :admins_only do plug ShopWeb.Plugs.RequireRole, role: :admin end`,
    },
    {
      title: "Runtime introspection in a live system",
      note: "Connect to production with a remote shell and run these.",
      code: `# where is the memory going?
:erlang.memory()
:erlang.memory(:processes) |> div(1024*1024)

# top memory-consuming processes (needs {:recon, "~> 2.5"})
:recon.proc_count(:memory, 5)
:recon.proc_count(:message_queue_len, 5)     # find the blocked GenServer
:recon.bin_leak(5)                            # binary memory leaks

# without recon:
Process.list()
|> Enum.map(fn p -> {p, Process.info(p, :message_queue_len)} end)
|> Enum.reject(fn {_, v} -> is_nil(v) end)
|> Enum.sort_by(fn {_, {_, len}} -> -len end)
|> Enum.take(5)

# inspect any GenServer's state, live:
# :sys.get_state(Shop.Cache)

# scheduler utilisation
:scheduler.utilization(1)`,
    },
  ],
};
