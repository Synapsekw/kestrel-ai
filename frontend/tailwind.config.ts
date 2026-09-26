import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

/** An opaque token from `src/index.css`, with Tailwind's opacity modifier support. */
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
/** A translucent token: a complete rgba() value. It takes no opacity modifier (check-tokens). */
const raw = (name: string) => `var(--${name})`;

export default {
  content: ["./index.html", "./gallery.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: rgb("bg"),
        surface: raw("surface"),
        "surface-2": raw("surface-2"),
        field: raw("field"),
        hover: raw("hover"),
        rail: raw("rail"),
        glass: raw("glass"),
        "glass-line": raw("glass-line"),
        "glass-ink": rgb("glass-ink"),
        "glass-solid": rgb("glass-solid"),
        line: raw("line"),
        "line-strong": raw("line-strong"),
        "card-line": raw("card-line"),
        "control-line": rgb("control-line"),
        ink: rgb("ink"),
        muted: rgb("muted"),
        dim: rgb("dim"),
        accent: rgb("accent"),
        "accent-ink": rgb("accent-ink"),
        "accent-fg": rgb("accent-fg"),
        "accent-soft": raw("accent-soft"),
        ok: rgb("ok"),
        "ok-soft": raw("ok-soft"),
        danger: rgb("danger"),
        "danger-soft": raw("danger-soft"),
        warn: rgb("warn"),
        "warn-soft": raw("warn-soft"),
        info: rgb("info"),
        tip: rgb("tip"),
        "tip-fg": rgb("tip-fg"),
      },
      backgroundImage: {
        "grad-primary": "var(--grad-primary)",
        "grad-brand": "var(--grad-brand)",
        "grad-ink": "var(--grad-ink)",
        "grad-ai": "var(--grad-ai)",
      },
      fontFamily: {
        sans: ['"Space Grotesk Variable"', '"Segoe UI"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "Consolas", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["10.5px", { lineHeight: "14px", fontWeight: "500" }],
        xs: ["11.5px", { lineHeight: "16px", fontWeight: "500" }],
        sm: ["12.5px", { lineHeight: "18px" }],
        base: ["13.5px", { lineHeight: "20px" }],
        lg: ["16px", { lineHeight: "22px", fontWeight: "600" }],
        xl: ["20px", { lineHeight: "26px", fontWeight: "600" }],
        kpi: ["30px", { lineHeight: "33px", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      borderRadius: {
        panel: "var(--r-panel)",
        control: "var(--r-control)",
        chip: "var(--r-chip)",
        sm: "var(--r-sm)",
        // Contour aliases, kept so screens compile until SH restyles them.
        md: "var(--r-control)",
        lg: "var(--r-panel)",
      },
      boxShadow: {
        "elev-1": "var(--elev-1)",
        "elev-2": "var(--elev-2)",
        glow: "var(--glow-primary)",
        // Contour alias for floating surfaces.
        float: "var(--elev-2)",
      },
      transitionDuration: {
        instant: "var(--dur-instant)",
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
        emphasis: "var(--dur-emphasis)",
        count: "var(--dur-count)",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
        spring: "var(--ease-spring)",
        "in-out": "var(--ease-in-out)",
      },
      keyframes: {
        reveal: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "none" },
        },
        fade: { from: { opacity: "0" }, to: { opacity: "1" } },
        pop: {
          from: { opacity: "0", transform: "scale(.97)" },
          to: { opacity: "1", transform: "none" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "none" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: ".3" },
        },
      },
      animation: {
        reveal: "reveal var(--dur-base) var(--ease-out) backwards",
        rise: "rise var(--dur-slow) var(--ease-out) backwards",
        fade: "fade var(--dur-base) var(--ease-in-out) backwards",
        pop: "pop var(--dur-slow) var(--ease-out) backwards",
        "slide-in": "slide-in var(--dur-slow) var(--ease-out) backwards",
        // A loop: only on something that is running (StatusDot live, Pill live).
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      // The Settings "Reduce motion" override (<html data-motion="reduced">) joins the media query.
      // Tailwind 3.4 registers its own built-in `motion-reduce` variant after user plugins, so
      // redefining that name here has no effect (controller ruling 2026-09-26). This is a NEW
      // variant, `reduce-motion:`, that every new class uses; Task 2 renames existing
      // `motion-reduce:` uses to it.
      addVariant("reduce-motion", [
        "@media (prefers-reduced-motion: reduce)",
        ':root[data-motion="reduced"] &',
      ]);
    }),
  ],
} satisfies Config;
