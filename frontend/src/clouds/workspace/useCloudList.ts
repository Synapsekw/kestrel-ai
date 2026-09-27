import { useCallback, useEffect, useState } from "react";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { listPointClouds, type PointCloud } from "@/api/clouds";
import { listMaps } from "@/api/maps";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { report } from "./cloudActions";

/**
 * The project's clouds and maps (S1's two bounded list reads), reloaded when an import finishes.
 * `add` and `remove` update the list at once, before a navigation that depends on it (a reload
 * answers only later, and a redirect computed from the stale list lands on the wrong cloud).
 */
export function useCloudList(projectId: string) {
  const api = useApi();
  const [clouds, setClouds] = useState<PointCloud[] | null>(null);
  const [maps, setMaps] = useState<GeoMap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    void listPointClouds(api, projectId)
      .then((cs) => {
        setClouds(cs);
        setError(null);
      })
      .catch((e: unknown) => setError(report("load point clouds", e)));
    void listMaps(api, projectId)
      .then(setMaps)
      .catch(() => setMaps([]));
  }, [api, projectId]);
  useEffect(reload, [reload]);
  useOnJobsFinished("pointcloud_import", reload);
  const replace = useCallback(
    (c: PointCloud) => setClouds((cs) => cs?.map((x) => (x.id === c.id ? c : x)) ?? cs),
    [],
  );
  const add = useCallback(
    (c: PointCloud) => setClouds((cs) => [...(cs ?? []).filter((x) => x.id !== c.id), c]),
    [],
  );
  const remove = useCallback((id: string) => setClouds((cs) => cs?.filter((x) => x.id !== id) ?? cs), []);
  return { clouds, maps, error, reload, replace, add, remove };
}
