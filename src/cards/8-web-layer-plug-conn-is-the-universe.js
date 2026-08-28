export default {
  front:
    "A request arrives. In Elixir, what single value represents it, and what does every piece of web code do to that value?",
  back: "`%Plug.Conn{}` — one struct holding the request AND the response: method, path, params, req_headers, assigns, status, resp_body, halted?. Every plug is a function `conn -> conn`. A web application is therefore a pipeline of transformations over one immutable struct. `Plug.Conn.halt/1` marks it done so later plugs are skipped.",
  philosophy: {
    lead: "Phoenix is not a framework that hides HTTP. It is a pipeline over one struct, and once you see that, the whole web layer becomes card 16 applied to a request.",
    body: [
      "Two contracts define everything. A **function plug** is `fun(conn, opts) :: conn`. A **module plug** implements `init/1` (called at compile time, so options are precomputed) and `call/2`. That is the entire specification. Authentication, logging, parsing, CORS, rate limiting, your controller — all of them are just functions from conn to conn, and you can write one in four lines.",
      "The `assigns` map is how plugs communicate: an auth plug puts `conn.assigns.current_user` there and everything downstream reads it. It is the request-scoped state of your application, and because conn is immutable, each plug returns a new conn rather than mutating shared state.",
      "`halt/1` is worth understanding precisely: it does not stop execution, it sets `halted: true`, and `Plug.Builder` (which Phoenix uses) checks that flag between plugs. So you must `|> send_resp(...) |> halt()` and then RETURN — code after halt in the same plug still runs.",
    ],
    diagram: `flowchart TB
  conn0["%Plug.Conn{<br/>  REQUEST — method: 'POST' · request_path: '/api/orders'<br/>            params: %{'item' =&gt; 'book'} · req_headers: [...]<br/>  RESPONSE — status: nil → 201 · resp_headers: [...] · resp_body: '...'<br/>             state: :unset → :sent<br/>  YOUR DATA — assigns: %{current_user: %User{}} · halted: false<br/>}"]:::code
  conn0 --> def0["A PLUG IS JUST — conn in, conn out"]:::hot
  def0 --> p1
  subgraph pipe["the pipeline is a fold over conn"]
    direction TB
    p1["Plug.Logger — log it"]:::ok
    p2["Plug.Parsers — fill params"]:::ok
    p3["Auth — assign current_user, or halt 401"]:::ok
    p4["RateLimit — halt 429 if over the limit"]:::ok
    p5["Router — dispatch to a controller"]:::ok
    p6["put_status(201) ¦&gt; json(%{id: 1}) — send_resp"]:::ok
    p1 --> p2 --> p3 --> p4 --> p5 --> p6
  end
  p6 --> kinds["FUNCTION PLUG — def my_plug(conn, _opts), do: conn<br/>MODULE PLUG — def init(opts) at COMPILE time · def call(conn, opts) per REQUEST<br/>HALT — conn ¦&gt; send_resp(401, '') ¦&gt; halt()<br/>halt/1 sets a flag — the PIPELINE is what checks it"]:::warn`,
    takeaway:
      "One immutable struct in, one out. Every web concern is a function over conn.",
  },
  codeSamples: [
    {
      title: "A whole web server in 15 lines",
      note: 'mix new tiny --sup, add {:plug_cowboy, "~> 2.6"}, then this.',
      code: `defmodule Tiny.Router do
  use Plug.Router

  plug Plug.Logger
  plug :match
  plug Plug.Parsers, parsers: [:json], json_decoder: Jason
  plug :dispatch

  get "/health" do
    send_resp(conn, 200, "ok")
  end

  get "/hello/:name" do
    send_resp(conn, 200, "hello #{name}")
  end

  post "/echo" do
    body = Jason.encode!(%{you_sent: conn.body_params})
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(200, body)
  end

  match _ do
    send_resp(conn, 404, "not found")
  end
end

# start it (in application.ex, or right here in iex):
{:ok, _} = Plug.Cowboy.http(Tiny.Router, [], port: 4001)
# curl localhost:4001/health
# curl localhost:4001/hello/ada
# curl -X POST localhost:4001/echo -H 'content-type: application/json' -d '{"a":1}'`,
    },
    {
      title: "Write your own plugs",
      note: "Both forms. This is all authentication really is.",
      code: `defmodule Tiny.Auth do
  @behaviour Plug
  import Plug.Conn

  @impl true
  def init(opts), do: Keyword.get(opts, :token, "secret")   # compile time

  @impl true
  def call(conn, expected) do                                # per request
    case get_req_header(conn, "authorization") do
      ["Bearer " <> ^expected] ->
        assign(conn, :current_user, %{id: 1, name: "Ada"})

      _ ->
        conn
        |> put_resp_content_type("application/json")
        |> send_resp(401, ~s({"error":"unauthorized"}))
        |> halt()
    end
  end
end

# a FUNCTION plug is even simpler:
defmodule Tiny.ReqId do
  import Plug.Conn
  def request_id(conn, _opts) do
    id = Base.encode16(:crypto.strong_rand_bytes(8), case: :lower)
    conn |> put_resp_header("x-request-id", id) |> assign(:request_id, id)
  end
end`,
    },
    {
      title: "Inspect a conn without a server",
      note: "Plug.Test lets you feel the struct in iex.",
      code: `# add {:plug, "~> 1.15"} to deps
import Plug.Test
import Plug.Conn

conn = conn(:get, "/hello/ada?debug=1")
conn.method
conn.request_path
conn.query_string
conn = Plug.Conn.fetch_query_params(conn)
conn.params

conn =
  conn
  |> assign(:current_user, %{id: 7})
  |> put_resp_header("x-app", "tiny")
  |> put_status(201)
  |> send_resp(201, "created")

{conn.status, conn.resp_body, conn.assigns, conn.state}`,
    },
    {
      title: "Compose plugs manually",
      note: "Proving a pipeline is just function composition.",
      code: `import Plug.Conn
import Plug.Test

log      = fn conn, _ -> IO.puts("--> #{conn.method} #{conn.request_path}"); conn end
stamp    = fn conn, _ -> assign(conn, :at, System.system_time(:second)) end
respond  = fn conn, _ -> send_resp(conn, 200, "at #{conn.assigns.at}") end

conn(:get, "/x")
|> log.([])
|> stamp.([])
|> respond.([])
|> Map.take([:status, :resp_body])`,
    },
  ],
};
