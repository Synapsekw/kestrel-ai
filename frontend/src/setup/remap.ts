// frontend/src/setup/remap.ts (Task 1 stub; Task 2 writes the real module)
import type { InspectBucket } from "./api";

export type DraftBucket = InspectBucket & { id: string; skipped: boolean };

export function bucketId(b: Pick<InspectBucket, "route" | "match" | "folder">): string {
  return [b.route, b.match.raster ?? "", b.match.thermal ? "thermal" : "", b.folder.toLowerCase()].join("|");
}
