import { mapPreviewUrl, thumbnailUrl, type Project } from "@contract/client";
import { countLabel } from "@/lib/countLabel";

export type ProjectSort = "recent" | "name" | "findings";
type Summary = Project["summary"];

/** "Last opened" is the server's order (recent_projects.json keeps the newest first). */
export function visibleProjects(list: readonly Project[], q: string, sort: ProjectSort): Project[] {
  const needle = q.trim().toLocaleLowerCase();
  const hits = needle ? list.filter((p) => p.name.toLocaleLowerCase().includes(needle)) : [...list];
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (sort === "name") return hits.sort(byName);
  if (sort === "findings")
    return hits.sort(
      (a, b) =>
        (b.summary?.open_findings ?? -1) - (a.summary?.open_findings ?? -1) ||
        (b.summary?.open_top_severity ?? 0) - (a.summary?.open_top_severity ?? 0) ||
        byName(a, b),
    );
  return hits;
}

export type CardState =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "pending" }
  | { kind: "upgrading"; jobId: string | null }
  | { kind: "failed"; error: string; backupPath: string | null };

/** F §9.2: a project that is not `ok` is listed but will not open. A folder that is gone is listed
 * as "Folder not found" (operator decision 2026-09-26). */
export function cardState(p: Project): CardState {
  if (p.availability === "missing") return { kind: "missing" };
  const m = p.migration;
  switch (m.state) {
    case "ok":
      return { kind: "ok" };
    case "pending":
      return { kind: "pending" };
    case "running":
      return { kind: "upgrading", jobId: m.job_id ?? null };
    case "failed":
      return {
        kind: "failed",
        error: m.error ?? "The upgrade stopped without a message.",
        backupPath: m.backup_path ?? null,
      };
  }
}

export function canOpen(p: Project): boolean {
  return p.availability === "ok" && p.migration.state === "ok";
}

export function dataChips(s: Summary): string[] {
  if (!s) return [];
  return [
    s.image_count ? countLabel(s.image_count, "image", "images") : null,
    s.maps ? countLabel(s.maps, "map", "maps") : null,
    s.point_clouds ? countLabel(s.point_clouds, "cloud", "clouds") : null,
    s.elevations ? countLabel(s.elevations, "elevation", "elevations") : null,
  ].filter((c): c is string => c !== null);
}

export function coverUrl(p: Project, baseUrl: string, token: string): string | null {
  const cover = p.summary?.cover;
  if (!cover) return null;
  return cover.kind === "map"
    ? mapPreviewUrl(baseUrl, token, p.id, cover.id)
    : thumbnailUrl(baseUrl, token, p.id, cover.id);
}
