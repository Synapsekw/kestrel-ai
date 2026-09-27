import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type { PointCloud } from "@/api/clouds";
import { between, cloudsForMap, insideXY, jumpQuery } from "@/clouds/jump";
import { useWorkspace, useWorkspaceStores } from "./context";
import type { SiteFrame, Survey } from "./types";

export const NO_FRAME_3D = "This site has no coordinates, so its spots cannot be opened in 3D.";

export interface OpenIn3dContext {
  frame: SiteFrame;
  surveys: readonly Survey[];
  clouds: readonly PointCloud[];
}

export type OpenIn3d = { href: string; cloud: PointCloud } | { href: null; reason: string };

/**
 * Today's map → 3D jump (spec 2026-09-23-point-clouds §10, `maps/MapContextMenu.tsx`): the ready clouds
 * linked to the maps of `date`'s survey, newest first; the first whose footprint covers the spot, with
 * `?at=` in that cloud's native CRS (`clouds/jump.ts`).
 */
export function openIn3dHref(
  projectId: string,
  e: number,
  n: number,
  date: string | null,
  ctx: OpenIn3dContext,
): OpenIn3d {
  const { frame } = ctx;
  if (frame.kind !== "crs" || !frame.proj4) return { href: null, reason: NO_FRAME_3D };
  if (!date) return { href: null, reason: "Pick a survey date to open a spot in 3D." };
  const survey = ctx.surveys.find((s) => s.date === date && !s.planned);
  const linked = (survey?.maps ?? []).flatMap((m) => cloudsForMap([...ctx.clouds], m.id));
  if (linked.length === 0)
    return {
      href: null,
      reason: `No point cloud is linked to the ${date} survey.`,
    };
  const from = { proj4: frame.proj4, epsg: frame.epsg };
  for (const cloud of linked) {
    const at = between(from, cloud)({ x: e, y: n });
    if (!cloud.bounds_native || insideXY(cloud.bounds_native, at))
      return {
        href: `/p/${projectId}/clouds/${cloud.id}${jumpQuery(at)}`,
        cloud,
      };
  }
  return {
    href: null,
    reason: `No point cloud of the ${date} survey covers this spot.`,
  };
}

/** `openIn3dHref` with the workspace's frame, surveys and clouds; the date defaults to r. */
export function useOpenIn3d(): (e: number, n: number, date?: string | null) => OpenIn3d {
  const { projectId, frame } = useWorkspaceStores();
  const { surveys, clouds, r } = useWorkspace(
    useShallow((s) => ({ surveys: s.surveys, clouds: s.clouds, r: s.r })),
  );
  return useCallback(
    (e: number, n: number, date?: string | null) =>
      openIn3dHref(projectId, e, n, date === undefined ? r : date, {
        frame,
        surveys,
        clouds,
      }),
    [projectId, frame, surveys, clouds, r],
  );
}
