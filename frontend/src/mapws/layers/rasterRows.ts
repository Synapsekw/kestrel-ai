import { formatSurveyDate } from "../timeline/timelineModel";
import type { WorkspaceLayer } from "../types";
import type { LayerRow, LayerRowsContext } from "./layerRegistry";

type SurfaceKind = "cloud_dsm" | "dem" | "design";

/** M-C0's `WorkspaceLayer` row carries these top-level for surfaces (recon §0.1). */
export function surfaceKindOf(l: WorkspaceLayer): SurfaceKind | null {
  return (l.surface_kind as SurfaceKind | null) ?? null;
}

export function elevationRoleOf(l: WorkspaceLayer): "dsm" | "dtm" | null {
  return l.elevation_role ?? null;
}

/** Ruling W2-4: undated first, newest survey first, then by name. */
export function byNewest(a: WorkspaceLayer, b: WorkspaceLayer): number {
  if (a.date === b.date) return a.name.localeCompare(b.name);
  if (a.date === null) return -1;
  if (b.date === null) return 1;
  return a.date < b.date ? 1 : -1;
}

const joinMeta = (...parts: string[]) => parts.filter(Boolean).join(" · ");

/**
 * M §5.2 Base maps: one row per ready, in-frame georeferenced ortho, "Orthomosaic · 14 Sep 2026".
 * `in_frame` rows only (recon §1 T3): an item of another frame, or with no CRS, has no tiles.
 */
export function baseMapRows(ctx: Pick<LayerRowsContext, "layers">): LayerRow[] {
  return ctx.layers
    .filter((l) => l.kind === "map" && l.in_frame)
    .sort(byNewest)
    .map((l) => ({
      key: `map:${l.id}`,
      kind: "map",
      group: "base" as const,
      id: l.id,
      name: `Orthomosaic · ${formatSurveyDate(l.date_is_import_date ? null : l.date)}`,
      meta: joinMeta(l.name, l.meta),
      date: l.date,
      version: l.version,
      layer: l,
    }));
}

function badgeOf(l: WorkspaceLayer): string {
  if (surfaceKindOf(l) === "design") return "Design";
  return elevationRoleOf(l) === "dtm" ? "DTM" : "DSM";
}

/** M §5.2 Elevation: one row per ready, in-frame surface (cloud_dsm, dem, design). */
export function elevationRows(ctx: Pick<LayerRowsContext, "layers">): LayerRow[] {
  return ctx.layers
    .filter((l) => l.kind === "surface" && l.in_frame)
    .sort(byNewest)
    .map((l) => ({
      key: `surface:${l.id}`,
      kind: "surface",
      group: "elevation" as const,
      id: l.id,
      name: l.name,
      meta: l.meta,
      badge: badgeOf(l),
      date: l.date,
      version: l.version,
      layer: l,
    }));
}
