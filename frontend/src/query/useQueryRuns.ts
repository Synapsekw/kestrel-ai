import { useCallback, useEffect, useState } from "react";
import type { QueryRun } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { fetchQueryRuns } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";

interface State {
  key: string;
  runs: QueryRun[];
  unavailable: boolean;
  error: string | null;
}

export function useQueryRuns(projectId: string): {
  runs: QueryRun[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  reload: () => void;
} {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [state, setState] = useState<State>({ key: "", runs: [], unavailable: false, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchQueryRuns(api, projectId)
      .then((runs) => {
        if (!cancelled) setState({ key, runs, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list query runs failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({
          key,
          runs: [],
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load query runs"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = state.key === key;
  return {
    runs: state.runs,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
  };
}
