import { useCallback, useEffect, useState } from "react";
import type { Dataset } from "@contract/client";
import { useApi } from "@/api/client";
import { fetchDatasets } from "@/api/datasets";
import { isNotImplemented, messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";

export interface DatasetsList {
  datasets: Dataset[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  reload: () => void;
}

interface State {
  key: string;
  datasets: Dataset[];
  unavailable: boolean;
  error: string | null;
}

export function useDatasets(projectId: string): DatasetsList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", datasets: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchDatasets(api, projectId)
      .then((datasets) => {
        if (!cancelled) setState({ key, datasets, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load datasets failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({
          key,
          datasets: [],
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load datasets"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = state.key === key;
  return {
    datasets: state.datasets,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
  };
}
