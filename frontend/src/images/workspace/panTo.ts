import { aabbOf, envelopeOf, orientedRectOf, toPoints } from "./seams";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeLike {
  shape?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  points?: readonly (readonly number[])[] | null;
}

/** Half the side of the square shown around a point marker for "Show on image", in image px. */
export const POINT_PAD = 24;

/**
 * The image-px extent of any annotation, for `panIntoView`. Box/rbox reuse FC's `aabbOf`
 * (clockwise rotation about the centre, degrees — matches this module's tests); polygon reuses
 * FC's `envelopeOf`; only the point pad is FW's.
 */
export function shapeBounds(b: ShapeLike): Rect {
  if (b.shape === "point") {
    return { x: b.x - POINT_PAD, y: b.y - POINT_PAD, w: 2 * POINT_PAD, h: 2 * POINT_PAD };
  }
  if (b.shape === "polygon" && b.points && b.points.length > 0) {
    return envelopeOf(toPoints(b.points));
  }
  return aabbOf(orientedRectOf(b));
}
