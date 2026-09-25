/** A pick is a real source point; what is uncertain is whether it is the point the operator meant
 * (spec §2 "Picking"): the true surface point can be one displayed spacing away. */
export const WARN_UNCERTAINTY_M = 0.1;

export function pickUncertainty(rootSpacing: number, level: number): number {
  return rootSpacing / 2 ** level;
}

export interface NodeBox {
  level: number;
  min: [number, number, number];
  max: [number, number, number];
}

const EPS = 1e-6;

export function deepestLevelAt(nodes: NodeBox[], p: { x: number; y: number; z: number }): number | null {
  let best: number | null = null;
  const c = [p.x, p.y, p.z];
  for (const n of nodes) {
    const inside = c.every((v, i) => v >= n.min[i] - EPS && v <= n.max[i] + EPS);
    if (inside && (best === null || n.level > best)) best = n.level;
  }
  return best;
}
