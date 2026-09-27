import type { ReactNode } from "react";
import { DEFAULT_SEVERITY_SCALE, SeverityScaleContext } from "@/ui";
import { useCatalogueSeverity } from "./severityStore";
import { useSeverityScaleSync } from "./useSeverityScaleSync";

/**
 * DS's severity context fed from the catalogue (DS decision 4, plan decision 18). Until the first
 * answer, or when the catalogue is unavailable, DS's default (D4's four levels) stays in effect.
 * The provider is always rendered: swapping it in when the scale arrives would remount the whole app.
 */
export function CatalogueSeverityProvider({ children }: { children: ReactNode }) {
  useSeverityScaleSync();
  const levels = useCatalogueSeverity((s) => s.levels);
  return (
    <SeverityScaleContext.Provider value={levels ?? DEFAULT_SEVERITY_SCALE}>
      {children}
    </SeverityScaleContext.Provider>
  );
}
