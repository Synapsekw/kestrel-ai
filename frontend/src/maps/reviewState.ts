import type { MapDetection } from "@/api/review";
import type { PillTone } from "@/ui";

/** Review states as the review panels label them (MapReviewPanel and the map workspace inspector). */
export const REVIEW_STATE: Record<MapDetection["review_state"], { label: string; tone: PillTone }> = {
  unreviewed: { label: "Not reviewed", tone: "neutral" },
  accepted: { label: "Accepted", tone: "ok" },
  edited: { label: "Class changed", tone: "ok" },
  rejected: { label: "Rejected", tone: "danger" },
};
