import { useMemo } from "react";
import { isPending } from "../detect/detectModel";
import { useDetectStore } from "../detect/detectStore";

/** The rail badge (spec §4 "Badges"): unreviewed detections in view. */
export function usePendingCount(): number {
  const inView = useDetectStore((s) => s.inView);
  const byId = useDetectStore((s) => s.byId);
  return useMemo(
    () =>
      Object.values(inView).reduce(
        (n, ids) => n + ids.filter((id) => byId.has(id) && isPending(byId.get(id)!.d)).length,
        0,
      ),
    [inView, byId],
  );
}
