/* ------------------------------------------------------------------
   Tailwind, configured for the design system.

   The CDN build reads window.tailwind.config, so this is a classic
   script, not a module: it has to run straight after the CDN <script>
   and before the app renders. No build step: the browser is the
   compiler, and these are the colours it compiles against.
   ------------------------------------------------------------------ */
/* Colors lifted from the shared design system (Booking / self-checkin). */
tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Noto Sans",
          "Noto Sans JP",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      fontSize: {
        header1: "24px",
        header2: "20px",
        header3: "18px",
        body: "16px",
        caption: "14px",
        footnote: "12px",
      },
      boxShadow: {
        shadow1: "1px 0px 8px #00000029",
        dropdownShadow: "0px 1px 16px 0px rgba(158, 159, 191, 0.16)",
        cardShadow: "0px 0px 20px 4px rgba(191, 191, 191, 0.25)",
        cardInfo: "0px 1px 4px 0px #9E9FBF29",
      },
      colors: {
        primary: {
          100: "#D0EAF5",
          200: "#A4D3EC",
          300: "#6BA3C6",
          400: "#3D6A8E",
          500: "#102A43",
          600: "#0B2039",
          700: "#081830",
          800: "#051126",
          DEFAULT: "#102A43",
        },
        secondary: {
          100: "#FAFDFF",
          200: "#F5FBFF",
          300: "#F0F9FF",
          400: "#EDF6FF",
          500: "#E7F3FF",
          600: "#A8BFDB",
          700: "#748FB7",
          800: "#496393",
          DEFAULT: "#E7F3FF",
        },
        punkPrimary: {
          100: "#EFF0FF",
          200: "#C6C9FF",
          300: "#878EFF",
          400: "#525DFF",
          500: "#312DFF",
          600: "#2420CC",
          700: "#1A187D",
          800: "#0F0E42",
          DEFAULT: "#312DFF",
        },
        alert: {
          deletedBg: "#CE3504",
          succeedBg: "#298000",
          warningBg: "#FFD02B",
          succeedBgLight: "#DEF2D5",
          warningBgLight: "#FCF4D8",
          warningIcon: "#DB7600",
          greyBg: "#565768",
        },
        error: { error: "#CE3504", errorShade: "#B92D00", errorbg: "#FEE1DD" },
        neutrals: {
          greyDisabled: "#CAD0DD",
          grey: "#9E9FBF",
          greyTableBorder: "#DCE2F2",
          greybg: "#F8F9FB",
          black: "#2C2C2C",
          lightBlue: "#D7EFFF",
          white: "#FFFFFF",
          azure: "#01588D",
          pureBlack: "#000000",
          mediumBlue: "#312DFF",
          cardHover: "rgb(215, 239, 255, 50%)",
          lightGrey: "#102A43",
          secondaryBlue: "#E7F3FF",
          yellow: "#FFD815",
          lightYellow: "#FCF4D8",
          red: "#DD2F39",
          greyDark: "#69697A",
          hawkesBlue: "#D5DDEA",
          aliceBlue: "#FDFEFF",
          solitude: "#ECF0F5",
        },
        azure: {
          100: "#D7EFFF",
          200: "#9AD8FE",
          300: "#5DC0FD",
          400: "#10A3FD",
          500: "#028ADE",
          600: "#0271B6",
          700: "#01588D",
        },
      },
    },
  },
};
