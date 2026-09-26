import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Job, LibraryModel, LibraryStatus } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelLibraryJob, fetchLibraryStatus } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { jobTitle } from "@/jobs/jobLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Disclosure, EmptyState, Progress, Segmented, Skeleton, SkeletonRows } from "@/ui";
import { ImportModelForm } from "./ImportModelForm";
import { ModelDetail } from "./ModelDetail";
import { ModelTable } from "./ModelTable";
import { StarterModels } from "./StarterModels";
import { useLibraryJobs } from "./useLibraryJobs";
import { useLibraryModels } from "./useLibraryModels";

type TaskFilter = "all" | LibraryModel["task"];
type OriginFilter = "all" | LibraryModel["origin"];
type Adding = "file" | "starter" | null;

const TASKS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "All tasks" },
  { value: "detect", label: "Boxes" },
  { value: "obb", label: "Rotated boxes" },
];

const ORIGINS: { value: OriginFilter; label: string }[] = [
  { value: "all", label: "All origins" },
  { value: "trained", label: "Trained" },
  { value: "imported", label: "Imported" },
  { value: "starter", label: "Starter" },
];

/** A running import, export or starter download: title, bar, message and a cancel button. */
function JobRow({ job }: { job: Job }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = jobTitle(job);

  async function cancel() {
    setBusy(true);
    try {
      useJobsStore.getState().upsert(await cancelLibraryJob(api, job.id));
    } catch (e) {
      pushLog(`cancel library job ${job.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not cancel the job"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex items-center gap-3 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium" title={title}>
          {title}
        </span>
        <span className="text-xs tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
        <Button size="sm" variant="ghost" loading={busy} onClick={() => void cancel()}>
          Cancel
        </Button>
      </div>
      <Progress value={job.progress} running={job.state === "running"} label={`${title} progress`} />
      {job.message && <p className="truncate text-xs text-muted">{job.message}</p>}
      {error && <Alert tone="danger">{error}</Alert>}
    </li>
  );
}

/** The library once it is known to be open: jobs, filters, list and detail. */
function LibraryContent() {
  const library = useLibraryModels();
  const { models, reload, replace, remove } = library;
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("model");
  const [adding, setAdding] = useState<Adding>(null);
  const [task, setTask] = useState<TaskFilter>("all");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [failed, setFailed] = useState<Job[]>([]);

  const select = useCallback(
    (id: string | null) => setParams(id ? { model: id } : {}, { replace: true }),
    [setParams],
  );

  const onFinished = useCallback(
    (job: Job) => {
      if (job.state !== "succeeded") {
        setFailed((f) => [job, ...f.filter((j) => j.id !== job.id)]);
        return;
      }
      reload();
      const created = job.result?.model_id;
      const exported = job.params?.model_id;
      if (typeof created === "string") select(created);
      else if (typeof exported === "string") select(exported);
    },
    [reload, select],
  );
  const { jobs, track } = useLibraryJobs(onFinished);
  const running = jobs.filter(isActiveJob);

  const started = useCallback(
    (job: Job) => {
      track(job);
      setAdding(null);
    },
    [track],
  );

  const shown = useMemo(
    () =>
      models.filter((m) => (task === "all" || m.task === task) && (origin === "all" || m.origin === origin)),
    [models, task, origin],
  );
  const selected = models.find((m) => m.id === selectedId) ?? null;
  const toggle = (which: Exclude<Adding, null>) => (open: boolean) => setAdding(open ? which : null);

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Library</h1>
          {library.loading ? (
            <Skeleton className="h-4 w-20 self-center" />
          ) : (
            <span className="text-xs tabular-nums text-muted">
              {models.length} {models.length === 1 ? "model" : "models"}
            </span>
          )}
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          Every model on this computer, for every project: trained here, imported from a file, or a starter
          model.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Disclosure label="Import a model file" open={adding === "file"} onOpenChange={toggle("file")}>
          <ImportModelForm onStarted={started} onClose={() => setAdding(null)} />
        </Disclosure>
        <Disclosure label="Add a starter model" open={adding === "starter"} onOpenChange={toggle("starter")}>
          <StarterModels existingNames={models.map((m) => m.name)} onStarted={started} />
        </Disclosure>
      </div>

      {(running.length > 0 || failed.length > 0) && (
        <section aria-label="Library jobs" className="flex max-w-3xl flex-col gap-2">
          {running.length > 0 && (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-panel px-4">
              {running.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          )}
          {failed.map((job) => (
            <Alert
              key={job.id}
              tone={job.state === "failed" ? "danger" : "info"}
              title={`${jobTitle(job)} ${job.state === "failed" ? "failed" : "cancelled"}`}
              onDismiss={() => setFailed((f) => f.filter((j) => j.id !== job.id))}
            >
              {job.error}
            </Alert>
          ))}
        </section>
      )}

      {library.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={reload}>
              Retry
            </Button>
          }
        >
          {library.error}
        </Alert>
      )}

      {library.unavailable && (
        <Alert tone="danger" title="The model library could not be opened">
          Projects still open, but runs and training need the library. Check the library folder, then restart
          the app.
        </Alert>
      )}

      {library.loading && models.length === 0 ? (
        <SkeletonRows rows={3} columns={4} />
      ) : models.length === 0 && !library.error && !library.unavailable ? (
        <EmptyState icon="models" title="No models in the library yet">
          Train a model in a training project, import a model file, or add a starter model above.
        </EmptyState>
      ) : (
        models.length > 0 && (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(22rem,28rem)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Segmented label="Task" size="sm" options={TASKS} value={task} onChange={setTask} />
                <Segmented label="Origin" size="sm" options={ORIGINS} value={origin} onChange={setOrigin} />
              </div>
              {shown.length > 0 ? (
                <ModelTable models={shown} selectedId={selectedId} onSelect={select} />
              ) : (
                <p className="py-4 text-sm text-muted">No models match these filters.</p>
              )}
            </div>
            {selected ? (
              <ModelDetail
                key={selected.id}
                model={selected}
                onChanged={replace}
                onJobStarted={track}
                onDeleted={(id) => {
                  remove(id);
                  select(null);
                }}
              />
            ) : (
              <p className="hidden py-4 text-sm text-muted xl:block">
                Select a model to see where it came from, how well it finds objects, and to rename or export
                it.
              </p>
            )}
          </div>
        )
      )}
    </>
  );
}

type StatusState = { kind: "loading" } | { kind: "ready"; status: LibraryStatus | null };

/** App-level `/library`: every model on this computer, usable by every project (spec section 4.4). */
export function LibraryScreen() {
  const api = useApi();
  const [state, setState] = useState<StatusState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchLibraryStatus(api)
      .then((status) => {
        if (!cancelled) setState({ kind: "ready", status });
      })
      .catch((e: unknown) => {
        // Unknown status: let the list try; its own error explains what went wrong.
        pushLog(`library status failed: ${messageOf(e, String(e))}`);
        if (!cancelled) setState({ kind: "ready", status: null });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <section className="flex flex-col gap-6">
      {state.kind === "loading" ? (
        <>
          <Skeleton className="h-7 w-32" />
          <SkeletonRows rows={3} columns={4} />
        </>
      ) : state.status && !state.status.available ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight">Library</h1>
          <Alert tone="danger" title="The model library could not be opened">
            <p>{state.status.error ?? "The library folder cannot be read."}</p>
            <p className="mt-2 text-muted">
              Projects still open, but runs and training need the library. Check the folder, then restart the
              app:
            </p>
            <p className="mt-1 break-all font-mono text-[13px]">{state.status.root}</p>
          </Alert>
        </>
      ) : (
        <LibraryContent />
      )}
    </section>
  );
}
