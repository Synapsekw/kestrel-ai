import { createContext, useContext } from "react";

export interface SeverityLevel {
  level: number;
  name: string;
  /** #rrggbb */
  colour: string;
}

/** D4's default scale (spec §4.1, §7.1). The app-wide scale comes from GET /catalogue/severity. */
export const DEFAULT_SEVERITY_SCALE: readonly SeverityLevel[] = [
  { level: 1, name: "Minor", colour: "#3fb68e" },
  { level: 2, name: "Moderate", colour: "#e2bf2e" },
  { level: 3, name: "Major", colour: "#ff9c3a" },
  { level: 4, name: "Critical", colour: "#ff5a4f" },
];

/** SH or S2 provides the loaded scale around the app; without a provider the default applies. */
export const SeverityScaleContext = createContext<readonly SeverityLevel[]>(DEFAULT_SEVERITY_SCALE);

export function useSeverityScale(): readonly SeverityLevel[] {
  return useContext(SeverityScaleContext);
}

export function severityOf(scale: readonly SeverityLevel[], level: number | null): SeverityLevel | null {
  return level === null ? null : (scale.find((s) => s.level === level) ?? null);
}
