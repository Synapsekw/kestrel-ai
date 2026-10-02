import { useMemo } from "react";
import { useDetectStore } from "../detect/detectStore";
import { pendingCount } from "./listItems";

/** The rail badge (spec §4 "Badges"): unreviewed detections the AI list shows. */
export function usePendingCount(): number {
  const inView = useDetectStore((s) => s.inView);
  const byId = useDetectStore((s) => s.byId);
  const filters = useDetectStore((s) => s.filters);
  return useMemo(() => pendingCount(inView, byId, filters), [inView, byId, filters]);
}
