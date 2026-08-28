export default {
  front:
    "Sending a welcome email must not block the signup response. You could `Task.start/1`. Why is that wrong for anything that matters?",
  back: "Because a bare Task lives only in memory: a deploy, a crash or a node restart loses the job silently, and there is no retry, no visibility and no rate control. Use a supervised `Task.Supervisor` for genuinely disposable work, and a **persistent queue** — `Oban`, backed by your existing Postgres — for anything a user would notice going missing. Durable jobs are a database problem, not a process problem.",
  philosophy: {
    lead: "Elixir makes it so easy to do work in the background that the real question becomes: what happens to this work if the machine disappears right now?",
    body: [
      "Answer honestly per job. A cache warm can be lost. A metrics ping can be lost. A payment capture, a webhook delivery, a welcome email cannot. For the first group, `Task.Supervisor.start_child/2` is perfect: supervised, traceable, cleaned up on shutdown. For the second, the job must be written to durable storage before you reply to the user.",
      "Oban is the standard answer in Elixir and its design is worth understanding: jobs are rows in a Postgres table, inserted inside the SAME transaction as your business data. That single fact eliminates the classic distributed-systems bug where you commit an order and then fail to enqueue its confirmation email — with Oban both happen or neither does. Retries with backoff, uniqueness, cron scheduling and a queryable job table follow naturally from being rows.",
      "For periodic work you now have three options and should pick deliberately: a self-rescheduling GenServer (card 41) for in-memory, per-node tasks; Oban Cron for durable, once-per-cluster jobs; and a plain `Task` under a supervisor for one-off fire-and-forget. Running a naive GenServer timer on three nodes means the job runs three times — a real and common bug.",
    ],
    diagram: `flowchart TB
  q{"is losing this job<br/>acceptable?"}:::hot
  q -->|yes| tsk["Task.Supervisor.start_child/2<br/>supervised, in memory<br/>lost on restart"]:::warn
  q -->|no| oban["Oban — rows in YOUR Postgres"]:::ok
  oban --> tx["Multi.new()<br/>¦&gt; Multi.insert(:order, changeset)<br/>¦&gt; Oban.insert(:email, EmailWorker.new(%{…}))<br/>¦&gt; Repo.transaction()<br/><br/>⇒ the order AND the job commit together, or neither does ✓"]:::code
  tx --> tbl["oban_jobs<br/>id ¦ queue   ¦ worker       ¦ state     ¦ attempt ¦ max<br/>1  ¦ mailers ¦ WelcomeEmail ¦ available ¦ 0       ¦ 20<br/>2  ¦ default ¦ SyncStock    ¦ executing ¦ 1       ¦ 3<br/>3  ¦ mailers ¦ Receipt      ¦ retryable ¦ 2       ¦ 20<br/>4  ¦ default ¦ Report       ¦ completed ¦ 1       ¦ 3"]:::code
  tbl --> props["queryable · retried with backoff · unique · cron · observable<br/>because it is just a table you already know how to inspect"]:::ok
  props --> per["PERIODIC WORK — pick deliberately<br/>GenServer + send_after — per node, in memory ⚠ runs N times on N nodes<br/>Oban.Plugins.Cron       — once per CLUSTER, durable ✓<br/>Task under a supervisor — one-off, fire and forget"]:::warn`,
    takeaway:
      "Disposable work goes to a supervised Task. Work that must not be lost goes into Postgres in the same transaction.",
  },
  codeSamples: [
    {
      title: "Supervised fire-and-forget",
      note: "The floor: never use a bare spawn or Task.start.",
      code: `# in application.ex children:
#   {Task.Supervisor, name: Shop.TaskSupervisor}

Task.Supervisor.start_child(Shop.TaskSupervisor, fn ->
  Shop.Analytics.ping(%{event: "signup", user_id: 1})
end)

# with the caller protected from a crash:
Task.Supervisor.async_nolink(Shop.TaskSupervisor, fn ->
  raise "third party is down"
end)

# how many background tasks are running right now?
Task.Supervisor.children(Shop.TaskSupervisor) |> length()`,
    },
    {
      title: "Oban setup and a worker",
      note: 'deps: {:oban, "~> 2.17"} — then a migration and this.',
      code: `# config/config.exs
config :shop, Oban,
  repo: Shop.Repo,
  queues: [default: 10, mailers: 20, imports: 2],
  plugins: [
    {Oban.Plugins.Pruner, max_age: 60 * 60 * 24 * 7},
    {Oban.Plugins.Cron,
     crontab: [
       {"0 3 * * *", Shop.Workers.NightlyReport},
       {"*/15 * * * *", Shop.Workers.SyncInventory}
     ]}
  ]

# application.ex children:  {Oban, Application.fetch_env!(:shop, Oban)}

defmodule Shop.Workers.WelcomeEmail do
  use Oban.Worker,
    queue: :mailers,
    max_attempts: 5,
    unique: [period: 3600, fields: [:worker, :args]]

  @impl Oban.Worker
  def perform(%Oban.Job{args: %{"user_id" => user_id}, attempt: attempt}) do
    case Shop.Accounts.get_user(user_id) do
      nil -> {:cancel, :user_deleted}          # never retry
      user ->
        case Shop.Mailer.send_welcome(user) do
          :ok -> :ok
          {:error, :rate_limited} -> {:snooze, 60}    # try again in 60s
          {:error, reason} when attempt < 5 -> {:error, reason}   # retry w/ backoff
          {:error, reason} -> {:cancel, reason}
        end
    end
  end

  # custom backoff: 1s, 4s, 9s, 16s …
  @impl Oban.Worker
  def backoff(%Oban.Job{attempt: attempt}), do: attempt * attempt
end`,
    },
    {
      title: "Enqueue inside the same transaction",
      note: "This is the whole reason to use a database-backed queue.",
      code: `alias Ecto.Multi
alias Shop.{Repo, Accounts.User, Workers.WelcomeEmail}

Multi.new()
|> Multi.insert(:user, User.registration_changeset(%User{}, attrs))
|> Oban.insert(:welcome_email, fn %{user: user} ->
     WelcomeEmail.new(%{user_id: user.id})
   end)
|> Multi.run(:audit, fn _repo, %{user: u} -> {:ok, "created #{u.id}"} end)
|> Repo.transaction()

# if the insert fails, NO email job exists.
# if the email job insert fails, NO user exists.
# there is no window where one happened without the other. ✓

# standalone enqueue:
%{user_id: 1} |> WelcomeEmail.new() |> Oban.insert()

# scheduled for later:
%{user_id: 1} |> WelcomeEmail.new(schedule_in: {2, :hours}) |> Oban.insert()

# bulk:
jobs = for id <- 1..1_000, do: WelcomeEmail.new(%{user_id: id})
Oban.insert_all(jobs)`,
    },
    {
      title: "Observe and operate the queue",
      note: "It is a table, so you can just query it.",
      code: `import Ecto.Query
alias Shop.Repo

# jobs by state
from(j in "oban_jobs", group_by: j.state, select: {j.state, count(j.id)}) |> Repo.all()

# what is failing, and why
from(j in "oban_jobs",
  where: j.state in ["retryable", "discarded"],
  select: %{worker: j.worker, attempt: j.attempt, errors: j.errors},
  limit: 20
) |> Repo.all()

# queue depth right now
Oban.check_queue(queue: :mailers)

# operational controls
Oban.pause_queue(queue: :mailers)
Oban.resume_queue(queue: :mailers)
Oban.retry_all_jobs(from j in Oban.Job, where: j.state == "discarded")
Oban.drain_queue(queue: :mailers)      # run everything now — great in tests`,
    },
  ],
};
