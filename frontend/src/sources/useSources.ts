import { useCallback, useEffect, useState } from "react";
import type { GeoMap, Source } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { fetchAllSources, fetchRunsBySource, type RunSummary } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";

interface Loaded {
  sources: Source[];
  maps: GeoMap[];
  runs: Map<string, RunSummary>;
}

/**
 * The sources, the maps and each source's chosen run, in three reads. The runs and the maps are
 * extras: when either cannot be read the list still shows, without them.
 */
export function useSources(projectId: string) {
  const api = useApi();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchAllSources(api, projectId),
      listMaps(api, projectId).catch((e: unknown) => {
        pushLog(`maps unavailable: ${messageOf(e, String(e))}`);
        return [] as GeoMap[];
      }),
      fetchRunsBySource(api, projectId).catch((e: unknown) => {
        pushLog(`runs unavailable: ${messageOf(e, String(e))}`);
        return new Map<string, RunSummary>();
      }),
    ])
      .then(([sources, maps, runs]) => {
        if (cancelled) return;
        setData({ sources, maps, runs });
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(messageOf(e, "could not load the sources"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, tick]);

  /** Put a saved source in place without a reload. */
  const replaceSource = useCallback((next: Source) => {
    setData((d) => d && { ...d, sources: d.sources.map((s) => (s.id === next.id ? next : s)) });
  }, []);

  /** Put a saved map in place without a reload. */
  const replaceMap = useCallback((next: GeoMap) => {
    setData((d) => d && { ...d, maps: d.maps.map((m) => (m.id === next.id ? next : m)) });
  }, []);

  return { data, error, reload, replaceSource, replaceMap };
}
