// Pure helpers of the "Import inspection review" dialog: class prefill, missing classes, reason text.
import type { ReviewImportPreview, UnmatchedReason } from "@/api/assetReview";

type Classes = ReviewImportPreview["classes"];

/** "Cracks " and "crack" match: lower case, letters and digits only, one trailing s dropped. */
export function normName(s: string): string {
  const n = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return n.length > 3 && n.endsWith("s") ? n.slice(0, -1) : n;
}

export function prefillClassMap(
  classes: Classes,
  types: readonly { id: string; name: string }[],
): Record<string, string | null> {
  const byName = new Map(types.map((t) => [normName(t.name), t.id]));
  const out: Record<string, string | null> = {};
  for (const c of classes) out[c.key] = c.type_id ?? byName.get(normName(c.label)) ?? byName.get(normName(c.key)) ?? null;
  return out;
}

export function missingClasses(classes: Classes, map: Record<string, string | null>): string[] {
  return classes.filter((c) => !map[c.key]).map((c) => c.key);
}

export const REASON_TEXT: Record<UnmatchedReason, string> = {
  not_found: "No image with this name in the image set",
  ambiguous: "More than one image could be this photo",
  duplicate: "Another kit photo already took this image",
  size_mismatch: "The image's shape does not match the kit's photo",
};

const BY_TEXT = { path: "by path", suffix: "by folder and name", name: "by name", time_size: "by capture time and size" } as const;

export function matchedByText(by: ReviewImportPreview["matched_by"]): string | null {
  const parts = (Object.keys(BY_TEXT) as (keyof typeof BY_TEXT)[])
    .filter((k) => (by?.[k] ?? 0) > 0)
    .map((k) => `${by![k]} ${BY_TEXT[k]}`);
  return parts.length ? parts.join(", ") : null;
}

/** The refusals J5 fails the real run on (J5 note N8), said before the operator presses Import. */
export function blockers(p: ReviewImportPreview): string[] {
  const out: string[] = [];
  if (p.matched === 0) out.push("No photo in the folder matches an image in this image set.");
  if (p.model && p.model.ready_version === null && !p.has_glb) {
    out.push("The asset model has no 3D model yet and the folder has no model.glb. Import the GLB first.");
  }
  if (p.model && p.model.existing_sightings > 0) {
    out.push(`This asset model already holds ${p.model.existing_sightings} sightings. Import into a new asset model instead.`);
  }
  return out;
}
