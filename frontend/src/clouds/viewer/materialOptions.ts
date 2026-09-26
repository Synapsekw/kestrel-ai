import type { PointCloud } from "@/api/clouds";

export type ColourMode = "rgb" | "elevation";
export const POINT_SIZE_MIN = 0.5;
export const POINT_SIZE_MAX = 3;

/** potree-core's enum values, written out so this module (and its test) never loads WebGL code:
 * ColorEncoding.SRGB = 1, PointSizeType.ADAPTIVE = 2, PointColorType.RGB = 0 / HEIGHT = 3. */
export interface MaterialOptions {
  inputColorEncoding: 1;
  outputColorEncoding: 1;
  pointSizeType: 2;
  pointColorType: 0 | 3;
  size: number;
  elevationRange: [number, number];
}

export function makeMaterialOptions(o: {
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
}): MaterialOptions {
  return {
    // Both encodings 1, or every RGB point renders pure white (spike, spec §8 "Material").
    inputColorEncoding: 1,
    outputColorEncoding: 1,
    pointSizeType: 2,
    pointColorType: o.colour === "rgb" ? 0 : 3,
    size: Math.min(POINT_SIZE_MAX, Math.max(POINT_SIZE_MIN, o.pointSize)),
    elevationRange: o.elevationRange,
  };
}

export function defaultColour(hasRgb: boolean | null | undefined): ColourMode {
  return hasRgb ? "rgb" : "elevation";
}

/** p1-p99 ignores the 0.009 % noise the spike found below -52 m; bounds when there are no stats. */
export function defaultElevationRange(
  cloud: Pick<PointCloud, "z_stats" | "bounds_native">,
): [number, number] {
  if (cloud.z_stats) return [cloud.z_stats.p1, cloud.z_stats.p99];
  const b = cloud.bounds_native;
  return b ? [b[2], b[5]] : [0, 1];
}
