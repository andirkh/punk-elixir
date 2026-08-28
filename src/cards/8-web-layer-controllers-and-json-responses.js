export default {
  front:
    "A controller action receives `(conn, params)`. What are the only three things it should do?",
  back: "(1) Extract and shape params — usually by pattern matching in the function head. (2) Call ONE context function. (3) Turn the result into a response with `json/2`, `put_status/2`, or delegate to a fallback controller. No queries, no business rules, no multi-step orchestration. If an action is longer than about ten lines, logic has leaked out of the context.",
  philosophy: {
    lead: "A controller is a translator between HTTP and your domain. Keeping it thin is what keeps your domain testable and reusable.",
    body: [
      "The `action_fallback` mechanism is the piece that makes thin controllers practical. Declare `action_fallback ShopWeb.FallbackController` and any action that returns `{:error, ...}` instead of a conn is routed there. Now the happy path in every action is a `with` expression (card 22) and all error-to-status mapping lives in exactly one module. That is a genuinely elegant design and it is worth adopting on day one.",
      "For JSON rendering, modern Phoenix uses plain modules with a `data/1` function (a JSON view) rather than templates. Keeping serialisation out of the controller means one place decides which fields are public — which is how you avoid leaking `password_hash` because someone piped a struct straight into `json/2`.",
      'Pattern-match params in the head. `def show(conn, %{"id" => id})` documents the contract, and a request missing `id` produces a clear FunctionClauseError rather than a nil flowing into your query.',
    ],
    diagram: `flowchart TB
  act["def create(conn, %{'order' =&gt; params}) do<br/>  with {:ok, order} &lt;- Orders.create(conn.assigns.current_user, params) do<br/>    conn<br/>    ¦&gt; put_status(:created)<br/>    ¦&gt; put_resp_header('location', ~p'/api/orders/' &lt;&gt; order.id)<br/>    ¦&gt; render(:show, order: order)<br/>  end<br/>end"]:::code
  act --> step1["1. shape the params in the function head"]:::ok
  step1 --> step2["2. ONE context call"]:::ok
  step2 --> step3["3. render"]:::ok
  act -.->|it returned an :error tuple| f1
  subgraph fb["FallbackController — ALL error mapping in ONE place"]
    direction TB
    f1["{:error, :not_found} → 404"]:::warn
    f2["{:error, :unauthorized} → 401"]:::warn
    f3["{:error, %Ecto.Changeset{}} → 422 + field errors"]:::warn
    f1 ~~~ f2 ~~~ f3
  end
  f3 --> helpers["RESPONSE HELPERS<br/>json(conn, map) · render(conn, :show, order: order)<br/>put_status(conn, :created ¦ 201) · send_resp(conn, 204, '')<br/>put_resp_header/3 · redirect(conn, to: ...)<br/><br/>STATUS ATOMS<br/>:ok :created :no_content :bad_request :unauthorized<br/>:forbidden :not_found :unprocessable_entity :conflict"]:::code
  helpers --> danger["⚠ NEVER json(conn, user_struct) directly — it serialises EVERY field.<br/>Use a JSON view module that lists the public fields explicitly."]:::bad`,
    takeaway:
      "Params in, one context call, response out. Push all error mapping into action_fallback.",
  },
  codeSamples: [
    {
      title: "A thin, complete controller",
      note: "lib/shop_web/controllers/order_controller.ex",
      code: `defmodule ShopWeb.OrderController do
  use ShopWeb, :controller

  alias Shop.Orders
  alias Shop.Orders.Order

  action_fallback ShopWeb.FallbackController

  def index(conn, params) do
    orders = Orders.list_orders(conn.assigns.current_user, params)
    render(conn, :index, orders: orders)
  end

  def show(conn, %{"id" => id}) do
    with {:ok, %Order{} = order} <- Orders.fetch_order(conn.assigns.current_user, id) do
      render(conn, :show, order: order)
    end
  end

  def create(conn, %{"order" => order_params}) do
    with {:ok, %Order{} = order} <- Orders.create_order(conn.assigns.current_user, order_params) do
      conn
      |> put_status(:created)
      |> put_resp_header("location", ~p"/api/orders/#{order.id}")
      |> render(:show, order: order)
    end
  end

  def update(conn, %{"id" => id, "order" => params}) do
    with {:ok, order} <- Orders.fetch_order(conn.assigns.current_user, id),
         {:ok, order} <- Orders.update_order(order, params) do
      render(conn, :show, order: order)
    end
  end

  def delete(conn, %{"id" => id}) do
    with {:ok, order} <- Orders.fetch_order(conn.assigns.current_user, id),
         {:ok, _} <- Orders.delete_order(order) do
      send_resp(conn, :no_content, "")
    end
  end
end`,
    },
    {
      title: "The JSON view",
      note: "lib/shop_web/controllers/order_json.ex — the field whitelist.",
      code: `defmodule ShopWeb.OrderJSON do
  alias Shop.Orders.Order

  def index(%{orders: orders}), do: %{data: for(o <- orders, do: data(o))}
  def show(%{order: order}),    do: %{data: data(order)}

  defp data(%Order{} = o) do
    %{
      id: o.id,
      status: o.status,
      total_cents: o.total_cents,
      inserted_at: o.inserted_at,
      items: for(i <- o.items || [], do: %{sku: i.sku, qty: i.qty})
    }
    # note what is NOT here: internal_notes, user.password_hash, …
  end
end`,
    },
    {
      title: "The fallback controller",
      note: "Every error-to-status decision, in one file.",
      code: `defmodule ShopWeb.FallbackController do
  use ShopWeb, :controller

  def call(conn, {:error, %Ecto.Changeset{} = changeset}) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{errors: translate_errors(changeset)})
  end

  def call(conn, {:error, :not_found}),
    do: conn |> put_status(:not_found) |> json(%{error: "not found"})

  def call(conn, {:error, :unauthorized}),
    do: conn |> put_status(:unauthorized) |> json(%{error: "unauthorized"})

  def call(conn, {:error, :forbidden}),
    do: conn |> put_status(:forbidden) |> json(%{error: "forbidden"})

  def call(conn, {:error, reason}) when is_atom(reason),
    do: conn |> put_status(:bad_request) |> json(%{error: to_string(reason)})

  defp translate_errors(changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc ->
        String.replace(acc, "%{#{k}}", to_string(v))
      end)
    end)
  end
end`,
    },
    {
      title: "Controller tests",
      note: "test/shop_web/controllers/order_controller_test.exs",
      code: `defmodule ShopWeb.OrderControllerTest do
  use ShopWeb.ConnCase, async: true

  setup %{conn: conn} do
    user = Shop.AccountsFixtures.user_fixture()
    conn =
      conn
      |> put_req_header("accept", "application/json")
      |> put_req_header("authorization", "Bearer " <> Shop.Accounts.token_for(user))
    {:ok, conn: conn, user: user}
  end

  test "creates an order", %{conn: conn} do
    conn = post(conn, ~p"/api/orders", order: %{total_cents: 1500})
    assert %{"data" => %{"id" => id}} = json_response(conn, 201)
    assert id
  end

  test "rejects invalid params with 422", %{conn: conn} do
    conn = post(conn, ~p"/api/orders", order: %{total_cents: -1})
    assert %{"errors" => %{"total_cents" => _}} = json_response(conn, 422)
  end

  test "401 without a token" do
    conn = build_conn() |> get(~p"/api/orders")
    assert json_response(conn, 401)
  end
end`,
    },
  ],
};
