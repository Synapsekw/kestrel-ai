import type { Vec3 } from "./types";

/** Spec §9.1: at least this many hits within 3u of the pick. */
export const NORMAL_MIN_HITS = 8;
/** Spec §9.1: smallest/middle eigenvalue above this is "no clear surface". */
export const NORMAL_MAX_RATIO = 0.3;
export const NORMAL_RADIUS_U = 3;

/**
 * Eigen-decomposition of a symmetric 3 × 3 matrix by cyclic Jacobi rotations (float64): the values
 * ascending, each with its unit eigenvector.
 */
export function symmetricEigen3(m: readonly (readonly number[])[]): {
  values: [number, number, number];
  vectors: [Vec3, Vec3, Vec3];
} {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  const pairs: Array<[number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    if (a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2 < 1e-30) break;
    for (const [p, q] of pairs) {
      if (a[p][q] === 0) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k][p];
        const akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p][k];
        const aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k][p];
        const vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  const col = (i: number): Vec3 => {
    const n = Math.hypot(v[0][i], v[1][i], v[2][i]);
    return [v[0][i] / n, v[1][i] / n, v[2][i] / n];
  };
  return {
    values: [a[order[0]][order[0]], a[order[1]][order[1]], a[order[2]][order[2]]],
    vectors: [col(order[0]), col(order[1]), col(order[2])],
  };
}

/**
 * The surface normal at a pick (spec §9.1): PCA over the hits within 3u of the pick, the
 * smallest-eigenvalue eigenvector, oriented towards the camera. Null with fewer than 8 such hits,
 * when smallest/middle > 0.3, or when the middle eigenvalue is 0 (a line or a point).
 */
export function pcaNormal(hits: readonly Vec3[], pick: Vec3, u: number, cameraPos: Vec3): Vec3 | null {
  const r = NORMAL_RADIUS_U * u;
  // offsets from the pick: small float64 numbers, whatever the CRS's magnitude
  const near: Vec3[] = [];
  for (const h of hits) {
    const d: Vec3 = [h[0] - pick[0], h[1] - pick[1], h[2] - pick[2]];
    if (Math.hypot(d[0], d[1], d[2]) <= r) near.push(d);
  }
  if (near.length < NORMAL_MIN_HITS) return null;
  const mean = [0, 0, 0];
  for (const d of near) for (let i = 0; i < 3; i += 1) mean[i] += d[i] / near.length;
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const d of near) {
    const e = [d[0] - mean[0], d[1] - mean[1], d[2] - mean[2]];
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) cov[i][j] += (e[i] * e[j]) / near.length;
  }
  const { values, vectors } = symmetricEigen3(cov);
  const scale = Math.max(values[2], 1e-300);
  if (values[1] <= 1e-12 * scale) return null; // a line or a point: no surface
  if (Math.max(values[0], 0) / values[1] > NORMAL_MAX_RATIO) return null;
  const n = vectors[0];
  const toCam = [cameraPos[0] - pick[0], cameraPos[1] - pick[1], cameraPos[2] - pick[2]];
  const facing = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2];
  return facing < 0 ? [-n[0], -n[1], -n[2]] : n;
}
