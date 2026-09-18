import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchDatasets } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

/** Dataset id -> name for the registry table; empty when datasets are unavailable. */
export function useDatasetNames(projectId: string): Record<string, string> {
  const api = useApi();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetchDatasets(api, projectId)
      .then((items) => {
        if (!cancelled) setNames(Object.fromEntries(items.map((d) => [d.id, d.name])));
      })
      .catch((e: unknown) => {
        pushLog(`datasets unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setNames({});
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return names;
}
