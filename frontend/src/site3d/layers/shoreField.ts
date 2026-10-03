/** A horizontal box in scene metres (x plant north, z plant east). */
export interface Box2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The foam texture's size: 512² cells, computed once per model load (Ruling 1). */
export const SHORE_GRID = 512;
/** The distance the texture encodes (0..255 ↔ 0..64 m from land). */
export const SHORE_MAX_M = 64;

/** Cells (row-major, row = z) whose centres fall inside any triangle of `tris` ([x, z] × 3 per triangle). */
export function rasterTriangles(tris: ArrayLike<number>, box: Box2, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const sx = (box.maxX - box.minX) / size;
  const sz = (box.maxZ - box.minZ) / size;
  for (let t = 0; t + 5 < tris.length; t += 6) {
    const ax = tris[t],
      az = tris[t + 1],
      bx = tris[t + 2],
      bz = tris[t + 3],
      cx = tris[t + 4],
      cz = tris[t + 5];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - box.minX) / sx));
    const i1 = Math.min(size - 1, Math.floor((Math.max(ax, bx, cx) - box.minX) / sx));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - box.minZ) / sz));
    const j1 = Math.min(size - 1, Math.floor((Math.max(az, bz, cz) - box.minZ) / sz));
    for (let j = j0; j <= j1; j++) {
      const pz = box.minZ + (j + 0.5) * sz;
      for (let i = i0; i <= i1; i++) {
        const px = box.minX + (i + 0.5) * sx;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) out[j * size + i] = 1;
      }
    }
  }
  return out;
}

/** Two-pass 3-4 chamfer distance (metres) to the nearest source cell; exact along rows and columns. */
export function chamferDistance(source: Uint8Array, size: number, cellM: number): Float32Array {
  const d = new Float32Array(size * size);
  for (let k = 0; k < d.length; k++) d[k] = source[k] ? 0 : 1e9;
  const a = cellM;
  const b = cellM * Math.SQRT2;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - size] + a);
        if (i > 0) v = Math.min(v, d[k - size - 1] + b);
        if (i < size - 1) v = Math.min(v, d[k - size + 1] + b);
      }
      d[k] = v;
    }
  for (let j = size - 1; j >= 0; j--)
    for (let i = size - 1; i >= 0; i--) {
      const k = j * size + i;
      let v = d[k];
      if (i < size - 1) v = Math.min(v, d[k + 1] + a);
      if (j < size - 1) {
        v = Math.min(v, d[k + size] + a);
        if (i < size - 1) v = Math.min(v, d[k + size + 1] + b);
        if (i > 0) v = Math.min(v, d[k + size - 1] + b);
      }
      d[k] = v;
    }
  return d;
}

/**
 * Metres to land over `box` (the sea's box), as bytes 0..255 for 0..SHORE_MAX_M; null when no land
 * falls in the box. Land wins where both cover a cell: a sea mesh often runs under the quay and the
 * land platform (Cowork's `Sea` does), and the shoreline is where the land ends, not where the sea does.
 */
export function shoreField(land: ArrayLike<number>, box: Box2, size = SHORE_GRID): Uint8Array | null {
  if (land.length === 0) return null;
  const landMask = rasterTriangles(land, box, size);
  if (!landMask.some((v) => v === 1)) return null;
  const cell = Math.max((box.maxX - box.minX) / size, (box.maxZ - box.minZ) / size);
  const dist = chamferDistance(landMask, size, cell);
  const out = new Uint8Array(size * size);
  for (let k = 0; k < out.length; k++) out[k] = Math.round(255 * Math.min(1, dist[k] / SHORE_MAX_M));
  return out;
}
