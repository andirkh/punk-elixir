export default {
  front:
    "Untrusted params arrive from the internet. What stands between them and your database, and what are its two distinct jobs?",
  back: "An `Ecto.Changeset`. Job one: **cast** — take a map with string keys, keep only whitelisted fields, convert them to the schema's types, and record type failures. Job two: **validate** — apply your rules and constraints. The result carries `changes`, `errors`, `valid?` and the original `data`, so a failed changeset is a complete description of what went wrong and can be rendered back to the client.",
  philosophy: {
    lead: "The changeset is the trust boundary from card 10, made concrete: string-keyed chaos in, typed and validated changes out.",
    body: [
      'The whitelist in `cast/3` is a security control, not a convenience. Any field you do not list is dropped, so a client cannot set `role: "admin"` or `balance: 999999` by adding it to the JSON body. Mass-assignment vulnerabilities are structurally impossible if you list fields explicitly — never build that list from the params themselves.',
      "The `validate_*` vs `*_constraint` distinction is genuinely important. Validations run in Elixir before the query and are cheap. Constraints (`unique_constraint`, `foreign_key_constraint`, `check_constraint`) do not run anything — they translate a Postgres error into a friendly changeset error when the insert fails. You need both: only the database can guarantee uniqueness under concurrency, and only a validation can give fast feedback.",
      "Because a changeset is data, you can build them in pipelines, have different changesets for different operations (`registration_changeset`, `password_changeset`, `admin_changeset`), and pass them into `Ecto.Multi` for transactional work. That composability is why Ecto separates 'describe the change' from 'apply the change'.",
    ],
    diagram: `flowchart TB
  raw["%{'email' =&gt; 'A@B.COM ', 'role' =&gt; 'admin', 'hack' =&gt; 1}<br/>UNTRUSTED"]:::bad
  raw -->|"cast(schema, params, [:email, :password]) — a WHITELIST"| f1
  subgraph cs["%Ecto.Changeset{}"]
    direction TB
    f1["data: %User{} — the original"]:::code
    f2["changes: %{email: 'a@b.com'} — only cast AND changed fields"]:::code
    f3["errors: [password: {'can't be blank', …}]"]:::code
    f4["valid?: false"]:::code
    f5["action: nil ¦ :insert ¦ :update"]:::code
    f1 ~~~ f2 ~~~ f3 ~~~ f4 ~~~ f5
  end
  f5 --> dropped["'role' and 'hack' were DROPPED ✓<br/>mass assignment is not a thing you can accidentally do"]:::ok
  dropped --> val["VALIDATIONS — in Elixir, before the query, so feedback is fast<br/>validate_required · validate_format · validate_length<br/>validate_number · validate_inclusion / exclusion · validate_change<br/>validate_confirmation · update_change · put_change · delete_change"]:::hot
  val --> con["CONSTRAINTS — translate a Postgres error into a FIELD error<br/>unique_constraint(:email)         ← ONLY the database can guarantee this<br/>foreign_key_constraint(:user_id) · check_constraint(:total_cents, …)<br/>⇒ needs the matching unique_index / constraint in a migration"]:::warn
  con --> out["Repo.insert(changeset) ⇒ {:ok, %User{}} ¦ {:error, %Changeset{}}<br/>which goes straight into with + action_fallback"]:::ok`,
    takeaway:
      "cast whitelists and types; validate checks in Elixir; constraints translate database errors.",
  },
  codeSamples: [
    {
      title: "A registration changeset",
      note: "Every technique in one place.",
      code: `defmodule Shop.Accounts.User do
  use Ecto.Schema
  import Ecto.Changeset

  schema "users" do
    field :email, :string
    field :role, Ecto.Enum, values: [:member, :admin], default: :member
    field :password_hash, :string, redact: true
    field :password, :string, virtual: true, redact: true
    field :password_confirmation, :string, virtual: true, redact: true
    timestamps(type: :utc_datetime_usec)
  end

  def registration_changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :password, :password_confirmation])   # :role NOT listed
    |> validate_required([:email, :password])
    |> update_change(:email, &String.downcase/1)
    |> update_change(:email, &String.trim/1)
    |> validate_format(:email, ~r/^[^@\\s]+@[^@\\s]+$/, message: "must be a valid email")
    |> validate_length(:email, max: 160)
    |> validate_length(:password, min: 12, max: 72)
    |> validate_confirmation(:password, message: "does not match")
    |> hash_password()
    |> unique_constraint(:email)          # needs a unique_index in a migration
  end

  # a SEPARATE changeset for privileged changes — never merged with the above
  def admin_changeset(user, attrs) do
    user |> cast(attrs, [:role]) |> validate_inclusion(:role, [:member, :admin])
  end

  defp hash_password(%{valid?: true, changes: %{password: pw}} = cs) do
    put_change(cs, :password_hash, "hashed:" <> Base.encode16(:crypto.hash(:sha256, pw)))
  end
  defp hash_password(cs), do: cs
end`,
    },
    {
      title: "Inspect changesets in iex",
      note: "No database needed — changesets are pure data.",
      code: `alias Shop.Accounts.User

cs = User.registration_changeset(%User{}, %{
  "email" => "  ADA@Example.com ",
  "password" => "correcthorsebattery",
  "password_confirmation" => "correcthorsebattery",
  "role" => "admin"          # ← ignored, not in the cast whitelist
})

cs.valid?
cs.changes                   # note: no :role ✓
cs.errors

bad = User.registration_changeset(%User{}, %{"email" => "nope", "password" => "short"})
bad.valid?
bad.errors
Ecto.Changeset.traverse_errors(bad, fn {msg, _} -> msg end)`,
    },
    {
      title: "Custom validations",
      note: "validate_change is the general escape hatch.",
      code: `import Ecto.Changeset

defmodule Validations do
  import Ecto.Changeset

  def validate_not_disposable(changeset, field) do
    validate_change(changeset, field, fn ^field, value ->
      domain = value |> to_string() |> String.split("@") |> List.last()
      if domain in ["mailinator.com", "tempmail.io"] do
        [{field, "disposable email addresses are not allowed"}]
      else
        []
      end
    end)
  end

  def validate_business_hours(changeset, field) do
    validate_change(changeset, field, fn ^field, %DateTime{} = dt ->
      if dt.hour in 9..17, do: [], else: [{field, "must be during business hours"}]
    end)
  end
end

%Shop.Accounts.User{}
|> cast(%{"email" => "x@mailinator.com"}, [:email])
|> Validations.validate_not_disposable(:email)
|> Map.get(:errors)`,
    },
    {
      title: "Constraints need the index to exist",
      note: "The failure mode is worth seeing once.",
      code: `# migration:
#   create unique_index(:users, [:email])

# WITH unique_constraint(:email) in the changeset:
# {:error, changeset} with errors: [email: {"has already been taken", ...}]  ✓

# WITHOUT it, Repo.insert raises:
# ** (Ecto.ConstraintError) constraint error when attempting to insert struct:
#     * users_email_index (unique_constraint)
#   You need to add the constraint to your changeset.

# same for references:
# |> foreign_key_constraint(:user_id)
# |> check_constraint(:total_cents, name: :total_non_negative,
#                     message: "must be zero or more")`,
    },
  ],
};
