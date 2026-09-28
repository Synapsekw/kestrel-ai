import { useEffect, useState } from "react";
import { listPointClouds, type PointCloud } from "@/api/clouds";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

const NONE: readonly PointCloud[] = [];

/** The project's clouds, read once per mount (tens of rows); a failure only hides "Open in 3D". */
export function useProjectClouds(projectId: string): readonly PointCloud[] {
  const api = useApi();
  const [clouds, setClouds] = useState<readonly PointCloud[]>(NONE);
  useEffect(() => {
    let cancelled = false;
    listPointClouds(api, projectId)
      .then((items) => {
        if (!cancelled) setClouds(items);
      })
      .catch((e: unknown) => pushLog(`list clouds for Open in 3D failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return clouds;
}
