import type { Box } from "@contract/client";
import type { FindingSighting } from "@/api/assetReview";
import { cornersOf, orientedRectOf } from "@/images/canvas/geometry";

export function stepId(ids: readonly string[], current: string | null, dir: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const i = current === null ? -1 : ids.indexOf(current);
  if (i < 0) return ids[0];
  return ids[i + dir] ?? null;
}

export function currentSighting(sightings: readonly FindingSighting[], wanted: string | null): FindingSighting | null {
  return (
    sightings.find((s) => s.id === wanted) ?? sightings.find((s) => s.representative) ?? sightings[0] ?? null
  );
}

export interface OverlayRing {
  id: string;
  /** Flat [x0, y0, x1, y1, ...] in stored-image pixels, for a closed Konva Line. */
  points: number[];
  colour: string;
}

/** Spec §9 overlay: the finding's own shapes on this photo; the polygon when there is one (A4: polygons are the truth). */
export function overlayRings(
  boxes: Readonly<Record<string, Box>>,
  sightings: readonly FindingSighting[],
  imageId: string,
  colourOf: (severity: number | null) => string,
): OverlayRing[] {
  const out: OverlayRing[] = [];
  for (const s of sightings) {
    if (s.image_id !== imageId || !s.annotation_id) continue;
    const b = boxes[s.annotation_id];
    if (!b) continue;
    const points = b.points?.length ? b.points.flat() : cornersOf(orientedRectOf(b)).flatMap((p) => [p.x, p.y]);
    out.push({ id: s.id, points, colour: colourOf(s.severity ?? null) });
  }
  return out;
}

export function captureText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
