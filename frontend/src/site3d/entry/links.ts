/** A spot in the caller's CRS (`epsg` null when the caller has none); the site view uses it only in its own CRS. */
export interface SiteAt {
  x: number;
  y: number;
  epsg: number | null;
}

/** The plant model's own workspace (versions, runs) for a plant, which otherwise opens in the site view. */
export const MODEL_VIEW = "view=model";

/** `/p/:projectId/site[/:modelId][?at=x,y[&epsg=n]]` (spec §11 route; `at` like the 3D jump contract). */
export function siteHref(projectId: string, modelId?: string | null, at?: SiteAt | null): string {
  const base = `/p/${projectId}/site${modelId ? `/${encodeURIComponent(modelId)}` : ""}`;
  if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return base;
  return `${base}?at=${at.x.toFixed(2)},${at.y.toFixed(2)}${at.epsg != null ? `&epsg=${at.epsg}` : ""}`;
}

export function readSiteAt(search: string): SiteAt | null {
  const q = new URLSearchParams(search);
  const parts = (q.get("at") ?? "").split(",").map(Number);
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
  const epsg = q.get("epsg");
  return { x: parts[0], y: parts[1], epsg: epsg && Number.isFinite(Number(epsg)) ? Number(epsg) : null };
}

export function modelDetailsHref(projectId: string, modelId: string): string {
  return `/p/${projectId}/models/${encodeURIComponent(modelId)}?${MODEL_VIEW}`;
}
