/** Drawn points. A full scan is 300 000 sprites; this many keeps orbit and zoom on the mesh's frame time. */
export const OVERLAY_BUDGET = 32_000;

const DIVISIONS = 8;
const MIN_EXTENT = 1e-6;

export interface OverlayBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface OverlayPlane {
  nx: number;
  ny: number;
  nz: number;
  c: number;
}

export interface OverlayGrid {
  cells: Float32Array[];
  boxes: OverlayBox[];
  center: [number, number, number];
  radius: number;
}

function bin(v: number, min: number, size: number, div: number): number {
  const t = Math.floor(((v - min) / size) * div);
  if (t < 0) return 0;
  return t >= div ? div - 1 : t;
}

/** xorshift32. Fixed seed so a scan lands in the same cells every time it is shown. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bins a scan into a grid. A cell's prefix is a shuffle, so the first points kept are spread through it. */
export function buildOverlayGrid(points: Float32Array, divisions = DIVISIONS): OverlayGrid {
  const div = divisions;
  const n = Math.floor(points.length / 3);
  const cellCount = div * div * div;
  const cells: Float32Array[] = new Array(cellCount);
  const boxes: OverlayBox[] = new Array(cellCount);

  if (n === 0) {
    for (let i = 0; i < cellCount; i++) {
      cells[i] = new Float32Array(0);
      boxes[i] = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
    }
    return { cells, boxes, center: [0, 0, 0], radius: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const x = points[o];
    const y = points[o + 1];
    const z = points[o + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const sizeX = Math.max(maxX - minX, MIN_EXTENT);
  const sizeY = Math.max(maxY - minY, MIN_EXTENT);
  const sizeZ = Math.max(maxZ - minZ, MIN_EXTENT);

  const counts = new Uint32Array(cellCount);
  const cellOf = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const cell =
      bin(points[o], minX, sizeX, div) +
      div * (bin(points[o + 1], minY, sizeY, div) + div * bin(points[o + 2], minZ, sizeZ, div));
    cellOf[i] = cell;
    counts[cell]++;
  }

  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const rand = mulberry32(5);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }

  const offsets = new Uint32Array(cellCount);
  for (let c = 0; c < cellCount; c++) {
    cells[c] = new Float32Array(counts[c] * 3);
    const ix = c % div;
    const iy = Math.floor(c / div) % div;
    const iz = Math.floor(c / (div * div));
    boxes[c] = {
      minX: minX + (ix / div) * sizeX,
      minY: minY + (iy / div) * sizeY,
      minZ: minZ + (iz / div) * sizeZ,
      maxX: minX + ((ix + 1) / div) * sizeX,
      maxY: minY + ((iy + 1) / div) * sizeY,
      maxZ: minZ + ((iz + 1) / div) * sizeZ,
    };
  }
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const cell = cellOf[i];
    const dst = offsets[cell];
    const o = i * 3;
    const bucket = cells[cell];
    bucket[dst] = points[o];
    bucket[dst + 1] = points[o + 1];
    bucket[dst + 2] = points[o + 2];
    offsets[cell] = dst + 3;
  }

  return {
    cells,
    boxes,
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    radius: 0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ),
  };
}

function outside(box: OverlayBox, planes: readonly OverlayPlane[]): boolean {
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    const x = p.nx >= 0 ? box.maxX : box.minX;
    const y = p.ny >= 0 ? box.maxY : box.minY;
    const z = p.nz >= 0 ? box.maxZ : box.minZ;
    if (p.nx * x + p.ny * y + p.nz * z + p.c < 0) return true;
  }
  return false;
}

/** Sets a bit per cell that has points and meets every plane. `mask` is one bit per cell. */
export function markVisibleCells(grid: OverlayGrid, planes: readonly OverlayPlane[], mask: Uint8Array): void {
  mask.fill(0);
  const { cells, boxes } = grid;
  for (let i = 0; i < boxes.length; i++) {
    if (cells[i].length < 3 || outside(boxes[i], planes)) continue;
    mask[i >> 3] |= 1 << (i & 7);
  }
}

function quotas(counts: readonly number[], budget: number): number[] {
  const take = counts.map(() => 0);
  let left = budget;
  const active: number[] = [];
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) active.push(i);
  while (left > 0 && active.length > 0) {
    const share = Math.ceil(left / active.length);
    for (let k = active.length - 1; k >= 0; k--) {
      const i = active[k];
      const n = Math.min(counts[i] - take[i], share, left);
      take[i] += n;
      left -= n;
      if (take[i] >= counts[i]) active.splice(k, 1);
      if (left === 0) break;
    }
  }
  return take;
}

/** Writes up to `budget` points from the marked cells into `into`. Short cells give their spare share to fuller ones. */
export function gatherVisiblePoints(
  grid: OverlayGrid,
  mask: Uint8Array,
  budget: number,
  into: Float32Array,
): number {
  if (budget <= 0) return 0;
  const ids: number[] = [];
  const counts: number[] = [];
  let available = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if ((mask[i >> 3] & (1 << (i & 7))) === 0) continue;
    const count = grid.cells[i].length / 3;
    if (count <= 0) continue;
    ids.push(i);
    counts.push(count);
    available += count;
  }
  if (ids.length === 0) return 0;
  const take = quotas(counts, Math.min(budget, available));
  let written = 0;
  for (let k = 0; k < ids.length; k++) {
    const n = take[k];
    if (n === 0) continue;
    into.set(grid.cells[ids[k]].subarray(0, n * 3), written * 3);
    written += n;
  }
  return written;
}
