import type { Source } from "@contract/client";
import type { AreaAnalytics } from "@/api/analytics";
import type { SurveyTimeline } from "@/api/surveys";

type ClassRef = SurveyTimeline["classes"][number];

/** "6 (4 verified)", or just the verified number when only verified detections count. */
export function countText(total: number, verified: number, verifiedOnly: boolean): string {
  if (verifiedOnly) return verified ? String(verified) : "-";
  if (!total && !verified) return "-";
  return `${total} (${verified} verified)`;
}

export function reviewText(review: { total: number; reviewed: number }): string {
  if (!review.total) return "nothing to review";
  return `${review.reviewed} of ${review.total} reviewed`;
}

export const PHOTO_CAPTION =
  "Detections in photos (not object counts: the same object appears in several photos)";

/**
 * One site area's counts across surveys, shaped as a survey timeline so `SurveyChart` can draw its
 * trend. Surveys whose map misses the area are left out; a survey counted another way stays in and
 * is drawn hollow, exactly as on the main chart.
 */
export function areaTimeline(
  areas: AreaAnalytics,
  areaId: string,
  classes: ClassRef[],
  verifiedOnly: boolean,
): SurveyTimeline {
  const surveys = areas.surveys
    .filter((s) => s.per_area[areaId])
    .map((s) => {
      const cell = s.per_area[areaId];
      const counts = Object.fromEntries(
        Object.entries(cell.counts).map(([c, v]) => [c, verifiedOnly ? v.verified : v.total]),
      );
      const verified = Object.fromEntries(Object.entries(cell.counts).map(([c, v]) => [c, v.verified]));
      return {
        map_id: s.map_id,
        map_name: s.map_name,
        captured_on: s.captured_on,
        date_is_import_date: false,
        run_id: null,
        model_name: null,
        conf: null,
        pinned: false,
        counts,
        verified_counts: verified,
        deltas: {},
        state: s.state,
        reason: null,
      };
    });
  return { basis: null, classes, surveys };
}

/** A copy of `set` with `id` switched in or out. */
export function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Newest survey first; a source with no date after every dated one. */
export function sortSources(sources: Source[]): Source[] {
  return [...sources].sort((a, b) => {
    if (a.captured_on !== b.captured_on) {
      if (!a.captured_on) return 1;
      if (!b.captured_on) return -1;
      return a.captured_on < b.captured_on ? 1 : -1;
    }
    return a.created_at < b.created_at ? 1 : -1;
  });
}
