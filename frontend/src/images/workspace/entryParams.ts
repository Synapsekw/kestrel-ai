import { REVIEW_LABEL, type ReviewStatusFilter } from "@/images/browser/filters";

/** A photo review status, or `all` (every photo, the review filter off). */
export type ReviewEntry = ReviewStatusFilter;

/**
 * Ruling 4: the redirects' parameters; handled once by the workspace, then dropped. m2: `source`
 * (the old `/query?source=<id>` link) is the flight filter.
 */
export const ENTRY_KEYS = ["filter", "batch", "ids", "source", "review"] as const;
export type Preset = "suggestions" | "unlabeled" | "default";

export interface Entry {
  preset: Preset | null;
  batch: boolean;
  sourceId: string | null;
  review: ReviewEntry | null;
}

const REVIEWS = Object.keys(REVIEW_LABEL) as ReviewEntry[];

export function parseEntry(q: URLSearchParams): Entry | null {
  if (!ENTRY_KEYS.some((k) => q.has(k))) return null;
  const f = q.get("filter");
  const preset: Preset | null = f === null ? null : f === "suggestions" || f === "unlabeled" ? f : "default";
  const r = q.get("review");
  const review = REVIEWS.includes(r as ReviewEntry) ? (r as ReviewEntry) : null;
  return { preset, batch: q.get("batch") === "1", sourceId: q.get("source") || null, review };
}

/** The image browser filtered by photo review status (spec §9 Register, photo outcome chips). */
export function imagesReviewPath(projectId: string, review: ReviewEntry): string {
  return `/p/${projectId}/images?review=${review}`;
}
