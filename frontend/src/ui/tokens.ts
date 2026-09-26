/**
 * Shared class fragments for the ui components. This is the only file allowed to name raw Tailwind
 * palette colours (it names none today; `scripts/check-tokens.mjs` enforces that everywhere else).
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

export const transition =
  "transition-[background-color,border-color,color,transform,box-shadow,opacity] duration-fast ease-out reduce-motion:transition-none";

export const pressable = "active:scale-[.98] reduce-motion:active:scale-100";

/** The mockup's hover lift on buttons (.btn:hover translateY −1px). */
export const lift = "hover:-translate-y-px reduce-motion:hover:translate-y-0";

export const disabledClass = "disabled:opacity-45 disabled:pointer-events-none";

/** Joins class fragments, dropping empties, so callers can pass conditional strings. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
