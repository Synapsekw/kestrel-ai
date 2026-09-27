// frontend/src/clouds/viewer/classes.ts
/** ASPRS LAS 1.4 standard classes with the colours the Class mode draws (spec §7, viewer/classes.ts). */
export interface AsprsClass {
  code: number;
  label: string;
  rgb: [number, number, number];
}

export const ASPRS_CLASSES: readonly AsprsClass[] = [
  { code: 0, label: "Never classified", rgb: [160, 160, 160] },
  { code: 1, label: "Unclassified", rgb: [200, 200, 200] },
  { code: 2, label: "Ground", rgb: [161, 82, 46] },
  { code: 3, label: "Low vegetation", rgb: [150, 215, 95] },
  { code: 4, label: "Medium vegetation", rgb: [60, 170, 60] },
  { code: 5, label: "High vegetation", rgb: [20, 110, 40] },
  { code: 6, label: "Building", rgb: [240, 170, 40] },
  { code: 7, label: "Low point (noise)", rgb: [255, 0, 255] },
  { code: 8, label: "Model key point", rgb: [255, 0, 0] },
  { code: 9, label: "Water", rgb: [40, 110, 230] },
  { code: 10, label: "Rail", rgb: [140, 90, 160] },
  { code: 11, label: "Road surface", rgb: [90, 90, 90] },
  { code: 12, label: "Overlap", rgb: [255, 255, 0] },
  { code: 13, label: "Wire guard", rgb: [230, 230, 120] },
  { code: 14, label: "Wire conductor", rgb: [250, 220, 60] },
  { code: 15, label: "Transmission tower", rgb: [200, 60, 60] },
  { code: 16, label: "Wire connector", rgb: [220, 120, 200] },
  { code: 17, label: "Bridge deck", rgb: [120, 120, 200] },
  { code: 18, label: "High noise", rgb: [255, 80, 160] },
];

/** potree-core's own DEFAULT colour (0.3, 0.6, 0.6) for any class not listed. */
const OTHER_RGB: [number, number, number] = [77, 153, 153];

/** rgba in 0..1 per class code, plus "DEFAULT": the shape of potree-core's `IClassification`. */
export type ClassLut = Record<string, [number, number, number, number]>;

/** A hidden class has alpha 0: in classification mode potree's shader culls it (plan Ruling 11). */
export function classificationLut(hidden: ReadonlySet<number> = new Set()): ClassLut {
  const out: ClassLut = {};
  for (const c of ASPRS_CLASSES) {
    out[String(c.code)] = [c.rgb[0] / 255, c.rgb[1] / 255, c.rgb[2] / 255, hidden.has(c.code) ? 0 : 1];
  }
  out.DEFAULT = [OTHER_RGB[0] / 255, OTHER_RGB[1] / 255, OTHER_RGB[2] / 255, 1];
  return out;
}

export function classLabel(code: number): string {
  return ASPRS_CLASSES.find((c) => c.code === code)?.label ?? `Class ${code}`;
}
