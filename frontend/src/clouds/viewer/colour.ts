// frontend/src/clouds/viewer/colour.ts
import type { ColourMode } from "./materialOptions";
import type { ColourAvailability } from "./types";

/**
 * The attribute names in the octree's metadata (`pco.pcoGeometry.pointAttributes`), lower-cased.
 * Never the geometry's buffers: potree-core's decoder adds a zero `classification` buffer to every
 * node whether the file has the attribute or not (plan Ruling 9).
 */
export function attributeNames(geometry: unknown): string[] {
  const attrs = (geometry as { pointAttributes?: { attributes?: unknown } } | null)?.pointAttributes
    ?.attributes;
  if (!Array.isArray(attrs)) return [];
  const out: string[] = [];
  for (const a of attrs) {
    const name = (a as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name) out.push(name.toLowerCase());
  }
  return out;
}

export function colourAvailability(names: readonly string[]): ColourAvailability {
  return {
    rgb: names.includes("rgb") || names.includes("rgba"),
    elevation: true,
    intensity: names.includes("intensity"),
    classification: names.includes("classification"),
  };
}

/** The mode actually drawn: one the cloud lacks draws as elevation. Before load (null) nothing is drawn. */
export function effectiveColour(mode: ColourMode, a: ColourAvailability | null): ColourMode {
  if (!a || mode === "elevation") return mode;
  return a[mode] ? mode : "elevation";
}

/** Spec §7: the intensity range comes from a ≤ 100 k sample of the visible nodes. */
export const INTENSITY_SAMPLE_MAX = 100_000;

/** Every `step`-th finite value across the arrays, `step` chosen so at most `max` are taken. */
export function sampleEvery(arrays: readonly ArrayLike<number>[], max = INTENSITY_SAMPLE_MAX): number[] {
  let total = 0;
  for (const a of arrays) total += a.length;
  if (total === 0) return [];
  const step = Math.max(1, Math.ceil(total / max));
  const out: number[] = [];
  let next = 0;
  let base = 0;
  for (const a of arrays) {
    for (; next < base + a.length; next += step) {
      const v = a[next - base];
      if (Number.isFinite(v)) out.push(v);
    }
    base += a.length;
  }
  return out;
}

/** p2-p98 of the sample, or null with nothing finite to sample. Always lo < hi. */
export function intensityRange(
  arrays: readonly ArrayLike<number>[],
  max = INTENSITY_SAMPLE_MAX,
): [number, number] | null {
  const sample = Float64Array.from(sampleEvery(arrays, max));
  if (sample.length === 0) return null;
  sample.sort();
  const at = (q: number) =>
    sample[Math.min(sample.length - 1, Math.max(0, Math.round(q * (sample.length - 1))))];
  const lo = at(0.02);
  const hi = at(0.98);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}
