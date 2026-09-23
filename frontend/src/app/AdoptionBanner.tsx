import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { fetchAdoption, retryAdoption, type AdoptionStatus } from "@/api/adoption";
import { messageOf } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Progress } from "@/ui";
import { useProjectKind } from "./useProjectKind";

/**
 * Home's notice about a training project's old models moving into the app-wide library: progress
 * while the adoption job runs, the models it could not move with a Retry, and nothing once all are in.
 */
export function AdoptionBanner({ projectId }: { projectId: string }) {
  const api = useApi();
  const kind = useProjectKind(projectId);
  const [status, setStatus] = useState<AdoptionStatus | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  useOnJobsFinished("library_adopt", reload);

  useEffect(() => {
    if (kind !== "train") return;
    let cancelled = false;
    fetchAdoption(api, projectId)
      .then(async (s) => {
        if (cancelled) return;
        setStatus(s);
        if (s.job_id && !useJobsStore.getState().jobs[s.job_id]) {
          const job = await fetchJob(api, projectId, s.job_id);
          if (!cancelled) useJobsStore.getState().upsert(job);
        }
      })
      .catch((e: unknown) => pushLog(`adoption status unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, kind, revision]);

  const job = useJobsStore((s) => (status?.job_id ? s.jobs[status.job_id] : undefined));

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const started = await retryAdoption(api, projectId);
      useJobsStore.getState().upsert(started);
      setStatus((s) => s && { ...s, missing: [], job_id: started.id });
    } catch (e) {
      pushLog(`adoption retry failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start moving the models again"));
      reload();
    } finally {
      setBusy(false);
    }
  }

  if (kind !== "train" || !status) return null;

  const running = status.job_id !== null && (!job || isActiveJob(job));
  if (running && status.pending > 0) {
    return (
      <Alert tone="info" role="status" title="Moving this project's models into your library…">
        <div className="mt-2 flex max-w-md flex-col gap-1.5">
          <Progress value={job?.progress} running label="Moving models into the library" />
          {job?.message && <span className="truncate text-xs text-muted">{job.message}</span>}
        </div>
      </Alert>
    );
  }

  if (status.missing.length > 0) {
    return (
      <Alert
        tone="warn"
        role="status"
        title={
          status.missing.length === 1
            ? "One model could not be moved into your library"
            : `${status.missing.length} models could not be moved into your library`
        }
        actions={
          <Button size="sm" icon="refresh" loading={busy} onClick={() => void retry()}>
            Retry
          </Button>
        }
      >
        <p className="mt-1 text-sm text-muted">
          Everything else in this project works. Put the files back where they were, then retry.
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {status.missing.map((m) => (
            <li key={m.old_model_id} className="flex min-w-0 flex-wrap gap-x-2">
              <span className="font-medium text-ink">{m.name}</span>
              <span className="min-w-0 break-all font-mono text-xs leading-5 text-muted">{m.error}</span>
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Alert>
    );
  }

  return null;
}
