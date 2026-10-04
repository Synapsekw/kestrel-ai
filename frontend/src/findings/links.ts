import type { Finding } from "@/api/findings";

/** The canonical finding link: the Findings tab with the inspector open ("Copy link"). */
export function findingPath(projectId: string, findingId: string): string {
  return `/p/${projectId}/findings/${findingId}`;
}

/**
 * F §8.7's one deep-link builder: the workspace of the finding's anchor with `?finding=`. The
 * project id comes first because a finding row (per-project DB) does not carry it.
 */
export function findingHref(projectId: string, finding: Pick<Finding, "id" | "anchor">): string {
  const a = finding.anchor;
  const fid = encodeURIComponent(finding.id);
  switch (a.kind) {
    case "image":
      return `/p/${projectId}/images/${a.image_id}?finding=${fid}`;
    case "map":
      return `/p/${projectId}/maps?map=${a.map_id}&finding=${fid}`;
    case "cloud":
      return `/p/${projectId}/clouds/${a.cloud_id}?finding=${fid}`;
    case "asset":
      // Asset findings open in the split inspection (asset findings spec §9).
      return `/p/${projectId}/models/${a.asset_model_id}/inspect?finding=${fid}`;
  }
}

/**
 * F24: the Findings tab path with a raw, already-serialised search string (e.g. the current
 * location's `search`, preserved as-is) — for the inspector's "close" and "not found" fallbacks,
 * which return to the list without reconstructing it from `FindingFilters`. Prefer
 * `findingsListPath` (in `filters.ts`) when building a link from filter values instead.
 */
export function findingsTabPath(projectId: string, search?: string | URLSearchParams): string {
  const s = typeof search === "string" ? search.replace(/^\?/, "") : (search?.toString() ?? "");
  return `/p/${projectId}/findings${s ? `?${s}` : ""}`;
}
