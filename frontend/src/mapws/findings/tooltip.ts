import type { MapFindingPin } from "@/api/mapFindings";
import { formatFindingNumber, parseCreatedBy } from "@/findings/format";
import type { SeverityLevel } from "@/ui";
import type { LayerRow, SiteFrame } from "@/mapws/annotations/bindings";

type Pin = Pick<MapFindingPin, "number" | "created_by" | "status" | "severity">;
const STATUSES = ["open", "reviewed", "closed"] as const;

export interface FindingFilterValues {
  allSurveys: boolean;
  statuses: string[];
  minSeverity: number | null;
}

/** The mockup tooltip's second line: "F-0031 · AI + reviewed". */
export function tooltipLine(f: Pick<Pin, "number" | "created_by" | "status">): string {
  const by = parseCreatedBy(f.created_by).kind === "model" ? "AI" : "Manual";
  return `${formatFindingNumber(f.number)} · ${by} + ${f.status}`;
}

export function visibleFindings<T extends Pin>(pins: readonly T[], filters: FindingFilterValues): T[] {
  return pins.filter(
    (f) =>
      filters.statuses.includes(f.status) &&
      (filters.minSeverity === null || (f.severity !== null && f.severity >= filters.minSeverity)),
  );
}

/** The Findings row's live count (W3-19). */
export function findingsMeta(
  pins: readonly Pin[],
  truncated: boolean,
  scale: readonly SeverityLevel[],
): string {
  if (pins.length === 0) return "None in view";
  const count = `${pins.length}${truncated ? "+" : ""} in view`;
  const top = scale.reduce<SeverityLevel | null>(
    (best, l) => (best === null || l.level > best.level ? l : best),
    null,
  );
  const atTop = top ? pins.filter((f) => f.severity === top.level).length : 0;
  return atTop > 0 && top ? `${count} · ${atTop} ${top.name.toLowerCase()}` : count;
}

/** W3-9: the row style holds the filters. */
export function findingFilters(style: Readonly<Record<string, unknown>>): FindingFilterValues {
  const statuses = Array.isArray(style.statuses)
    ? STATUSES.filter((s) => (style.statuses as unknown[]).includes(s))
    : [...STATUSES];
  return {
    allSurveys: style.allSurveys === true,
    statuses,
    minSeverity: typeof style.minSeverity === "number" ? style.minSeverity : null,
  };
}

/** One static row (W3-19); findings need a map CRS (spec §14). */
export function findingsRows(ctx: { frame: SiteFrame }): LayerRow[] {
  return [
    {
      key: "findings:all",
      kind: "findings",
      group: "annotations",
      id: "all",
      name: "Findings",
      meta: ctx.frame.kind === "local" ? "Unavailable in local metres" : "Points and outlines",
      date: null,
    },
  ];
}
