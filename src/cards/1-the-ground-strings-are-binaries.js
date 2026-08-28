export default {
  front:
    '`"héllo"` — what is `byte_size/1` versus `String.length/1`, and why are there two answers?',
  back: 'An Elixir string is a **binary**: a contiguous chunk of UTF-8 encoded bytes, written between double quotes. `byte_size("héllo")` is 6 because `é` takes two bytes; `String.length("héllo")` is 5 because it counts graphemes. Single quotes make a *charlist* (a list of codepoints) which you only need when talking to old Erlang libraries.',
  philosophy: {
    lead: "Elixir chose one string representation and made it the same thing the network and the disk speak: bytes.",
    body: [
      "Because a string is just a binary, the exact same value flows from a TCP socket, through your JSON decoder, into Postgres, and back out — with no conversion layer. That is a quiet but enormous win for a backend language. The `<>` operator concatenates binaries, and `<<>>` lets you pattern-match raw bytes, which is how people write protocol parsers in Elixir in twenty lines.",
      "The two size functions exist because bytes and human characters are genuinely different questions. Anything user-facing (truncating a bio, counting a tweet) uses the `String` module, which is Unicode-aware. Anything about storage or transport uses `byte_size`.",
      "Also: string concatenation in a loop is a trap in any language. Elixir's answer is the **iolist** — a nested list of binaries that the VM writes out without ever flattening it. Phoenix renders every HTML page this way. You will meet iolists again when we build responses.",
    ],
    diagram: `flowchart TB
  subgraph bin["#quot;héllo#quot; is a binary — 6 BYTES, 5 GRAPHEMES"]
    direction LR
    b1["68<br/>h"]:::code --> b2["C3"]:::warn --> b3["A9"]:::warn --> b4["6C<br/>l"]:::code --> b5["6C<br/>l"]:::code --> b6["6F<br/>o"]:::code
  end
  bin --> sizes["byte_size = 6 · String.length = 5<br/>é is TWO bytes, ONE grapheme"]:::hot
  forms["#quot;hi#quot; &lt;&gt; #quot; there#quot; — concatenate<br/>&lt;&lt;104, 105&gt;&gt; — the same thing, raw<br/>'hi' — a charlist [104,105], Erlang interop only"]:::code
  sizes ~~~ forms
  forms --> iolist["IOLIST — build output without copying<br/>[#quot;&lt;h1&gt;#quot;, name, #quot;&lt;/h1&gt;#quot;]<br/>the socket writes the parts in place"]:::ok`,
    takeaway:
      "Strings are UTF-8 binaries. String.* for humans, byte_size for wires.",
  },
  codeSamples: [
    {
      title: "Two kinds of length",
      note: "",
      code: `s = "héllo"
byte_size(s)       # 6
String.length(s)   # 5
String.upcase(s)
String.slice(s, 0, 3)
String.split("a,b,c", ",")`,
    },
    {
      title: "Interpolation & concatenation",
      note: "",
      code: `name = "Ada"
"hello #{name}, you are #{1815 + 200 - 1815} years old"
"hello " <> name

# multiline / heredoc
"""
Dear #{name},
  welcome to the BEAM.
"""`,
    },
    {
      title: "Binaries are bytes you can match",
      note: "This is how protocol parsers are written.",
      code: `<<first::binary-size(1), rest::binary>> = "hello"
first   # "h"
rest    # "ello"

# is this a PNG file?
png = <<137, 80, 78, 71, 0, 0>>
match?(<<137, "PNG", _rest::binary>>, png)   # true`,
    },
    {
      title: "iolists — cheap output",
      note: "Never build big strings with <> in a loop.",
      code: `parts = ["<ul>", Enum.map(1..3, fn i -> ["<li>", to_string(i), "</li>"] end), "</ul>"]
IO.iodata_to_binary(parts)
IO.puts(parts)     # the VM writes it without flattening`,
    },
  ],
};
