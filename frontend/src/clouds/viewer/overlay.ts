import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  LineSegments,
  Points,
  PointsMaterial,
  SRGBColorSpace,
} from "three";
import type { Vec3 } from "./camera";

export type OverlayTone = "accent" | "ok" | "warn";
export type OverlayShape =
  | { kind: "line"; points: Vec3[]; closed?: boolean; tone: OverlayTone }
  | { kind: "points"; points: Vec3[]; tone: OverlayTone; size?: number }
  /** Pairs of points, one segment each, in one draw call (C-L1's camera frustums). */
  | { kind: "segments"; points: Vec3[]; tone: OverlayTone; opacity?: number };

/** float32 holds ~7 digits: a UTM northing loses its millimetres, so overlay geometry is stored
 * relative to a local origin and the group is placed at that origin in float64. */
export function localPositions(points: Vec3[], origin: Vec3, closed = false): Float32Array {
  const ring = closed && points.length > 1 ? [...points, points[0]] : points;
  const out = new Float32Array(ring.length * 3);
  ring.forEach((p, i) => {
    out[3 * i] = p.x - origin.x;
    out[3 * i + 1] = p.y - origin.y;
    out[3 * i + 2] = p.z - origin.z;
  });
  return out;
}

/** A DESIGN.md colour token (`--accent: 229 175 100`) as 0-255 RGB. */
export function tokenRgb(name: string, el: Element = document.documentElement): [number, number, number] {
  const parts = getComputedStyle(el).getPropertyValue(`--${name}`).trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2]]
    : [229, 175, 100];
}

/**
 * A 0-255 sRGB token as a three.js colour. `new Color(r / 255, g / 255, b / 255)` takes the numbers
 * as linear, and the renderer's sRGB output then brightens them: the canvas token (21, 27, 25) drew
 * as (81, 92, 88), so `sampleColours()` never matched the background.
 */
export function tokenColor(rgb: [number, number, number]): Color {
  return new Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, SRGBColorSpace);
}

/**
 * The three.js object for one overlay shape, positioned relative to `origin` (the caller places the
 * overlay group at `origin` in float64). Lines and points are built as S1 built them; segments are
 * one `LineSegments` (C-L1). All draw over the cloud (`depthTest: false`) at render order 10.
 */
export function overlayObject(s: OverlayShape, origin: Vec3, color: Color): Line | LineSegments | Points {
  const geom = new BufferGeometry();
  const closed = s.kind === "line" && !!s.closed;
  geom.setAttribute("position", new BufferAttribute(localPositions(s.points, origin, closed), 3));
  const obj =
    s.kind === "points"
      ? new Points(
          geom,
          new PointsMaterial({ color, size: s.size ?? 8, sizeAttenuation: false, depthTest: false }),
        )
      : s.kind === "segments"
        ? new LineSegments(
            geom,
            new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: s.opacity ?? 1 }),
          )
        : new Line(geom, new LineBasicMaterial({ color, depthTest: false, transparent: true }));
  obj.renderOrder = 10;
  return obj;
}
