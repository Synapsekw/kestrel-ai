// The street map under the model (spec §9 setGround): web-mercator tiles from the backend's
// basemap proxy, each placed by three corners in the asset frame with the same flat-earth offset
// the pose job uses (X = dlat * R, Z = dlon * R * cos(lat)), turned by the plant north offset.
import { BASEMAP_MAX_ZOOM, lonLatToTile, tileToLonLat } from "@/overview/basemapTiles";

export interface GroundOrigin {
  lat: number;
  lon: number;
  ground_alt_m: number;
}

export interface GroundTile {
  url: string;
  /** [x, z] corners in the asset frame (the fourth is tr + bl - tl). */
  tl: [number, number];
  tr: [number, number];
  bl: [number, number];
  y: number;
}

export const EARTH_RADIUS_M = 6_378_137;
export const MAX_GROUND_TILES = 36;
/** Just under the ground datum, so the base of the model is never z-fighting the map. */
const GROUND_Y = -0.05;
const EQUATOR_M = 2 * Math.PI * EARTH_RADIUS_M;
const DEG = Math.PI / 180;

export function toAssetXZ(
  lat: number,
  lon: number,
  origin: GroundOrigin,
  northOffsetDeg: number,
): [number, number] {
  const n = (lat - origin.lat) * DEG * EARTH_RADIUS_M;
  const e = (lon - origin.lon) * DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG);
  const t = northOffsetDeg * DEG;
  return [n * Math.cos(t) + e * Math.sin(t), -n * Math.sin(t) + e * Math.cos(t)];
}

export function groundTiles(
  origin: GroundOrigin,
  northOffsetDeg: number,
  template: string,
  radiusM: number,
): GroundTile[] {
  const r = Math.max(radiusM, 10);
  // about four tiles across the circle, then fewer if the radius would need more than the cap
  const ideal = Math.log2((EQUATOR_M * Math.cos(origin.lat * DEG) * 4) / (2 * r));
  let z = Math.min(BASEMAP_MAX_ZOOM, Math.max(0, Math.floor(ideal)));
  const dLat = r / (DEG * EARTH_RADIUS_M);
  const dLon = r / (DEG * EARTH_RADIUS_M * Math.cos(origin.lat * DEG));
  for (;;) {
    const a = lonLatToTile(origin.lon - dLon, origin.lat + dLat, z);
    const b = lonLatToTile(origin.lon + dLon, origin.lat - dLat, z);
    const xs = [Math.floor(a.x), Math.floor(b.x)];
    const ys = [Math.floor(a.y), Math.floor(b.y)];
    const count = (xs[1] - xs[0] + 1) * (ys[1] - ys[0] + 1);
    if (count > MAX_GROUND_TILES && z > 0) {
      z -= 1;
      continue;
    }
    const last = 2 ** z - 1;
    const tiles: GroundTile[] = [];
    for (let x = Math.max(0, xs[0]); x <= Math.min(last, xs[1]); x++) {
      for (let y = Math.max(0, ys[0]); y <= Math.min(last, ys[1]); y++) {
        const nw = tileToLonLat(x, y, z);
        const ne = tileToLonLat(x + 1, y, z);
        const sw = tileToLonLat(x, y + 1, z);
        tiles.push({
          url: template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y)),
          tl: toAssetXZ(nw.lat, nw.lon, origin, northOffsetDeg),
          tr: toAssetXZ(ne.lat, ne.lon, origin, northOffsetDeg),
          bl: toAssetXZ(sw.lat, sw.lon, origin, northOffsetDeg),
          y: GROUND_Y,
        });
      }
    }
    return tiles;
  }
}
