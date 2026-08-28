export default {
  front:
    "Protocols dispatch on data. What dispatches on MODULES — as in 'any module that provides init/1 and handle_call/3 can be a GenServer'?",
  back: "A **behaviour**. `@callback` declarations in one module define a contract; another module writes `@behaviour ThatModule` and implements the callbacks, with the compiler warning about anything missing. This is exactly how GenServer, Supervisor, Plug, Phoenix.Channel and Ecto.Repo define what you must provide.",
  philosophy: {
    lead: "A behaviour is an interface for modules — the seam where OTP hands you a slot to fill and takes care of everything else.",
    body: [
      "This is the single most important abstraction to understand before OTP, because every OTP building block is a behaviour. GenServer implements the whole message loop, the timeouts, the system messages and the debug hooks; your module supplies only the callbacks that describe YOUR logic. You are writing the interesting 5% and inheriting 30 years of battle-tested plumbing.",
      "The mechanics are simple: `@callback name(arg :: type) :: return_type` declares the contract, `@behaviour Mod` opts in, `@impl true` marks each implementation (and makes the compiler catch typos in callback names — always use it).",
      "Behaviours also give you swappable adapters, which is how you make code testable. Declare a behaviour for your payment gateway, implement a real one and a fake one, and select between them in config. No mocking library required.",
    ],
    diagram: `flowchart TB
  subgraph two["the two dispatch mechanisms"]
    direction LR
    pr["PROTOCOL — dispatches on DATA<br/>defimpl X, for: SomeStruct<br/>Enumerable, Inspect, Jason"]:::hot
    bh["BEHAVIOUR — dispatches on MODULE<br/>@behaviour X plus @impl true<br/>GenServer, Supervisor, Plug, Ecto.Repo"]:::ok
  end
  two --> contract["defmodule Gateway do<br/>  @callback charge(map) :: {:ok, map} ¦ {:error, term}<br/>  @callback refund(String.t) :: :ok<br/>end<br/><br/>THE CONTRACT: charge/1 and refund/1"]:::code
  contract --> real["Stripe — @behaviour Gateway"]:::ok
  contract --> fake["FakePay — @behaviour Gateway, the test double"]:::warn
  real --> swap["config :app, :gateway, Stripe<br/>Application.get_env(:app, :gateway).charge(%{})<br/>⇒ swap the implementation by CONFIGURATION"]:::hot
  fake --> swap
  swap --> otp["WHY OTP IS A BEHAVIOUR<br/>GenServer gives you the receive loop, timeouts, hibernate,<br/>system messages, tracing, error reports, code upgrade<br/>YOU give init/1, handle_call/3, handle_cast/2 …"]:::muted`,
    takeaway:
      "Behaviour = a module-level contract. All of OTP is behaviours you fill in.",
  },
  codeSamples: [
    {
      title: "Declare a behaviour",
      note: "",
      code: `defmodule Gateway do
  @callback charge(map()) :: {:ok, map()} | {:error, term()}
  @callback refund(String.t()) :: :ok | {:error, term()}
  @optional_callbacks refund: 1
end

defmodule FakeGateway do
  @behaviour Gateway

  @impl true
  def charge(%{amount: a}) when a > 0, do: {:ok, %{id: "ch_fake", amount: a}}
  def charge(_), do: {:error, :invalid_amount}

  @impl true
  def refund(_id), do: :ok
end

FakeGateway.charge(%{amount: 500})
FakeGateway.charge(%{amount: 0})`,
    },
    {
      title: "See the compiler enforce it",
      note: "Paste this and read the warning.",
      code: `defmodule BrokenGateway do
  @behaviour Gateway
  # charge/1 is missing on purpose
  @impl true
  def refund(_), do: :ok
end
# warning: function charge/1 required by behaviour Gateway is not implemented`,
    },
    {
      title: "Swappable adapters = free test doubles",
      note: "",
      code: `defmodule Payments do
  defp impl, do: Application.get_env(:my_app, :gateway, FakeGateway)
  def charge(attrs), do: impl().charge(attrs)
end

Payments.charge(%{amount: 999})
# in config/test.exs:  config :my_app, :gateway, FakeGateway
# in config/prod.exs:  config :my_app, :gateway, StripeGateway`,
    },
    {
      title: "Inspect a real behaviour",
      note: "Look at the contract you will fill in next module.",
      code: `GenServer.behaviour_info(:callbacks)
GenServer.behaviour_info(:optional_callbacks)
Supervisor.behaviour_info(:callbacks)`,
    },
  ],
};
