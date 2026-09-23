import proj4 from "proj4";
import type { GeoMap } from "@contract/client";

export interface Readout {
  pixel: string;
  native: string | null;
  wgs84: string | null;
}

/** GDAL geotransform: x = gt0 + px*gt1 + py*gt2, y = gt3 + px*gt4 + py*gt5. */
export function pixelToNative(gt: number[], px: number, py: number): [number, number] {
  return [gt[0] + px * gt[1] + py * gt[2], gt[3] + px * gt[4] + py * gt[5]];
}

export function formatLonLat(lon: number, lat: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
}

export function formatNative(x: number, y: number, epsg: number | null): string {
  return `${x.toFixed(2)}, ${y.toFixed(2)}${epsg ? ` · EPSG:${epsg}` : ""}`;
}

/** A cursor readout for one map; the projection is built once, not per mouse move. */
export function makeReadout(
  m: Pick<GeoMap, "geotransform" | "proj4" | "epsg">,
): (px: number, py: number) => Readout {
  const gt = m.geotransform;
  const toWgs84 = m.proj4 ? proj4(m.proj4, "EPSG:4326") : null;
  return (px, py) => {
    const pixel = `${Math.round(px)}, ${Math.round(py)} px`;
    if (!gt) return { pixel, native: null, wgs84: null };
    const [x, y] = pixelToNative(gt, px, py);
    const wgs84 = toWgs84 ? formatLonLat(...(toWgs84.forward([x, y]) as [number, number])) : null;
    return { pixel, native: formatNative(x, y, m.epsg), wgs84 };
  };
}
