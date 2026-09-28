import { lengthLabel, type CameraScale } from "./seams";

/** Ruling 9: how each distance source reads under a size (spec §9.3 "nadir approx."). */
export const SOURCE_LABEL: Record<string, string> = {
  manual: "set by hand",
  lrf: "laser range",
  rel_alt: "nadir approx.",
};
export const PX_ONLY = "px only · no trustworthy distance";

export function basisText(s: CameraScale): string {
  return `from GSD ${s.gsdMm.toFixed(1)} mm/px at ${s.distanceM.toFixed(1)} m (${SOURCE_LABEL[s.source] ?? s.source})`;
}

/** The L tool's readout (E's `measure-readout`): FC's "412 mm ± 6 mm", then where it came from. */
export function lengthReadout(px: number, s: CameraScale | null): string {
  return s ? `${lengthLabel(px, s)} · ${basisText(s)}` : `${lengthLabel(px, null)} · ${PX_ONLY}`;
}
