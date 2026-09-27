import type { Image as ImageRow } from "@contract/client";
import { DETAILS_BATCH } from "./api";

/** Spec §7.1: cell details are kept in an LRU of 2,000 records. */
export const DETAIL_LRU_MAX = 2000;

/** A Map in recency order: the first key is the least recently used. */
export class DetailCache {
  private rows = new Map<string, ImageRow>();

  constructor(readonly max = DETAIL_LRU_MAX) {}

  get size(): number {
    return this.rows.size;
  }

  /** Read and mark as recently used. */
  get(id: string): ImageRow | undefined {
    const row = this.rows.get(id);
    if (row) {
      this.rows.delete(id);
      this.rows.set(id, row);
    }
    return row;
  }

  /** Read without touching the order (safe during render). */
  peek(id: string): ImageRow | undefined {
    return this.rows.get(id);
  }

  set(row: ImageRow): void {
    this.rows.delete(row.id);
    this.rows.set(row.id, row);
    while (this.rows.size > this.max) {
      const oldest = this.rows.keys().next().value;
      if (oldest === undefined) break;
      this.rows.delete(oldest);
    }
  }

  clear(): void {
    this.rows.clear();
  }
}

/** The ids still to fetch (not held, not in flight), deduplicated, in batches of ≤ `size`. */
export function missingBatches(
  ids: readonly string[],
  has: (id: string) => boolean,
  inFlight: ReadonlySet<string>,
  size = DETAILS_BATCH,
): string[][] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!inFlight.has(id) && !has(id)) missing.push(id);
  }
  const out: string[][] = [];
  for (let i = 0; i < missing.length; i += size) out.push(missing.slice(i, i + size));
  return out;
}
