import proj4 from "proj4";
import type { PointCloud } from "@/api/clouds";
import type { CloudPick } from "./CloudViewer";
import { WARN_UNCERTAINTY_M } from "./viewer/uncertainty";

export interface PickReadout {
  native: string;
  wgs84: string | null;
  zLabel: string;
  precision: string;
  warn: boolean;
}

export function formatLength(m: number): string {
  if (m < 0.01) return `${Math.round(m * 1000)} mm`;
  if (m < 1) return `${(m * 100).toFixed(1)} cm`;
  return `${m.toFixed(3)} m`;
}

/** Spec §9.2: E/N/Z to the mm with EPSG, WGS84 to 8 decimals, the Z datum, and the precision line. */
export function makePickReadout(cloud: PointCloud): (p: CloudPick) => PickReadout {
  const toWgs84 = cloud.proj4 ? proj4(cloud.proj4, "EPSG:4326") : null;
  const fileScale = formatLength(Math.max(...(cloud.scale ?? [0.001])));
  return (p) => {
    let wgs84: string | null = null;
    if (toWgs84) {
      const [lon, lat] = toWgs84.forward([p.x, p.y]);
      wgs84 = `${Math.abs(lat).toFixed(8)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(8)}° ${lon >= 0 ? "E" : "W"}`;
    }
    const warn = p.uncertainty_m > WARN_UNCERTAINTY_M;
    return {
      native: `E ${p.x.toFixed(3)} · N ${p.y.toFixed(3)} · Z ${p.z.toFixed(3)}${cloud.epsg ? ` · EPSG:${cloud.epsg}` : ""}`,
      wgs84,
      zLabel: cloud.vertical_crs ? `Z in ${cloud.vertical_crs}` : "Z as stored (no vertical datum)",
      precision: `point exact to ${fileScale} (file scale) · pick ± ${formatLength(p.uncertainty_m)} at this zoom${warn ? " — zoom in to refine" : ""}`,
      warn,
    };
  };
}
