import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import type { CloudClipBox } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import type { Bounds6 } from "@/clouds/viewer/camera";
import { ClipHint } from "./ClipHint";
import { defaultClipBox, readClip, recentreClip, writeClip } from "./clip";
import { applyClipBox } from "./clipEngine";
import type { WorkspaceTool } from "./types";

/**
 * The Clipping box tool (spec §7 clip box, plan Ruling 4): C places a box, a click recentres it, the
 * hint bar sizes it. The box stays applied after the tool is left and is remembered per cloud.
 */
export function useClipTool({
  cloud,
  viewer,
  running,
}: {
  cloud: PointCloud;
  viewer: RefObject<CloudViewerHandle>;
  running: boolean;
}): { tool: WorkspaceTool; box: CloudClipBox | null; restore(): void } {
  const [box, setBox] = useState<CloudClipBox | null>(() => readClip(cloud.id));
  const bounds = cloud.bounds_native as Bounds6 | null;

  useEffect(() => {
    writeClip(cloud.id, box);
  }, [cloud.id, box]);
  useEffect(() => {
    if (running) applyClipBox(viewer.current, box);
  }, [running, box, viewer]);

  const restore = useCallback(() => {
    applyClipBox(viewer.current, box);
  }, [viewer, box]);

  const tool = useMemo<WorkspaceTool>(
    () => ({
      id: "clip",
      picks: true,
      onArm: () => setBox((b) => b ?? (bounds ? defaultClipBox(bounds) : null)),
      // After "Clear box" a click places a new box there (the hint says so).
      onPick: (p) =>
        setBox((b) => (b ? recentreClip(b, p) : bounds ? recentreClip(defaultClipBox(bounds), p) : b)),
      hint: <ClipHint box={box} hasBounds={bounds !== null} onChange={setBox} />,
    }),
    [box, bounds],
  );
  return { tool, box, restore };
}
