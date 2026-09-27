import type { ReactNode } from "react";
import { SeverityScaleContext } from "@/ui";
import { useCatalogueSeverity } from "./severityStore";
import { useSeverityScaleSync } from "./useSeverityScaleSync";

/**
 * DS's severity context fed from the catalogue (DS decision 4, plan decision 18). Until the first
 * answer, or when the catalogue is unavailable, DS's default (D4's four levels) stays in effect.
 */
export function CatalogueSeverityProvider({ children }: { children: ReactNode }) {
  useSeverityScaleSync();
  const levels = useCatalogueSeverity((s) => s.levels);
  return levels ? (
    <SeverityScaleContext.Provider value={levels}>{children}</SeverityScaleContext.Provider>
  ) : (
    <>{children}</>
  );
}
