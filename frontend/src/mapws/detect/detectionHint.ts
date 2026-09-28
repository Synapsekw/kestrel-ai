import type { Selection } from "@/mapws/w4host";
import { isPending, parseDetectionId } from "./detectModel";
import { useDetectStore } from "./detectStore";

export const REVIEW_HINT = "Reviewing · A accept · X reject · Tab next";

/** The hint pill while a pending detection is selected (spec §5.1). */
export function detectionHint(sel: Selection): string | null {
  const p = parseDetectionId(sel.id);
  const entry = p ? useDetectStore.getState().byId.get(p.detectionId) : undefined;
  return entry && isPending(entry.d) ? REVIEW_HINT : null;
}
