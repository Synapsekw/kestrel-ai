import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { useProject } from "@/api/project";
import { fetchRuns, pinRun, type RunSummary } from "@/api/runs";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { RunDialog } from "@/runs/RunDialog";
import { RunTable } from "@/runs/RunTable";
import { Alert, Button, EmptyState, SkeletonRows } from "@/ui";

/**
 * Runs: each applies one model to one source (a batch of photos or a map). The table shows what
 * every run found and how far its review has got; a pinned run is the one its source counts with.
 * `?source=<id>` opens a new run with that source picked (the Sources screen links here).
 */
export function RunsScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const preselect = params.get("source");
  const { project } = useProject(projectId);
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);
  const [dialog, setDialog] = useState<string[] | null>(preselect ? [preselect] : null);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchRuns(api, projectId)
      .then((page) => {
        if (cancelled) return;
        setRuns(page.items);
        setCursor(page.next_cursor);
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(messageOf(e, "could not load the runs")));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, attempt]);

  useOnJobsFinished("infer", reload);
  useOnJobsFinished("map_detect", reload);
  useOnJobsFinished("recount", reload);

  async function more() {
    if (!cursor) return;
    setMoreBusy(true);
    try {
      const page = await fetchRuns(api, projectId, { cursor });
      setRuns((was) => [...(was ?? []), ...page.items]);
      setCursor(page.next_cursor);
    } catch (e) {
      setError(messageOf(e, "could not load more runs"));
    } finally {
      setMoreBusy(false);
    }
  }

  async function pin(run: RunSummary, pinned: boolean) {
    setPinning(run.id);
    try {
      await pinRun(api, projectId, run.id, pinned);
      reload(); // pinning one run unpins the others of its source
    } catch (e) {
      setError(messageOf(e, "could not pin the run"));
    } finally {
      setPinning(null);
    }
  }

  function closeDialog() {
    setDialog(null);
    if (preselect) setParams({}, { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Runs</h1>
          <p className="mt-1 text-sm text-muted">
            Each run applies a model to one source. Pin a run to make it the one that source counts with.
          </p>
        </div>
        <Button variant="primary" icon="detect" onClick={() => setDialog([])}>
          New run
        </Button>
      </div>
      {error && (
        <Alert tone="danger" className="mt-4" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      {!runs && !error && (
        <div className="mt-6">
          <SkeletonRows rows={3} columns={5} />
        </div>
      )}
      {runs && runs.length === 0 && (
        <EmptyState
          icon="detect"
          title="No runs yet"
          className="mt-6"
          action={
            <Button variant="primary" icon="detect" onClick={() => setDialog([])}>
              New run
            </Button>
          }
        >
          Pick photos or a map and a model. The first run in a project without classes takes its classes from
          the model.
        </EmptyState>
      )}
      {runs && runs.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <RunTable
            runs={runs}
            classes={project?.classes ?? []}
            pinning={pinning}
            onPin={(r, p) => void pin(r, p)}
          />
          {cursor && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => void more()} loading={moreBusy}>
                Show older runs
              </Button>
            </div>
          )}
        </div>
      )}
      {dialog && (
        <RunDialog
          projectId={projectId}
          initialSourceIds={dialog}
          onClose={closeDialog}
          onStarted={() => {
            closeDialog();
            reload();
          }}
        />
      )}
    </div>
  );
}
