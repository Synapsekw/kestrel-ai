/**
 * Shared class fragments for the ui components. This is the only file allowed to name raw Tailwind
 * palette colours (it names none today; `scripts/check-tokens.mjs` enforces that everywhere else).
 */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ground";

export const transition =
  "transition-[background-color,border-color,color,transform,box-shadow,opacity] duration-140 ease-out motion-reduce:transition-none";

export const pressable = "active:scale-[.97] motion-reduce:active:scale-100";

export const disabledClass = "disabled:opacity-45 disabled:pointer-events-none";

/** Joins class fragments, dropping empties, so callers can pass conditional strings. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
