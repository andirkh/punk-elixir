export default {
  front:
    "HTTP requests carry a Bearer token; websockets cannot set headers from a browser. How do you authenticate both, and where does authorisation live?",
  back: "For HTTP: a plug (card 50) that verifies the token and assigns `current_user`. For websockets: the token goes in the connect PARAMS and is verified once in `UserSocket.connect/3`; browsers cannot set arbitrary headers on a websocket handshake. Authorisation is separate and belongs in the CONTEXT — every context function takes the actor and scopes its query, so no route or channel can accidentally leak another user's data.",
  philosophy: {
    lead: "Authentication is a plug-level concern; authorisation is a domain-level one. Mixing them is how data leaks happen.",
    body: [
      "The mistake to avoid is authorising in controllers. If `Orders.fetch_order/2` takes a user and scopes the query with `where: o.user_id == ^user.id`, then it is structurally impossible for any caller — a controller, a channel, a background job, a mix task — to read someone else's order. If instead the controller checks `if order.user_id == current_user.id`, then every new caller must remember to repeat that check, and eventually one will not.",
      "For tokens, `Phoenix.Token` is the built-in option: signed (not encrypted), carrying a small payload and a max age. It is ideal for socket tokens. For full session auth, `mix phx.gen.auth` generates a complete, well-reviewed implementation with hashed passwords, session tokens in the database, and remember-me handling — start there rather than writing your own.",
      "Password hashing must use a slow, salted algorithm: `bcrypt_elixir`, `argon2_elixir`, or `pbkdf2_elixir`. Also verify a dummy hash when the user is not found, so response timing does not reveal which emails exist — the generated auth code does this for you, which is a good reason to read it.",
    ],
    diagram: `flowchart TB
  subgraph ways["AUTHENTICATION — two doors, one destination"]
    direction LR
    http0["HTTP<br/>Authorization: Bearer &lt;token&gt;<br/>↓<br/>pipeline :authed do<br/>  plug ShopWeb.Plugs.Auth<br/>end<br/>↓<br/>conn.assigns.current_user"]:::hot
    ws["WEBSOCKET<br/>new Socket('/socket', {params: {token: t}})<br/>↓<br/>UserSocket.connect(params, socket)<br/>verify ONCE per connection<br/>↓<br/>socket.assigns.current_user_id"]:::hot
  end
  ways --> a1
  subgraph authz["AUTHORISATION LIVES HERE — in the context, in the QUERY"]
    direction TB
    a1["Orders.fetch_order(%User{id: uid}, id)<br/>  where: o.user_id == ^uid      ← scoped IN THE QUERY<br/>⇒ no caller can leak another user's data, ever"]:::ok
  end
  a1 --> anti["✗ in the controller: if order.user_id == current_user.id<br/>every caller has to remember. One of them will not."]:::bad
  anti --> creds["TOKENS    — Phoenix.Token.sign/verify · signed, max_age, small<br/>SESSIONS  — mix phx.gen.auth · database tokens, remember-me<br/>PASSWORDS — bcrypt / argon2 / pbkdf2 · never SHA, never plaintext<br/>            and verify a dummy hash on unknown users, for timing"]:::code`,
    takeaway:
      "Authenticate at the edge, authorise in the context by scoping every query to the actor.",
  },
  codeSamples: [
    {
      title: "Token auth for HTTP and sockets",
      note: "One verifier, two entry points.",
      code: `defmodule Shop.Accounts.Auth do
  alias ShopWeb.Endpoint
  @salt "user auth"
  @max_age 86_400

  def sign(user_id), do: Phoenix.Token.sign(Endpoint, @salt, user_id)

  def verify(token) do
    case Phoenix.Token.verify(Endpoint, @salt, token, max_age: @max_age) do
      {:ok, user_id} ->
        case Shop.Accounts.get_user(user_id) do
          nil -> {:error, :not_found}
          user -> {:ok, user}
        end
      {:error, :expired} -> {:error, :expired}
      {:error, _} -> {:error, :invalid}
    end
  end
end

# HTTP
defmodule ShopWeb.Plugs.Auth do
  import Plug.Conn
  import Phoenix.Controller, only: [json: 2]

  def init(o), do: o

  def call(conn, _opts) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         {:ok, user} <- Shop.Accounts.Auth.verify(token) do
      assign(conn, :current_user, user)
    else
      _ -> conn |> put_status(:unauthorized) |> json(%{error: "unauthorized"}) |> halt()
    end
  end
end

# WEBSOCKET
defmodule ShopWeb.UserSocket do
  use Phoenix.Socket
  channel "room:*", ShopWeb.RoomChannel

  @impl true
  def connect(%{"token" => token}, socket, _info) do
    case Shop.Accounts.Auth.verify(token) do
      {:ok, user} -> {:ok, assign(socket, :current_user, user)}
      {:error, _} -> :error
    end
  end
  def connect(_, _, _), do: :error

  @impl true
  def id(socket), do: "user_socket:#{socket.assigns.current_user.id}"
end`,
    },
    {
      title: "Password login, done safely",
      note: "Constant-time compare and a dummy hash for unknown users.",
      code: `# deps: {:bcrypt_elixir, "~> 3.1"}

defmodule Shop.Accounts do
  import Ecto.Query
  alias Shop.{Repo, Accounts.User}

  def register(attrs) do
    %User{} |> User.registration_changeset(attrs) |> Repo.insert()
  end

  def authenticate(email, password) do
    user = Repo.one(from u in User, where: u.email == ^String.downcase(email))

    cond do
      user && Bcrypt.verify_pass(password, user.password_hash) ->
        {:ok, user}

      user ->
        {:error, :bad_password}

      true ->
        Bcrypt.no_user_verify()          # constant time for unknown emails
        {:error, :bad_password}          # same error — do not reveal existence
    end
  end
end

# in the changeset:
# defp hash_password(%{valid?: true, changes: %{password: pw}} = cs),
#   do: put_change(cs, :password_hash, Bcrypt.hash_pwd_salt(pw))`,
    },
    {
      title: "Authorisation in the context, not the controller",
      note: "The single most valuable habit in this card.",
      code: `defmodule Shop.Orders do
  import Ecto.Query
  alias Shop.{Repo, Orders.Order, Accounts.User}

  # every read is scoped to the actor
  def list_orders(%User{id: uid}) do
    Repo.all(from o in Order, where: o.user_id == ^uid)
  end

  def fetch_order(%User{id: uid}, id) do
    case Repo.get_by(Order, id: id, user_id: uid) do
      nil -> {:error, :not_found}         # not :forbidden — do not leak existence
      order -> {:ok, order}
    end
  end

  # role checks are explicit function clauses
  def refund(%User{role: :admin}, %Order{} = order), do: do_refund(order)
  def refund(%User{id: uid}, %Order{user_id: uid} = order), do: do_refund(order)
  def refund(%User{}, %Order{}), do: {:error, :forbidden}

  defp do_refund(order), do: order |> Ecto.Changeset.change(status: :refunded) |> Repo.update()
end

# now a channel is safe with no extra code:
# def handle_in("refund", %{"id" => id}, socket) do
#   with {:ok, order} <- Shop.Orders.fetch_order(socket.assigns.current_user, id),
#        {:ok, order} <- Shop.Orders.refund(socket.assigns.current_user, order) do
#     {:reply, {:ok, %{status: order.status}}, socket}
#   else
#     {:error, r} -> {:reply, {:error, %{reason: to_string(r)}}, socket}
#   end
# end`,
    },
    {
      title: "Let the generator write it for you",
      note: "Read the generated code — it is a good tutorial.",
      code: `mix phx.gen.auth Accounts User users

# generates: schema with hashed passwords, session tokens in the DB,
# email confirmation, password reset, remember-me cookie, plugs,
# LiveViews or controllers, and a full test suite.

mix deps.get
mix ecto.migrate
mix test`,
    },
  ],
};
