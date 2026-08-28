export default {
  front:
    "`File.read/1` returns `{:error, :enoent}` but `File.read!/1` raises. When should YOUR code do each?",
  back: "Return a tagged tuple for **expected** failures the caller can reasonably handle (record not found, invalid input, timeout). `raise` for **impossible** situations that mean a bug or a broken environment (missing config, corrupted state). The `!` suffix is the convention for the raising variant. On the BEAM, letting an unexpected error crash the process is a legitimate strategy, not laziness — that is card 35.",
  philosophy: {
    lead: "Elixir splits failures into two kinds and gives each its own mechanism. Choosing correctly is a design skill, not a style preference.",
    body: [
      "Exceptions in most languages are used for both kinds, so every call site becomes ambiguous and people wrap everything in try/catch. Elixir instead says: if a failure is part of the normal domain, it is DATA — return it, match on it, let `with` compose it. If it is not part of the domain, do not pollute every caller with handling it; raise, and let the supervisor restart a clean process.",
      "This is why `try/rescue` is rare in idiomatic Elixir. You will see it around foreign boundaries — a JSON library that raises, a NIF, a third-party HTTP client — and almost nowhere else. Rescuing broadly is usually a sign that you are fighting the runtime instead of using it.",
      "Note the three separate escape mechanisms: `raise/rescue` for exceptions, `throw/catch` for non-local exits out of deep recursion (rare), and `exit` for process termination signals (which supervisors use). Knowing they are distinct saves confusion when you read Erlang stack traces.",
    ],
    diagram: `flowchart TB
  subgraph split["two different kinds of failure"]
    direction LR
    exp["EXPECTED — a domain outcome<br/>{:ok, v} ¦ {:error, reason}<br/>the caller matches and decides<br/><br/>user not found · invalid email · request timed out"]:::ok
    unexp["UNEXPECTED — a bug or a broken environment<br/>raise, or the ! variant<br/>the process crashes, the supervisor restarts it<br/><br/>missing DB config at boot · impossible state · your own math error"]:::bad
  end
  split --> conv["THE CONVENTION<br/>File.read('x')     → {:error, :enoent}          the safe form<br/>File.read!('x')    → ** (File.Error)             the bang form<br/>Repo.get(User, 1)  → nil ¦ %User{}<br/>Repo.get!(User, 1) → raises Ecto.NoResultsError"]:::code
  conv --> three["THREE ESCAPE MECHANISMS — do not confuse them<br/>raise → rescue   exceptions, %RuntimeError{} and friends<br/>throw → catch    non-local return out of deep recursion, rare<br/>exit  → trapped  a process death signal — supervisors live here"]:::warn`,
    takeaway:
      "Domain failures are data. Bugs raise and the supervisor cleans up. Bang functions are the raising variant.",
  },
  codeSamples: [
    {
      title: "Both variants of your own function",
      note: "",
      code: `defmodule Config do
  @settings %{"port" => 4000}

  def fetch(key) do
    case Map.fetch(@settings, key) do
      {:ok, v} -> {:ok, v}
      :error   -> {:error, :missing}
    end
  end

  def fetch!(key) do
    case fetch(key) do
      {:ok, v} -> v
      {:error, :missing} -> raise ArgumentError, "missing config key: #{key}"
    end
  end
end

Config.fetch("port")
Config.fetch("nope")
Config.fetch!("port")
# Config.fetch!("nope")    # ** (ArgumentError) missing config key: nope`,
    },
    {
      title: "Custom exceptions",
      note: "defexception gives you a struct with a message.",
      code: `defmodule PaymentError do
  defexception [:reason, :amount]

  @impl true
  def message(%{reason: r, amount: a}), do: "payment of #{a} failed: #{r}"
end

try do
  raise PaymentError, reason: :card_declined, amount: 2500
rescue
  e in PaymentError -> {:caught, Exception.message(e), e.reason}
end`,
    },
    {
      title: "try / rescue / after / else",
      note: "You will rarely need all four — but know them.",
      code: `result =
  try do
    String.to_integer("not a number")
  rescue
    e in ArgumentError -> {:error, Exception.message(e)}
  else
    n -> {:ok, n}
  after
    IO.puts("this always runs — use for cleanup")
  end

result`,
    },
    {
      title: "Safe wrappers at a foreign boundary",
      note: "The legitimate use of rescue.",
      code: `defmodule Safe do
  def to_int(str) do
    {:ok, String.to_integer(str)}
  rescue
    ArgumentError -> {:error, :not_an_integer}
  end
end

Safe.to_int("42")
Safe.to_int("oops")

# Kernel helpers that already do this for you:
Integer.parse("42abc")     # {42, "abc"}
Float.parse("3.5x")        # {3.5, "x"}`,
    },
  ],
};
