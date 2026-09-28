import type { AreaAnalytics } from "@/api/analytics";
import type { LayerRow, SiteFrame } from "@/mapws/annotations/bindings";

/** Spec M15: `SiteArea.category`. */
export const ZONE_CATEGORIES = ["general", "laydown", "exclusion", "excavation", "other"] as const;
export type ZoneCategory = (typeof ZONE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ZoneCategory, string> = {
  general: "General",
  laydown: "Laydown",
  exclusion: "Exclusion",
  excavation: "Excavation",
  other: "Other",
};

/** W3-2: a missing or unknown category reads as general. */
export function categoryOf(area: { category?: string | null }): ZoneCategory {
  const c = area.category ?? "";
  return (ZONE_CATEGORIES as readonly string[]).includes(c) ? (c as ZoneCategory) : "general";
}

/** Spec §9.4 and W3-12: "CRANE EXCLUSION · 35 M" is the name in capitals. */
export function zoneLabel(area: { name: string; category?: string | null }): string {
  return categoryOf(area) === "exclusion" ? area.name.toUpperCase() : area.name;
}

export function zoneStyleKind(c: ZoneCategory): "hatched-warn" | "dashed-accent" {
  return c === "exclusion" ? "hatched-warn" : "dashed-accent";
}

export interface SurveyCount {
  key: string;
  date: string | null;
  name: string;
  total: number;
  partial: boolean;
}

/** The zone inspector's objects per survey, from `GET /analytics/areas` (read-only run rows). */
export function surveyCounts(analytics: AreaAnalytics | null, areaId: string): SurveyCount[] {
  if (!analytics) return [];
  return analytics.surveys.flatMap((s) => {
    const cell = s.per_area[areaId];
    if (!cell) return [];
    const total = Object.values(cell.counts).reduce((n, c) => n + c.total, 0);
    return [{ key: s.map_id, date: s.captured_on, name: s.map_name, total, partial: cell.partial }];
  });
}

/** W3-9: the row style holds the categories to draw. */
export function zoneFilters(style: Readonly<Record<string, unknown>>): { categories: ZoneCategory[] } {
  const raw = style.categories;
  if (!Array.isArray(raw)) return { categories: [...ZONE_CATEGORIES] };
  return { categories: ZONE_CATEGORIES.filter((c) => raw.includes(c)) };
}

/** One static row (W3-19); site areas are WGS84, so none in a local frame. */
export function zonesRows(ctx: { frame: SiteFrame }): LayerRow[] {
  return [
    {
      key: "zones:all",
      kind: "zones",
      group: "annotations",
      id: "all",
      name: "Site areas & zones",
      meta: ctx.frame.kind === "local" ? "Unavailable in local metres" : "Site areas",
      date: null,
    },
  ];
}
