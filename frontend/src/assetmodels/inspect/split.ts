// The split inspection's splitter (spec §9): the asset stage takes 22 to 75 % of the width, moved
// by pointer or keys, and remembered (one operator, one machine: localStorage is the user setting).
export const SPLIT_MIN = 22;
export const SPLIT_MAX = 75;
export const SPLIT_DEFAULT = 50;
export const SPLIT_KEY = "kestrel.inspect.split";

export function clampSplit(v: number): number {
  if (!Number.isFinite(v)) return SPLIT_DEFAULT;
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v));
}

export function splitFromKey(current: number, key: string, shift: boolean): number | null {
  const step = shift ? 10 : 2;
  if (key === "ArrowLeft") return clampSplit(current - step);
  if (key === "ArrowRight") return clampSplit(current + step);
  if (key === "Home") return SPLIT_MIN;
  if (key === "End") return SPLIT_MAX;
  return null;
}

export function splitFromPointer(clientX: number, left: number, width: number): number {
  return clampSplit(((clientX - left) / Math.max(width, 1)) * 100);
}

export function readSplit(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    return raw === null ? SPLIT_DEFAULT : clampSplit(Number(raw));
  } catch {
    return SPLIT_DEFAULT;
  }
}

export function writeSplit(v: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(Math.round(clampSplit(v))));
  } catch {
    // a blocked storage only forgets the split
  }
}
