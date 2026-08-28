export default {
  front:
    "`expected = 200` then `^expected = status`. What does the caret change?",
  back: "Without `^`, a variable on the left of `=` is REBOUND. With `^` it is **pinned** — its current value is used as a literal to match against. `^expected = status` means 'assert status equals 200'. You will need this constantly in `case`, function guards, and especially Ecto queries.",
  philosophy: {
    lead: "Since a bare name on the left always binds, Elixir needs one explicit symbol for the opposite intention: compare, do not rebind.",
    body: [
      "This tiny operator prevents a whole class of silent bugs. Imagine matching `case resp do {:ok, status} -> ...` when you meant to check a specific status — without the pin you would happily rebind `status` to anything and your check would always pass. The caret makes the intention visible in the code.",
      "It matters far beyond toy examples. When you write Ecto queries against Postgres, `where: u.id == ^user_id` uses the pin to mean 'take the value from Elixir and send it as a bound SQL parameter'. That is not decoration — it is what makes your queries injection-safe. Every value you interpolate into a query gets pinned, and Ecto turns it into `$1` in the SQL.",
      "So: caret means 'this value comes from outside, use it as data'. Hold that meaning; it returns in card 83.",
    ],
    diagram: `flowchart TB
  start["expected = 200"]:::muted
  start --> nopin["expected = 404"]:::warn
  start --> pin1["^expected = 404"]:::hot
  start --> pin2["^expected = 200"]:::hot
  nopin --> r1["REBIND — expected is now 404<br/>no error, no warning"]:::bad
  pin1 --> r2["MATCH — 200 vs 404<br/>⇒ MatchError ✓"]:::ok
  pin2 --> r3["MATCH — ok ✓"]:::ok
  r3 --> uses["WHERE YOU ACTUALLY NEED IT<br/><br/>case — match against a value you already computed<br/>Ecto — from u in User, where: u.id == ^user_id<br/>becomes SELECT ... WHERE id = $1 — a bound parameter<br/>this is why Ecto is SQL-injection safe by default"]:::code`,
    takeaway:
      "^ means compare with the existing value instead of rebinding it.",
  },
  codeSamples: [
    {
      title: "Rebind vs pin",
      note: "",
      code: `expected = 200

expected = 404       # rebinds! no error
expected             # 404

expected = 200
# ^expected = 404    # ** (MatchError)
^expected = 200      # ok`,
    },
    {
      title: "Pin inside case",
      note: "The bug the pin exists to prevent.",
      code: `allowed_status = 200
resp = {:ok, 500}

case resp do
  {:ok, ^allowed_status} -> "great"
  {:ok, other}           -> "unexpected status #{other}"
  {:error, r}            -> "boom #{inspect(r)}"
end`,
    },
    {
      title: "Preview: pin in Ecto",
      note: "You will write this in card 83. Same operator, same meaning.",
      code: `# import Ecto.Query
# user_id = 42
# from u in "users", where: u.id == ^user_id, select: u.email
#
# generated SQL:  SELECT u0."email" FROM "users" AS u0 WHERE (u0."id" = $1)
# params: [42]    ← never string-interpolated, never injectable`,
    },
  ],
};
