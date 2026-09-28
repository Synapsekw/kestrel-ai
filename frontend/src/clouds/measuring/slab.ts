import type { CloudProfile } from "@/api/cloudMeasurements";
import type { PointCloud } from "@/api/clouds";
import type { CloudViewerHandle } from "../CloudViewer";
import type { MPoint } from "../measure";
import type { ClipBox } from "../viewer/clipBox";
import { SLAB_MAX_POINTS } from "../viewer/slab";
import type { ProfileData } from "./profileView";

/** The single call site of C-V2's slab members (a renamed member is changed here only). */
export interface SectionLine {
  a: MPoint;
  b: MPoint;
  thicknessM: number;
}

/** The preview's cap is V2's own (M1 Ruling R8): no second cap to drift out of step. */
export const PREVIEW_MAX_POINTS = SLAB_MAX_POINTS;

export function lineKey(l: SectionLine): string {
  return [l.a.x, l.a.y, l.a.z, l.b.x, l.b.y, l.thicknessM].join("|");
}

/** The slab as a clip box: along A→B (yaw counter-clockwise from grid east, V2 Ruling 3), the
 * thickness across, and the cloud's full height plus a metre. */
export function slabBox(l: SectionLine, zRange: readonly [number, number]): ClipBox {
  const dx = l.b.x - l.a.x;
  const dy = l.b.y - l.a.y;
  const z0 = zRange[0] - 1;
  const z1 = zRange[1] + 1;
  return {
    centre: [(l.a.x + l.b.x) / 2, (l.a.y + l.b.y) / 2, (z0 + z1) / 2],
    size: [Math.hypot(dx, dy), l.thicknessM, z1 - z0],
    yawDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

export function zRangeOf(cloud: Pick<PointCloud, "bounds_native">): [number, number] {
  const b = cloud.bounds_native;
  return b && b.length === 6 ? [b[2], b[5]] : [-10_000, 10_000];
}

/**
 * The preview from the displayed octree points (V2's `sampleSlab`, ≤ 300 000 points, 5 Hz). V2's
 * throttle answers every waiting call with the latest sample, which echoes its own line, so the key
 * comes from the echo: a sample is never filed under a line it was not cut for.
 */
export async function previewSlab(
  viewer: CloudViewerHandle,
  l: SectionLine,
): Promise<{ key: string; data: ProfileData }> {
  const r = await viewer.sampleSlab(
    [l.a.x, l.a.y, l.a.z],
    [l.b.x, l.b.y, l.b.z],
    l.thicknessM,
    PREVIEW_MAX_POINTS,
  );
  const at = (p: readonly number[]): MPoint => ({ x: p[0], y: p[1], z: p[2], uncertainty_m: 0 });
  return {
    key: lineKey({ a: at(r.a), b: at(r.b), thicknessM: r.thicknessM }),
    data: { s: r.s, z: r.z, rgb: r.rgb, count: r.count },
  };
}

export function profileData(p: CloudProfile): ProfileData {
  return { s: p.s, z: p.z, rgb: p.rgb, count: p.count };
}
