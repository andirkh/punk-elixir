export default {
  front:
    "Before writing any file, where do you try Elixir ideas out — and how do you get out when you make a mistake?",
  back: "`iex` is the interactive shell. Type expressions, get values. `h Enum.map` shows docs, `i value` inspects a value's type, `recompile()` reloads your project, and `Ctrl+C` twice (or `Ctrl+\\`) exits. Inside a Mix project you use `iex -S mix` so all your modules and dependencies are loaded.",
  philosophy: {
    lead: "Elixir is a REPL-first language. The shell is not a toy; it is a live window into a running system — including a production one.",
    body: [
      "In most languages the REPL is where you test snippets. On the BEAM, the shell is a process like any other, attached to a live node. You can connect to a running production server and inspect its state, call functions, even hot-load new code. That is why we start here: every card in this deck is meant to be pasted into iex and felt, not just read.",
      "Three helpers will carry you the whole way. `h` gives you documentation, because Elixir docs are data stored in the compiled bytecode. `i` tells you what a value actually is — invaluable while your intuition for types is forming. And multi-line input just works: iex waits for you to close the expression.",
      "Get comfortable here. When you later debug a GenServer or a database query, you will do it from exactly this prompt.",
    ],
    diagram: `flowchart TB
  kb["your keyboard"]:::muted --> prompt["iex prompt"]:::hot
  prompt -->|evaluates in a REAL BEAM process| node["a running node<br/>your app · your deps · your live state"]:::ok
  node -->|the value comes back| prompt
  helpers["h Enum.map — documentation<br/>i #quot;hi#quot; — type info<br/>recompile() — reload the project<br/>v(3) — reuse result number 3<br/>Ctrl+C Ctrl+C — quit<br/>#iex:break — escape bad input"]:::code
  node ~~~ helpers`,
    takeaway: "If you cannot paste it into iex, you do not understand it yet.",
  },
  codeSamples: [
    {
      title: "First contact",
      note: "Type `iex` in your terminal and paste these one at a time.",
      code: `1 + 1
"hello" <> " world"
h Enum.map
i :an_atom
i "a string"`,
    },
    {
      title: "Multi-line + history",
      note: "iex keeps evaluating until the expression is complete.",
      code: `total =
  [1, 2, 3]
  |> Enum.map(fn n -> n * 10 end)
  |> Enum.sum()

v()      # the last value
v(1)     # the value of line 1`,
    },
    {
      title: "Escape hatches",
      note: "When iex is stuck waiting for a closing quote or bracket.",
      code: `# type this and press enter to abort a broken expression:
#iex:break

# clear the screen
clear()

# exit iex:  press Ctrl+C twice`,
    },
  ],
};
