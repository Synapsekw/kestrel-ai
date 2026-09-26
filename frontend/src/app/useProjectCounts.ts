import { useEffect, useState } from "react";
import type { components } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf, unwrap } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

type ProjectOverview = components["schemas"]["ProjectOverview"];

export interface ProjectCounts {
  images: number;
  maps: number;
  pointClouds: number;
  openFindings: number;
}

export function countsFromOverview(o: ProjectOverview): ProjectCounts {
  return {
    images: o.data.images,
    maps: o.data.maps,
    pointClouds: o.data.point_clouds,
    openFindings: o.findings.by_status.open,
  };
}

/**
 * The tab counts (spec section 5.2), from the pre-aggregated overview; reloaded when data or
 * findings change. Null while loading and when the overview is unavailable: the tabs then show
 * no counts, never an error.
 */
export function useProjectCounts(projectId: string): ProjectCounts | null {
  const api = useApi();
  const revision = useChangesStore((s) => `${s.dataRevision}|${s.findingsRevision}`);
  const [loaded, setLoaded] = useState<{ projectId: string; counts: ProjectCounts | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    unwrap(api.GET("/api/v1/projects/{projectId}/overview", { params: { path: { projectId } } }))
      .then((o) => {
        if (!cancelled) setLoaded({ projectId, counts: countsFromOverview(o) });
      })
      .catch((e: unknown) => {
        pushLog(`project counts unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setLoaded({ projectId, counts: null });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);
  // A reload keeps the previous counts on screen until the new ones arrive.
  return loaded?.projectId === projectId ? loaded.counts : null;
}
