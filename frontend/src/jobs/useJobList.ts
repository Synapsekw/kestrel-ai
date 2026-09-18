import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

export const LIST_POLL_MS = 5000;

/** Loads the project's recent jobs into the store while `enabled` (the panel is open) and every 5 s after. */
export function useJobList(
  projectId: string,
  enabled: boolean,
): { loading: boolean; error: string | null; reload: () => void } {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ key: string; error: string | null }>({ key: "", error: null });
  const key = `${projectId}|${attempt}`;

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    const tick = () => {
      fetchJobs(api, projectId)
        .then((jobs) => {
          if (cancelled) return;
          useJobsStore.getState().upsertMany(jobs);
          setStatus({ key, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          pushLog(`list jobs failed: ${messageOf(e, String(e))}`);
          setStatus({ key, error: messageOf(e, "could not load jobs") });
        });
    };
    tick();
    const id = window.setInterval(tick, LIST_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, enabled, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = status.key === key;
  return { loading: enabled && !loaded, error: loaded ? status.error : null, reload };
}
