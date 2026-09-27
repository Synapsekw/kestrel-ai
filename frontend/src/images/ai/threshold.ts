export const STEP = 0.05;
export const MAX = 0.95;
const key = (projectId: string) => `kestrel.images.threshold.${projectId}`;

/** Snapped to the 0.05 grid so repeated steps never drift (0.1 + 0.05 = 0.15, not 0.15000000000000002). */
export function clampThreshold(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const snapped = Math.round(Math.min(MAX, Math.max(0, v)) / STEP) * STEP;
  return Math.round(snapped * 100) / 100;
}

export function stepThreshold(v: number, dir: 1 | -1): number {
  return clampThreshold(v + dir * STEP);
}

export function readThreshold(projectId: string): number {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? clampThreshold(n) : 0;
  } catch {
    return 0;
  }
}

export function writeThreshold(projectId: string, v: number): void {
  try {
    localStorage.setItem(key(projectId), String(clampThreshold(v)));
  } catch {
    /* private window or blocked storage: the threshold just is not remembered */
  }
}
