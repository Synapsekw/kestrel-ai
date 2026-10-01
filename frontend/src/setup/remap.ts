import type { InspectBucket, InspectNotRecognised, SlotRoute, TemplateSlot } from "./api";

/** A sorted bucket in the draft: `id` stays the same when its folder is dropped again; `skipped` leaves it out of Create. */
export type DraftBucket = InspectBucket & { id: string; skipped: boolean };

export const MAX_NOT_RECOGNISED = 50;

const GEOTIFF: ReadonlySet<SlotRoute> = new Set<SlotRoute>(["map", "elevation"]);

/** Lower-cased, without trailing separators. */
const trimPath = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();

/** True when `folder` is one of `paths` or lies under one of them (the run sorted that folder). */
function underAny(folder: string, paths: readonly string[]): boolean {
  const slashes = (p: string) => trimPath(p).replace(/\//g, "\\");
  const f = slashes(folder);
  return paths.some((p) => {
    const n = slashes(p);
    return n !== "" && (f === n || f.startsWith(`${n}\\`));
  });
}

/**
 * One bucket per route, match and folder (Windows paths compare case-insensitively). When the run picked
 * files rather than the bucket's folder (`runPaths` given, and the folder is neither one of them nor under
 * one), the id also names the files, so two files picked from one folder stay two buckets.
 */
export function bucketId(
  b: Pick<InspectBucket, "route" | "match" | "folder"> & { files?: readonly string[] },
  runPaths?: readonly string[],
): string {
  const raster = b.match.raster ?? "";
  const thermal = b.match.thermal ? "thermal" : "";
  const id = [b.route, raster, thermal, trimPath(b.folder)].join("|");
  const files = b.files ?? [];
  if (!runPaths || files.length === 0 || underAny(b.folder, runPaths)) return id;
  return `${id}|${files
    .map((f) => f.toLowerCase())
    .sort()
    .join("|")}`;
}

/** The folder-level id a file-level id belongs to (itself for a folder-level id). */
const folderIdOf = (id: string) => id.split("|").slice(0, 4).join("|");

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

/**
 * A new drop adds to what is there: a known id is replaced in place, new buckets are appended. A folder-level
 * bucket also replaces the file-level buckets picked from that folder (in place of the first of them).
 */
export function mergeBuckets(prev: readonly DraftBucket[], incoming: readonly DraftBucket[]): DraftBucket[] {
  const pending = new Map(incoming.map((b) => [b.id, b]));
  const placed = new Set<string>();
  const out: DraftBucket[] = [];
  for (const b of prev) {
    const key = pending.has(b.id) ? b.id : pending.has(folderIdOf(b.id)) ? folderIdOf(b.id) : null;
    if (key === null) out.push(b);
    else if (!placed.has(key)) {
      out.push(pending.get(key)!);
      placed.add(key);
    }
  }
  for (const [id, b] of pending) if (!placed.has(id)) out.push(b);
  return out;
}

export function mergeNotRecognised(a: InspectNotRecognised, b: InspectNotRecognised): InspectNotRecognised {
  return { count: a.count + b.count, samples: [...a.samples, ...b.samples].slice(0, MAX_NOT_RECOGNISED) };
}
