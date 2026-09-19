import type { Config } from "tailwindcss";

/** A colour token from `src/index.css`, with Tailwind's opacity modifier support. */
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: rgb("ground"),
        side: rgb("side"),
        panel: rgb("panel"),
        well: rgb("well"),
        hover: "rgb(var(--hover) / 0.06)",
        ink: rgb("ink"),
        muted: rgb("muted"),
        dim: rgb("dim"),
        line: rgb("line"),
        "line-strong": rgb("line-strong"),
        accent: rgb("accent"),
        "accent-hover": rgb("accent-hover"),
        "accent-soft": rgb("accent-soft"),
        "accent-ink": rgb("accent-ink"),
        "accent-line": rgb("accent-line"),
        ok: rgb("ok"),
        "ok-soft": rgb("ok-soft"),
        warn: rgb("warn"),
        "warn-strong": rgb("warn-strong"),
        "warn-soft": rgb("warn-soft"),
        danger: rgb("danger"),
        "danger-soft": rgb("danger-soft"),
        inverse: rgb("inverse"),
        "inverse-fg": rgb("inverse-fg"),
        canvas: rgb("canvas"),
      },
      fontFamily: {
        sans: ['"Instrument Sans Variable"', '"Segoe UI"', "system-ui", "sans-serif"],
      },
      borderRadius: { md: "7px", lg: "10px" },
      boxShadow: {
        float: "0 1px 2px rgb(0 0 0 / 0.06), 0 12px 32px -12px rgb(31 34 29 / 0.35)",
      },
      transitionDuration: { 140: "140ms", 180: "180ms", 220: "220ms" },
      transitionTimingFunction: { out: "var(--ease-out)" },
      keyframes: {
        reveal: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        pop: {
          from: { opacity: "0", transform: "scale(.97)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "none" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".35" },
        },
      },
      animation: {
        reveal: "reveal 180ms var(--ease-out) both",
        pop: "pop 220ms var(--ease-out) both",
        "slide-in": "slide-in 220ms var(--ease-out) both",
        shimmer: "shimmer 1.4s linear infinite",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
