import proj4 from "proj4";
import { get as getProjection } from "ol/proj";
import Projection from "ol/proj/Projection";
import { register } from "ol/proj/proj4";
import TileGrid from "ol/tilegrid/TileGrid";
import type { Coord, SiteFrame } from "../types";
import { SITE_MAX_Z, SITE_TILE, siteResolutions } from "./siteGrid";

export const LOCAL_CODE = "kestrel-local";
const OVERZOOM_STEPS = 3;

/** djb2, base 36: a stable short code for a CRS that has no EPSG number. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function siteCode(frame: SiteFrame): string {
  if (frame.kind === "local") return LOCAL_CODE;
  if (frame.epsg) return `EPSG:${frame.epsg}`;
  return `kestrel-site-${hash(frame.proj4 ?? "")}`;
}

/**
 * The OpenLayers projection of the site frame (spec M1): the site CRS registered through proj4 and
 * `ol/proj/proj4`, or a plain metre projection for a local frame. Registering again is harmless.
 */
export function siteProjection(frame: SiteFrame): Projection {
  if (frame.kind === "local") return new Projection({ code: LOCAL_CODE, units: "m" });
  if (!frame.proj4) throw new Error("the site frame has no proj4 definition");
  const code = siteCode(frame);
  if (!proj4.defs(code)) proj4.defs(code, frame.proj4);
  register(proj4);
  const projection = getProjection(code);
  if (!projection) throw new Error(`could not register ${code}`);
  return projection;
}

/** z 0…20 of the site grid, then three overzoom steps (pixels get bigger, never blurrier). */
export function viewResolutions(): number[] {
  const r = siteResolutions();
  const last = r[r.length - 1];
  return [...r, ...Array.from({ length: OVERZOOM_STEPS }, (_, i) => last / 2 ** (i + 1))];
}

/** OpenLayers' view of the site grid: origin (0, 0), no extent, rows counted downward from the origin. */
export function siteTileGrid(maxZoom = SITE_MAX_Z): TileGrid {
  return new TileGrid({
    origin: [0, 0],
    resolutions: siteResolutions().slice(0, maxZoom + 1),
    tileSize: SITE_TILE,
  });
}

/** M-C0's helper and kind (contract/client/index.ts), re-exported so layer plugins import one place. */
export { siteTileUrl, type SiteTileKind } from "@contract/client";

export function fillTile(template: string, [z, x, y]: readonly number[]): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

type Convert = (c: Coord) => Coord;

/** Site → WGS84 lon/lat for the readout; null in a local frame. */
export function toWgs84(frame: SiteFrame): Convert | null {
  if (frame.kind !== "crs" || !frame.proj4) return null;
  const t = proj4(frame.proj4, "EPSG:4326");
  return (c) => t.forward(c) as Coord;
}

/** WGS84 lon/lat → site (a finding's lon/lat); null in a local frame. */
export function fromWgs84(frame: SiteFrame): Convert | null {
  if (frame.kind !== "crs" || !frame.proj4) return null;
  const t = proj4("EPSG:4326", frame.proj4);
  return (c) => t.forward(c) as Coord;
}

/** 100% = one screen pixel per ground pixel of the right date's ortho (spec §5 Zoom). */
export function zoomPercent(viewRes: number, nativeRes: number | null): number | null {
  if (!nativeRes || !(viewRes > 0)) return null;
  return Math.round((nativeRes / viewRes) * 100);
}
