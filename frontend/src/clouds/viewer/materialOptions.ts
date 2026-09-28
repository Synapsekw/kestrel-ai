import type { PointCloud } from "@/api/clouds";

/** C-C0's `CloudViewRender.colour_mode` strings (spec §7 Colour). */
export type ColourMode = "rgb" | "elevation" | "intensity" | "classification";
export const POINT_SIZE_MIN = 0.5;
export const POINT_SIZE_MAX = 3;

/** potree-core's PointColorType: RGB 0, HEIGHT 3, INTENSITY 4, CLASSIFICATION 8 (enums.d.ts). */
export const POINT_COLOR_TYPE: Record<ColourMode, 0 | 3 | 4 | 8> = {
  rgb: 0,
  elevation: 3,
  intensity: 4,
  classification: 8,
};

/** The full uint16 range: the material's range until the first settle samples one. */
export const DEFAULT_INTENSITY_RANGE: [number, number] = [0, 65535];

/** potree-core's enum values, written out so this module (and its test) never loads WebGL code:
 * ColorEncoding.SRGB = 1, PointSizeType.ADAPTIVE = 2, PointColorType as above. */
export interface MaterialOptions {
  inputColorEncoding: 1;
  outputColorEncoding: 1;
  pointSizeType: 2;
  pointColorType: 0 | 3 | 4 | 8;
  size: number;
  elevationRange: [number, number];
  intensityRange: [number, number];
}

export function makeMaterialOptions(o: {
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
  intensityRange?: [number, number];
}): MaterialOptions {
  return {
    // Both encodings 1, or every RGB point renders pure white (spike, spec §8 "Material").
    inputColorEncoding: 1,
    outputColorEncoding: 1,
    pointSizeType: 2,
    pointColorType: POINT_COLOR_TYPE[o.colour],
    size: Math.min(POINT_SIZE_MAX, Math.max(POINT_SIZE_MIN, o.pointSize)),
    elevationRange: o.elevationRange,
    intensityRange: o.intensityRange ?? DEFAULT_INTENSITY_RANGE,
  };
}

/**
 * potree-core 2.0.15 builds a v2 (metadata.json) octree's material with `newFormat`, and its vertex
 * shader then does `#ifdef new_format vColor = rgba;` ahead of every `color_type_*` branch: the
 * colour type is ignored and every mode draws RGB. Only RGB reads `rgba`; every other mode needs
 * the define off (it reads position, intensity or classification, which both formats name alike).
 */
export function usesNewFormat(colour: ColourMode, octreeV2: boolean): boolean {
  return octreeV2 && colour === "rgb";
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
