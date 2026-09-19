import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchDatasets } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

export interface DatasetNames {
  names: Record<string, string>;
  /** True only once the datasets list has loaded successfully (I4): tells a missing id apart from
   * "still loading" or "datasets unavailable", both of which must not claim a dataset is deleted. */
  loaded: boolean;
}

/** Dataset id -> name for the registry table; empty and not loaded when datasets are unavailable. */
export function useDatasetNames(projectId: string): DatasetNames {
  const api = useApi();
  const [state, setState] = useState<DatasetNames>({ names: {}, loaded: false });
  useEffect(() => {
    let cancelled = false;
    fetchDatasets(api, projectId)
      .then((items) => {
        if (!cancelled)
          setState({ names: Object.fromEntries(items.map((d) => [d.id, d.name])), loaded: true });
      })
      .catch((e: unknown) => {
        pushLog(`datasets unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setState({ names: {}, loaded: false });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return state;
}
