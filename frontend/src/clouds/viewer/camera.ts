export type Bounds6 = [number, number, number, number, number, number];
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function siteDiagonal(b: Bounds6): number {
  return Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
}

/** Set every frame from the distance to the orbit target (spec §8 "Navigation"). */
export function nearFar(distance: number, diagonal: number): { near: number; far: number } {
  return { near: Math.max(0.05, distance / 2000), far: Math.max(20 * diagonal, 4 * distance) };
}

export function southOblique(target: Vec3, distance: number, elevationDeg = 45): Vec3 {
  const e = (elevationDeg * Math.PI) / 180;
  return { x: target.x, y: target.y - distance * Math.cos(e), z: target.z + distance * Math.sin(e) };
}

function centre(b: Bounds6): Vec3 {
  return { x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, z: (b[2] + b[5]) / 2 };
}

/** From the south, above the site, as in the spike. */
export function wholeSiteView(b: Bounds6): { target: Vec3; position: Vec3 } {
  const target = centre(b);
  return { target, position: southOblique(target, 1.1 * siteDiagonal(b), 40) };
}

export function topView(b: Bounds6): { target: Vec3; position: Vec3 } {
  const target = centre(b);
  const h = 1.6 * Math.max(b[3] - b[0], b[4] - b[1]);
  // a hair south of straight down: an orbit with Z up has no heading when looking exactly along -Z
  return { target, position: { x: target.x, y: target.y - h * 1e-4, z: target.z + h } };
}

export function jumpDistance(footprintDiagonal: number): number {
  return Math.max(40, 3 * footprintDiagonal);
}
