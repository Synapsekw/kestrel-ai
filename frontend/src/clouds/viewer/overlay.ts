import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  ShapeUtils,
  Vector2,
} from "three";
import type { Vec3 } from "./camera";

export type OverlayTone = "accent" | "ok" | "warn";
export type OverlayShape =
  | { kind: "line"; points: Vec3[]; closed?: boolean; tone: OverlayTone }
  | { kind: "points"; points: Vec3[]; tone: OverlayTone; size?: number }
  /** Pairs of points, one segment each, in one draw call (C-L1's camera frustums). */
  | { kind: "segments"; points: Vec3[]; tone: OverlayTone; opacity?: number }
  /** A translucent fill in the outline's own plane (an area measurement, spec §8.3). */
  | { kind: "polygon"; points: Vec3[]; tone: OverlayTone };

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
 * Triangle indices for a planar (or nearly planar) outline: the plane is the one Newell's normal is
 * most aligned with, the outline is projected onto it and ear-clipped (three's Earcut), so concave
 * outlines fill correctly. Coordinates are taken relative to the first vertex (UTM magnitudes).
 */
export function polygonTriangles(points: readonly Vec3[]): number[] {
  if (points.length < 3) return [];
  const o = points[0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const [px, py, pz] = [a.x - o.x, a.y - o.y, a.z - o.z];
    const [qx, qy, qz] = [b.x - o.x, b.y - o.y, b.z - o.z];
    nx += py * qz - pz * qy;
    ny += pz * qx - px * qz;
    nz += px * qy - py * qx;
  }
  const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  const flat = points.map((p) =>
    az >= ax && az >= ay
      ? new Vector2(p.x - o.x, p.y - o.y)
      : ax >= ay
        ? new Vector2(p.y - o.y, p.z - o.z)
        : new Vector2(p.x - o.x, p.z - o.z),
  );
  return ShapeUtils.triangulateShape(flat, []).flat();
}

/** The fill as a three.js mesh relative to `origin` (float32-safe, like `localPositions`). */
export function polygonMesh(points: readonly Vec3[], origin: Vec3, color: Color): Mesh {
  const geom = new BufferGeometry();
  geom.setAttribute("position", new BufferAttribute(localPositions([...points], origin), 3));
  geom.setIndex(polygonTriangles(points));
  const mesh = new Mesh(
    geom,
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false,
    }),
  );
  mesh.renderOrder = 9;
  return mesh;
}

/**
 * The three.js object for one overlay shape, positioned relative to `origin` (the caller places the
 * overlay group at `origin` in float64). Lines and points are built as S1 built them; segments are
 * one `LineSegments` (C-L1); a polygon is `polygonMesh` (C-M1, render order 9, under its outline).
 * All draw over the cloud (`depthTest: false`); the non-polygon kinds at render order 10.
 */
export function overlayObject(
  s: OverlayShape,
  origin: Vec3,
  color: Color,
): Line | LineSegments | Points | Mesh {
  if (s.kind === "polygon") return polygonMesh(s.points, origin, color);
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
