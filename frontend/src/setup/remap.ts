import type { InspectBucket, InspectNotRecognised, SlotRoute, TemplateSlot } from "./api";

/** A sorted bucket in the draft: `id` stays the same when its folder is dropped again; `skipped` leaves it out of Create. */
export type DraftBucket = InspectBucket & { id: string; skipped: boolean };

export const MAX_NOT_RECOGNISED = 50;

const GEOTIFF: ReadonlySet<SlotRoute> = new Set<SlotRoute>(["map", "elevation"]);

/** One bucket per route, match and folder (Windows paths compare case-insensitively). */
export function bucketId(b: Pick<InspectBucket, "route" | "match" | "folder">): string {
  const raster = b.match.raster ?? "";
  const thermal = b.match.thermal ? "thermal" : "";
  return [b.route, raster, thermal, b.folder.replace(/[\\/]+$/, "").toLowerCase()].join("|");
}

/**
 * The backend's `assign_slots` rule (coordinator ruling): the route is equal and every key the slot's
 * `match` names equals the bucket's value (a missing `thermal` is false); `match: null` takes the whole
 * route; the slot naming the most keys wins; ties go to template order.
 */
export function slotFor(
  b: Pick<InspectBucket, "route" | "match">,
  slots: readonly TemplateSlot[],
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  for (const s of slots) {
    if (s.route !== b.route) continue;
    const m = s.match ?? {};
    let score = 0;
    if (m.raster != null) {
      if (b.match.raster !== m.raster) continue;
      score += 1;
    }
    if (m.thermal != null) {
      if ((b.match.thermal ?? false) !== m.thermal) continue;
      score += 1;
    }
    if (score > bestScore) {
      best = s.key;
      bestScore = score;
    }
  }
  return best;
}

/** Buckets to the slots of a template. Route and match decide, so the result never depends on an earlier template. */
export function remap(buckets: readonly DraftBucket[], slots: readonly TemplateSlot[]): DraftBucket[] {
  return buckets.map((b) => ({ ...b, slot_key: slotFor(b, slots) }));
}

/** A bucket moves to a slot of its own route, or between orthomosaic and elevation (both GeoTIFF). */
export function canMoveTo(b: Pick<InspectBucket, "route">, slot: Pick<TemplateSlot, "route">): boolean {
  return slot.route === b.route || (GEOTIFF.has(b.route) && GEOTIFF.has(slot.route));
}

/** A new drop adds to what is there: a known id is replaced in place, new buckets are appended. */
export function mergeBuckets(prev: readonly DraftBucket[], incoming: readonly DraftBucket[]): DraftBucket[] {
  const byId = new Map(incoming.map((b) => [b.id, b]));
  const out = prev.map((b) => {
    const next = byId.get(b.id);
    if (!next) return b;
    byId.delete(b.id);
    return next;
  });
  return [...out, ...byId.values()];
}

export function mergeNotRecognised(a: InspectNotRecognised, b: InspectNotRecognised): InspectNotRecognised {
  return { count: a.count + b.count, samples: [...a.samples, ...b.samples].slice(0, MAX_NOT_RECOGNISED) };
}
