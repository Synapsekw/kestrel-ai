import { useCallback, useEffect, useState } from "react";
import type { AssetModelRun } from "@contract/client";
import { getRun, stopRun } from "@/api/assetModels";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";

export const RUN_POLL_MS = 2000;
/** Consecutive failed polls before the hook gives up and exposes `error`. */
export const RUN_POLL_MAX_FAILURES = 5;

/**
 * Polls `GET .../runs/{id}` every `RUN_POLL_MS` while the run is `running`. State is keyed by run id, so
 * switching runs never shows the previous run or its error. After `RUN_POLL_MAX_FAILURES` consecutive
 * failures polling stops and `error` carries the reason.
 */
export function useLiveRun(projectId: string, modelId: string, liveRunId: string | null) {
  const api = useApi();
  const [state, setState] = useState<{
    runId: string;
    run: AssetModelRun | null;
    error: string | null;
  } | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    if (!liveRunId) return;
    let alive = true;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await getRun(api, projectId, modelId, liveRunId);
        if (!alive) return;
        failures = 0;
        setState({ runId: liveRunId, run: r, error: null });
        if (r.state === "running") timer = setTimeout(() => void tick(), RUN_POLL_MS);
      } catch (e) {
        if (!alive) return;
        failures += 1;
        if (failures >= RUN_POLL_MAX_FAILURES) {
          const error = messageOf(e, "could not load the run");
          setState((s) => ({ runId: liveRunId, run: s?.runId === liveRunId ? s.run : null, error }));
        } else {
          timer = setTimeout(() => void tick(), RUN_POLL_MS * 2);
        }
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, projectId, modelId, liveRunId]);

  const stop = useCallback(async () => {
    if (!liveRunId) return;
    setStopping(true);
    try {
      const r = await stopRun(api, projectId, modelId, liveRunId);
      setState({ runId: liveRunId, run: r, error: null });
    } finally {
      setStopping(false);
    }
  }, [api, projectId, modelId, liveRunId]);

  const current = state && state.runId === liveRunId ? state : null;
  return { run: current?.run ?? null, error: current?.error ?? null, stop, stopping };
}
