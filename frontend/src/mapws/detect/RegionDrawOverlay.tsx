import { useEffect } from "react";
import { useTools, useWorkspace } from "@/mapws/w4host";
import { useDetectStore } from "./detectStore";
import { extentRing } from "./regionRun";

/** Mounted while the AI detect tool is active: the dragged box becomes the region draft (deviation 1). */
export function RegionDrawOverlay() {
  const completed = useTools((s) => s.completed);
  const clearCompleted = useTools((s) => s.clearCompleted);
  const activate = useTools((s) => s.activate);
  const select = useWorkspace((s) => s.select);
  useEffect(() => {
    if (!completed || completed.toolId !== "ai-region" || completed.geometry.type !== "Box") return;
    useDetectStore.getState().setRegionDraft(extentRing(completed.geometry.extent));
    clearCompleted();
    select({ kind: "region", id: "draft" });
    activate("select");
  }, [completed]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
