import type { SiteFrame } from "./siteGeometry";

/**
 * Web-mercator basemap tiles laid into the Location pane's SVG frame (spec 2026-10-02-site-basemap
 * B3). Over a site-sized area the frame's local projection and mercator agree far below a pixel, so
 * each tile is a plain rectangle placed by its corners.
 */
export interface BasemapTile {
  z: number;
  x: number;
  y: number;
  /** Frame units, like the rest of the drawing. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export const BASEMAP_MAX_ZOOM = 19;
const EQUATOR_M = 40_075_016.686;
/** The frame's larger side spans about this many tiles: ≤ 3 × 3 requests, sharp at pane size. */
const TILES_ACROSS = 2;

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const phi = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(phi)) / Math.PI) / 2) * n };
}

export function tileToLonLat(x: number, y: number, z: number): { lon: number; lat: number } {
  const n = 2 ** z;
  return {
    lon: (x / n) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
  };
}

export function basemapTiles(frame: SiteFrame): BasemapTile[] {
  const nw = frame.unproject(0, 0);
  const se = frame.unproject(frame.width, frame.height);
  const lat = (nw.lat + se.lat) / 2;
  const spanM = Math.max(frame.width, frame.height) * frame.metresPerUnit;
  const ideal = Math.log2((EQUATOR_M * Math.cos((lat * Math.PI) / 180) * TILES_ACROSS) / spanM);
  const z = Math.min(BASEMAP_MAX_ZOOM, Math.max(0, Math.floor(ideal)));
  const last = 2 ** z - 1;
  const a = lonLatToTile(nw.lon, nw.lat, z);
  const b = lonLatToTile(se.lon, se.lat, z);
  const tiles: BasemapTile[] = [];
  for (let x = Math.max(0, Math.floor(a.x)); x <= Math.min(last, Math.floor(b.x)); x++) {
    for (let y = Math.max(0, Math.floor(a.y)); y <= Math.min(last, Math.floor(b.y)); y++) {
      const tl = tileToLonLat(x, y, z);
      const br = tileToLonLat(x + 1, y + 1, z);
      const p = frame.project(tl.lon, tl.lat);
      const q = frame.project(br.lon, br.lat);
      tiles.push({ z, x, y, left: p.x, top: p.y, width: q.x - p.x, height: q.y - p.y });
    }
  }
  return tiles;
}
