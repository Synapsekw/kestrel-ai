import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobLog } from "@/api/jobs";

export const LOG_POLL_MS = 2000;

interface LogState {
  jobId: string | null;
  lines: string[];
  error: string | null;
}

const EMPTY: { lines: string[]; error: string | null } = { lines: [], error: null };

/** The last `tail` lines of a job log; refreshed every 2 s while `live`. */
export function useJobLog(
  projectId: string,
  jobId: string | null,
  live: boolean,
  tail = 200,
): { lines: string[]; error: string | null } {
  const api = useApi();
  const [state, setState] = useState<LogState>({ jobId: null, lines: [], error: null });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = () => {
      fetchJobLog(api, projectId, jobId, tail)
        .then((log) => {
          if (!cancelled) setState({ jobId, lines: log.lines, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setState((s) => ({
            jobId,
            lines: s.jobId === jobId ? s.lines : [],
            error: messageOf(e, "could not read the job log"),
          }));
        });
    };
    tick();
    if (!live) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(tick, LOG_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, jobId, live, tail]);

  return state.jobId === jobId && jobId ? { lines: state.lines, error: state.error } : EMPTY;
}
