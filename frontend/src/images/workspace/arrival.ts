/**
 * §6.5 arrival parameters on /p/:pid/images/:imageId. C's cloud → image jump depends on these
 * names (programme ruling R7): ?at=px,py&r=rpx&from=cloud:<cloudId>, and F's ?finding=<fid>.
 * Malformed values are ignored (S1's jump rule); pixels are stored-image pixels.
 *
 * Amendment (IMC reconciliation item 9): C-X1's imageJumpHref(projectId, imageId, cloudId, null)
 * sends ?from=cloud:<cloudId> with no `at` when the photo link found a photo by distance but no
 * pixel. `at` missing or malformed then yields a BackArrival (the "Back to 3D" chip, no ring)
 * when `from` is a valid `cloud:<id>`, else null. A valid `at` always wins and still carries
 * `cloudId`.
 */
export const DEFAULT_ARRIVAL_R = 24;
export const ARRIVAL_KEYS = ["finding", "at", "r", "from"] as const;

export interface PointArrival {
  kind: "point";
  px: number;
  py: number;
  r: number;
  cloudId: string | null;
}
export interface FindingArrival {
  kind: "finding";
  findingId: string;
}
export interface BackArrival {
  kind: "back";
  cloudId: string;
}
export type Arrival = PointArrival | FindingArrival | BackArrival | null;

const NUM = /^-?\d+(\.\d+)?$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;
const FROM = /^cloud:([A-Za-z0-9-]{1,64})$/;

function backOrNull(q: URLSearchParams): Arrival {
  const m = FROM.exec(q.get("from") ?? "");
  return m ? { kind: "back", cloudId: m[1] } : null;
}

export function parseArrival(q: URLSearchParams): Arrival {
  const fid = q.get("finding");
  if (fid !== null && ID.test(fid)) return { kind: "finding", findingId: fid };
  const at = q.get("at");
  if (!at) return backOrNull(q);
  const parts = at.split(",");
  if (parts.length !== 2 || !parts.every((p) => NUM.test(p))) return backOrNull(q);
  const px = Number(parts[0]);
  const py = Number(parts[1]);
  if (px < 0 || py < 0) return backOrNull(q);
  const rRaw = q.get("r");
  const r = rRaw !== null && NUM.test(rRaw) && Number(rRaw) > 0 ? Number(rRaw) : DEFAULT_ARRIVAL_R;
  const m = FROM.exec(q.get("from") ?? "");
  return { kind: "point", px, py, r, cloudId: m ? m[1] : null };
}

export function hasArrivalKeys(q: URLSearchParams): boolean {
  return ARRIVAL_KEYS.some((k) => q.has(k));
}

export function stripKeys(q: URLSearchParams, keys: readonly string[]): URLSearchParams {
  const next = new URLSearchParams(q);
  for (const k of keys) next.delete(k);
  return next;
}

export function withinImage(a: { px: number; py: number }, width: number, height: number): boolean {
  return a.px >= 0 && a.py >= 0 && a.px <= width && a.py <= height;
}

export function imageArrivalHref(
  projectId: string,
  imageId: string,
  a: { px: number; py: number; r?: number; cloudId?: string },
): string {
  let href = `/p/${projectId}/images/${imageId}?at=${a.px.toFixed(3)},${a.py.toFixed(3)}`;
  if (a.r !== undefined) href += `&r=${a.r}`;
  if (a.cloudId) href += `&from=cloud:${a.cloudId}`;
  return href;
}
