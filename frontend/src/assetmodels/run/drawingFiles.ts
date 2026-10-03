import type { AssetSourceRef } from "@contract/client";
import type { Drawing } from "@/api/drawings";

export type FileStatus = "ready" | "importing" | "failed";

/** One source file and its drawings (a PDF imports one drawing per page; plan I1 Ruling 11). */
export interface DrawingFile {
  /** The normalised source path (Windows paths compare case-insensitively). */
  key: string;
  /** The drawing's own name for a one-drawing file; the file name for several pages. */
  label: string;
  /** "29 pages", "29 pages · 2 failed", or null for one drawing. */
  meta: string | null;
  /** Page order. */
  drawings: Drawing[];
  /** What a tick sends: every ready page. */
  refs: AssetSourceRef[];
  status: FileStatus;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;
const normal = (path: string) => path.replace(/\//g, "\\").toLowerCase();

export function groupDrawingFiles(drawings: readonly Drawing[]): DrawingFile[] {
  const byKey = new Map<string, Drawing[]>();
  for (const d of drawings) {
    const key = normal(d.source_path);
    byKey.set(key, [...(byKey.get(key) ?? []), d]);
  }
  const files: DrawingFile[] = [];
  for (const [key, list] of byKey) {
    const pages = [...list].sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.name.localeCompare(b.name));
    const ready = pages.filter((d) => d.status === "ready");
    const failed = pages.filter((d) => d.status === "failed").length;
    const status: FileStatus = pages.some((d) => d.status === "importing")
      ? "importing"
      : ready.length > 0
        ? "ready"
        : "failed";
    const one = pages.length === 1;
    files.push({
      key,
      label: one ? pages[0].name : fileName(list[0].source_path),
      meta: one ? null : `${pages.length} pages${failed ? ` · ${failed} failed` : ""}`,
      drawings: pages,
      refs: ready.map((d) => ({ type: "drawing", id: d.id })),
      status,
    });
  }
  return files.sort((a, b) => a.label.localeCompare(b.label));
}
