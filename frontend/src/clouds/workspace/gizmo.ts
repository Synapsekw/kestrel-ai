import type { ViewName } from "@/clouds/viewer/types";

type V3 = readonly [number, number, number];

export interface GizmoAxis {
  axis: "x" | "y" | "z";
  /** Screen offset of the axis head from the gizmo centre, SVG coordinates (y down). */
  dx: number;
  dy: number;
  /** The axis points away from the viewer: drawn at 45 % opacity, behind the others. */
  away: boolean;
}

/** Iso looks from the south-east, 35° down (V1 Ruling 6): the gizmo's pose before the first frame. */
export const ISO_DIRECTION: V3 = [-0.579, 0.579, -0.574];

/** Plan Ruling 5: an axis head goes to the named view that looks from that axis. */
export const VIEW_OF_AXIS: Record<GizmoAxis["axis"], ViewName> = { x: "side", y: "front", z: "top" };

/**
 * The world axes seen from a roll-free camera looking along `direction` (Z up, spec §6 gizmo). The
 * screen basis is right = d × Z, up = right × d; straight down, right is east and up is north.
 */
export function gizmoAxes(direction: V3, radius = 24): GizmoAxis[] {
  const n = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  const d = [direction[0] / n, direction[1] / n, direction[2] / n];
  let right = [d[1], -d[0], 0];
  const rl = Math.hypot(right[0], right[1]);
  right = rl < 1e-6 ? [1, 0, 0] : [right[0] / rl, right[1] / rl, 0];
  const up = [
    right[1] * d[2] - right[2] * d[1],
    right[2] * d[0] - right[0] * d[2],
    right[0] * d[1] - right[1] * d[0],
  ];
  const axes: GizmoAxis[] = (["x", "y", "z"] as const).map((axis, i) => ({
    axis,
    dx: right[i] * radius,
    dy: -up[i] * radius,
    away: d[i] > 1e-9,
  }));
  return axes.sort((a, b) => Number(b.away) - Number(a.away));
}
