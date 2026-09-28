import type { Affine, FitResult, GeorefModelName, Vec2 } from "./fit";

// Task 7 stub: only the session shape. Task 8 completes this module (Step 3).

export type Extent4 = [number, number, number, number];
export interface AlignPair {
  id: string;
  src: Vec2;
  dst: Vec2;
}
/** One K-tool session on one drawing (spec §8.3); dst and the transform are in the site frame. */
export interface AlignSession {
  drawingId: string;
  model: GeorefModelName;
  pairs: AlignPair[];
  /** The first click of a pair, in drawing coordinates, until the map click arrives. */
  pendingSrc: Vec2 | null;
  extentSrc: Extent4;
  /** The provisional placement or the saved georef the session started from. */
  start: Affine;
  /** What the preview shows: the live fit when valid, else the last good one. */
  transform: Affine;
  fit: FitResult | null;
  nextId: number;
  unitsScale: number | null;
}
