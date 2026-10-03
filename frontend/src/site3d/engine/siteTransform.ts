/**
 * The plant grid <-> site CRS <-> scene transform, the TypeScript mirror of
 * backend/app/asset_models/siteframe.py (spec 2026-10-03 §5, §11; index Global Constraints):
 *   [X, Y] = origin_crs + R(θ)·[E, N],  R(θ) = [[cos θ, sin θ], [−sin θ, cos θ]]  (θ = plant_north_deg)
 *   scene: x = plant N, y = EL − datum.el_m, z = plant E  (Y up, X plant north, Z plant east)
 * Both sides are pinned on contract/fixtures/plant-grid-vectors.json.
 */
export interface SiteFrameT {
  crs: { epsg: number | null; wkt: string | null };
  origin_crs: [number, number];
  plant_north_deg: number;
  datum: { label: string; el_m: number };
}

function rot(f: SiteFrameT): [number, number] {
  const t = (f.plant_north_deg * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t)];
}

export function plantToSite(f: SiteFrameT, e: number, n: number): [number, number] {
  const [c, s] = rot(f);
  return [f.origin_crs[0] + c * e + s * n, f.origin_crs[1] - s * e + c * n];
}

export function siteToPlant(f: SiteFrameT, x: number, y: number): [number, number] {
  const [c, s] = rot(f);
  const dx = x - f.origin_crs[0];
  const dy = y - f.origin_crs[1];
  return [c * dx - s * dy, s * dx + c * dy];
}

export function plantToScene(f: SiteFrameT, e: number, n: number, el: number): [number, number, number] {
  return [n, el - f.datum.el_m, e];
}

/** `z` is a plant elevation (EL), in metres. */
export function siteToScene(f: SiteFrameT, x: number, y: number, z: number): [number, number, number] {
  const [e, n] = siteToPlant(f, x, y);
  return plantToScene(f, e, n, z);
}

export function sceneToSite(f: SiteFrameT, sx: number, sy: number, sz: number): [number, number, number] {
  const [x, y] = plantToSite(f, sz, sx);
  return [x, y, sy + f.datum.el_m];
}
