export default {
  front:
    "Three steps must each succeed before you can act: find the user, check the password, mint a token. Nested cases become a pyramid. What replaces them?",
  back: "`with`. Each clause uses `<-` to match an expected success pattern. If every clause matches, the `do` block runs. The moment one does NOT match, `with` short-circuits and returns that non-matching value untouched (or routes it into an optional `else`). It is the pipeline operator for operations that can fail.",
  philosophy: {
    lead: "Pipelines assume every step succeeds. Real backends have steps that fail. `with` is the pipeline for fallible steps.",
    body: [
      "The elegance is that failure needs no handling code at all in the common case: the offending `{:error, :not_found}` simply becomes the return value of the whole expression, and your caller — usually a Phoenix controller — pattern-matches on it. Your business logic reads as a straight line of successes, which is how you actually think about it.",
      "This is the payoff of the tagged-tuple convention from card 4. Because the whole ecosystem agrees that success is `{:ok, x}`, `with` composes functions from different libraries — Ecto, your context modules, an HTTP client — without adapters.",
      "Use `else` sparingly. If your else block has five clauses, that is a smell: the errors are ambiguous and you probably want each step to return a distinctly tagged error like `{:error, :invalid_password}` so the caller can tell them apart.",
    ],
    diagram: `flowchart TB
  pyramid["WITHOUT with — the pyramid of doom<br/>case find_user(email) do<br/>  {:ok, user} -&gt;<br/>    case check_password(user, pw) do<br/>      {:ok, user} -&gt;<br/>        case mint_token(user) do … end<br/>      err -&gt; err<br/>    end<br/>  err -&gt; err<br/>end"]:::bad
  pyramid --> line["WITH with — a straight line<br/>with {:ok, user}  &lt;- find_user(email),<br/>     {:ok, user}  &lt;- check_password(user, pw),<br/>     {:ok, token} &lt;- mint_token(user) do<br/>  {:ok, token}<br/>end"]:::ok
  line --> happy
  subgraph happy["the happy path is the only path you write"]
    direction LR
    f1["find_user"]:::hot -->|ok| f2["check_password"]:::hot -->|ok| f3["mint_token"]:::hot -->|ok| done["{:ok, token}"]:::ok
  end
  f1 -.->|no match| esc["whatever did not match is returned AS IS<br/>or handed to the else block"]:::warn
  f2 -.->|no match| esc
  f3 -.->|no match| esc`,
    takeaway:
      "with chains fallible steps and returns the first mismatch untouched.",
  },
  codeSamples: [
    {
      title: "A login flow",
      note: "Paste it, then flip the inputs to see each failure path.",
      code: `defmodule Auth do
  @users %{"ada@x.dev" => %{id: 1, pw: "lovelace", active: true}}

  def find_user(email) do
    case Map.fetch(@users, email) do
      {:ok, u} -> {:ok, u}
      :error   -> {:error, :not_found}
    end
  end

  def check_password(%{pw: pw} = u, given) when pw == given, do: {:ok, u}
  def check_password(_u, _given), do: {:error, :bad_password}

  def check_active(%{active: true} = u), do: {:ok, u}
  def check_active(_), do: {:error, :suspended}

  def mint_token(u), do: {:ok, "tok_#{u.id}_#{System.unique_integer([:positive])}"}

  def login(email, password) do
    with {:ok, user}  <- find_user(email),
         {:ok, user}  <- check_password(user, password),
         {:ok, user}  <- check_active(user),
         {:ok, token} <- mint_token(user) do
      {:ok, %{user_id: user.id, token: token}}
    end
  end
end

Auth.login("ada@x.dev", "lovelace")
Auth.login("ada@x.dev", "wrong")     # {:error, :bad_password}
Auth.login("nobody@x.dev", "x")      # {:error, :not_found}`,
    },
    {
      title: "else for translating errors",
      note: "Keep it short. Distinct tags beat a long else.",
      code: `defmodule Api do
  def show(id) do
    with {:ok, id} <- parse_id(id),
         {:ok, rec} <- fetch(id) do
      {:ok, rec}
    else
      {:error, :bad_id}    -> {:error, 400, "id must be an integer"}
      {:error, :not_found} -> {:error, 404, "no such record"}
    end
  end

  defp parse_id(s) do
    case Integer.parse(s) do
      {n, ""} -> {:ok, n}
      _ -> {:error, :bad_id}
    end
  end

  defp fetch(1), do: {:ok, %{id: 1, name: "Ada"}}
  defp fetch(_), do: {:error, :not_found}
end

Api.show("1"); Api.show("abc"); Api.show("99")`,
    },
    {
      title: "with also does plain matches and guards",
      note: "",
      code: `params = %{"name" => " Ada ", "age" => "36"}

with %{"name" => name, "age" => age_str} <- params,
     name = String.trim(name),
     true <- name != "",
     {age, ""} <- Integer.parse(age_str),
     true <- age >= 18 do
  {:ok, %{name: name, age: age}}
else
  false -> {:error, :invalid}
  _     -> {:error, :malformed}
end`,
    },
  ],
};
