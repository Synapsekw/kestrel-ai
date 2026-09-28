import type { ImageDetail } from "@/api/images";
import type { FootprintInput } from "./seams";

/** Ruling 18: FB draws the current frame's footprint from this; null while the detail loads. */
export function footprintInput(d: ImageDetail | null): FootprintInput | null {
  if (!d) return null;
  return {
    kind: d.footprint_kind,
    geometry: d.footprint ?? null,
    yawDeg: d.camera?.gimbal_yaw ?? null,
  };
}
