// Design token system ("civic ledger"): light mode reads like Stripe
// (paper surfaces, restrained indigo accent, soft hero gradient reserved
// for the landing page only); dark mode reads like Snapshot/Etherscan
// (near-black chrome, data-dense, disciplined single accent). Both modes
// share the same *roles* (bg/surface/border/text/accent/confirmed/
// pending/danger) at different values, defined as CSS custom properties
// in src/index.css under :root and .dark — see that file for the actual
// hex values and rationale per role. Using the rgb(var(...) / <alpha>)
// pattern (not raw hex) so Tailwind's opacity modifiers (e.g. bg-accent/10)
// keep working against theme-driven colors.
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--color-bg) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        ink: "rgb(var(--color-text) / <alpha-value>)",
        muted: "rgb(var(--color-text-muted) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          foreground: "rgb(var(--color-accent-foreground) / <alpha-value>)",
        },
        confirmed: {
          DEFAULT: "rgb(var(--color-confirmed) / <alpha-value>)",
          subtle: "rgb(var(--color-confirmed-subtle) / <alpha-value>)",
        },
        pending: {
          DEFAULT: "rgb(var(--color-pending) / <alpha-value>)",
          subtle: "rgb(var(--color-pending-subtle) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
          subtle: "rgb(var(--color-danger-subtle) / <alpha-value>)",
        },
      },
      fontFamily: {
        // Display: Fraunces — soft-serif with real character, used for
        // election titles / headlines only, never body text (skill
        // guidance: "used with restraint").
        display: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
        // Body/UI: Public Sans — USWDS's own typeface (the U.S. federal
        // government's digital design system), a deliberate, subject-
        // grounded choice for a civic voting product rather than a
        // generic grotesk default.
        sans: ['"Public Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        // Mono: IBM Plex Mono — genuinely functional, not decorative:
        // wallet addresses, tx hashes, block numbers, and vote counts
        // are real chain data and are always set in this face throughout
        // the app, never dressed up as regular body text.
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      backgroundImage: {
        // The one deliberate hero treatment (Stripe-like soft diagonal
        // wash) — landing page hero only. Dark mode intentionally has no
        // equivalent; see index.css's rationale comment.
        "hero-wash":
          "linear-gradient(115deg, rgb(var(--color-hero-a)) 0%, rgb(var(--color-hero-b)) 45%, rgb(var(--color-hero-c)) 100%)",
      },
    },
  },
  plugins: [],
};
