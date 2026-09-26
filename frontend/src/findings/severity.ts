import type { SeverityLevel } from "@/ui";

/** The top (highest `level`) entry of a severity scale, or null for an empty scale.
 * Shared by the Overview's "top severity" KPI (`overview/kpis.ts`) and the Projects grid's
 * top-severity chip (`screens/projects/projectCards.ts`) so the definition lives in one place
 * (F17). */
export function topLevel(scale: readonly SeverityLevel[]): SeverityLevel | null {
  return scale.reduce<SeverityLevel | null>(
    (top, l) => (top === null || l.level > top.level ? l : top),
    null,
  );
}
