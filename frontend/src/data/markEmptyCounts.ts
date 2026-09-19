import type { Image as ImageRow } from "@contract/client";

/**
 * Pending proposals a bulk "Mark as empty" would reject: images with accepted boxes are skipped by
 * the backend and already marked images are left alone, so their proposals do not count.
 */
export function proposalsABulkMarkRejects(
  rows: Pick<ImageRow, "box_count" | "marked_empty" | "pending_count">[],
): number {
  return rows
    .filter((i) => i.box_count === 0 && !i.marked_empty)
    .reduce((sum, i) => sum + i.pending_count, 0);
}
