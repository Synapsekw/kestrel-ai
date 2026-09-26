import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchFindingSummary, type FindingSummary } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

/** The pre-aggregated counts (F §8.3 summary); null until loaded or when unavailable. */
export function useFindingSummary(projectId: string): FindingSummary | null {
  const api = useApi();
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<{ projectId: string; summary: FindingSummary } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFindingSummary(api, projectId)
      .then((summary) => {
        if (!cancelled) setLoaded({ projectId, summary });
      })
      .catch((e: unknown) => pushLog(`finding summary unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, revision]);
  return loaded?.projectId === projectId ? loaded.summary : null;
}
