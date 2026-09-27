import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { TrainRequest } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { LIBRARY_JOBS } from "@/api/library";
import { fetchTrainingRun, startTrainingRun, type TrainingRun } from "@/api/trainingRuns";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { pushLog } from "@/app/diagnostics";
import { formatDuration, stateLabel } from "@/jobs/jobLabels";
import { JOB_STATE_TONE } from "@/jobs/jobsFilters";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { formatLocalDate, formatMetric } from "@/library/modelLabels";
import { TrainingCurve } from "@/library/TrainingCurve";
import { useLibraryModels } from "@/library/useLibraryModels";
import { useJobsStore } from "@/store/jobs";
import { TrainForm } from "@/train/TrainForm";
import { TrainProgress } from "@/train/TrainProgress";
import { toTrainable } from "@/train/trainModel";
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  GlassPanel,
  IconButton,
  InspectorPane,
  InspectorSection,
  Pill,
  Skeleton,
  SkeletonRows,
  type Column,
} from "@/ui";
import { CompareCurves } from "./CompareCurves";
import { compareProblem, readCompare } from "./compareModel";
import { useItemById } from "./useItemById";
import { useLibraryDatasets } from "./useLibraryDatasets";
import { useResultsCurve } from "./useResultsCurve";
import { useTrainingRuns } from "./useTrainingRuns";

function runSeconds(run: TrainingRun): number | null {
  if (!run.finished_at) return null;
  return Math.max(0, Math.round((Date.parse(run.finished_at) - Date.parse(run.created_at)) / 1000));
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className="min-w-0 truncate font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function RunDetail({
  run,
  datasetName,
  modelName,
  onClose,
}: {
  run: TrainingRun;
  datasetName: string;
  modelName: string;
  onClose: () => void;
}) {
  const curve = useResultsCurve(run.model_id ?? null);
  return (
    <InspectorPane
      label="Training run"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{run.name}</h2>
          <IconButton icon="x" label="Close run" size="sm" onClick={onClose} />
        </div>
      }
    >
      <InspectorSection title="Run">
        <dl className="divide-y divide-line">
          <Row term="Dataset">{datasetName}</Row>
          <Row term="Base model">{modelName}</Row>
          <Row term="Epochs">{String(run.params.epochs ?? "–")}</Row>
          <Row term="Image size">{String(run.params.imgsz ?? "–")}</Row>
          <Row term="Best mAP50">{formatMetric(run.metrics?.map50)}</Row>
        </dl>
      </InspectorSection>
      {run.job_id && (
        <InspectorSection title="Progress">
          <TrainProgress projectId={LIBRARY_JOBS} jobId={run.job_id} />
        </InspectorSection>
      )}
      {run.model_id && (
        <InspectorSection title="Curve">
          {curve.state === "ready" ? (
            <TrainingCurve points={curve.points} />
          ) : curve.state === "error" ? (
            <p className="text-xs text-muted">{curve.error}</p>
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </InspectorSection>
      )}
    </InspectorPane>
  );
}

/** F §12.4: training runs in the library, their live progress and curves, and new runs. */
export function TrainingScreen() {
  const { runId = null } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const runs = useTrainingRuns();
  const datasets = useLibraryDatasets();
  const library = useLibraryModels();
  const creating = params.get("new") === "1";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compareKey = readCompare(params).join(",");
  const compared = useMemo(
    () =>
      (compareKey ? compareKey.split(",") : [])
        .map((id) => runs.runs.find((r) => r.id === id))
        .filter((r): r is TrainingRun => Boolean(r)),
    [compareKey, runs.runs],
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const chosenRuns = runs.runs.filter((r) => chosen.includes(r.id));
  const chooseProblem = compareProblem(chosenRuns);

  // A finished run changes its dataset's export too, and a finished export frees a busy dataset (H8).
  const reloadRuns = runs.reload;
  const reloadDatasets = datasets.reload;
  const onTrainFinished = useCallback(() => {
    reloadRuns();
    reloadDatasets();
  }, [reloadRuns, reloadDatasets]);
  useOnJobsFinished("train", onTrainFinished);
  useOnJobsFinished("dataset", reloadDatasets);

  const actions = useMemo<RouteAction[]>(
    () => [
      {
        id: "new-run",
        label: "New training run",
        icon: "plus",
        variant: "primary",
        to: "/models/training?new=1",
      },
    ],
    [],
  );
  useProvideRouteActions(actions);

  // A queued or running run exports its dataset first unless that export is ready, so a second run
  // on the same dataset would fail at once: the form holds Start back until it has finished (H8).
  const activeRunDatasetIds = useMemo(
    () =>
      new Set(
        runs.runs.filter((r) => r.state === "queued" || r.state === "running").map((r) => r.dataset_id),
      ),
    [runs.runs],
  );
  const trainable = useMemo(
    () =>
      datasets.datasets.filter((d) => d.state === "ready").map((d) => toTrainable(d, activeRunDatasetIds)),
    [datasets.datasets, activeRunDatasetIds],
  );
  // TrainForm offers only the chosen dataset's task (R-BT13).
  const baseModels = library.models;
  const datasetName = useCallback(
    (id: string) => datasets.datasets.find((d) => d.id === id)?.name ?? "Deleted dataset",
    [datasets.datasets],
  );
  const modelName = useCallback(
    (id: string) => library.models.find((m) => m.id === id)?.name ?? "Unknown model",
    [library.models],
  );

  const columns = useMemo<Column<TrainingRun>[]>(
    () => [
      {
        key: "name",
        header: "Run",
        width: "minmax(12rem,2fr)",
        render: (r) => <span className="truncate font-medium">{r.name}</span>,
      },
      {
        key: "state",
        header: "State",
        width: "7rem",
        render: (r) => (
          <Pill tone={JOB_STATE_TONE[r.state]} live={r.state === "running"} size="sm">
            {stateLabel(r.state)}
          </Pill>
        ),
      },
      {
        key: "dataset",
        header: "Dataset",
        width: "minmax(8rem,1fr)",
        render: (r) => <span className="truncate text-muted">{datasetName(r.dataset_id)}</span>,
      },
      {
        key: "base",
        header: "Base model",
        width: "minmax(8rem,1fr)",
        render: (r) => <span className="truncate text-muted">{modelName(r.base_model_id)}</span>,
      },
      {
        key: "map",
        header: "Best mAP50",
        width: "7rem",
        render: (r) => <span className="font-mono tabular-nums">{formatMetric(r.metrics?.map50)}</span>,
      },
      {
        key: "duration",
        header: "Duration",
        width: "8rem",
        render: (r) => {
          const s = runSeconds(r);
          return (
            <span className="font-mono text-xs tabular-nums text-muted">
              {s === null ? "–" : formatDuration(s)}
            </span>
          );
        },
      },
      {
        key: "created",
        header: "Started",
        width: "9rem",
        render: (r) => (
          <span className="font-mono text-xs tabular-nums text-muted">{formatLocalDate(r.created_at)}</span>
        ),
      },
    ],
    [datasetName, modelName],
  );

  const fetchRun = useCallback((id: string) => fetchTrainingRun(api, id), [api]);
  const selected = useItemById(runId, runs.runs, runs.loading, fetchRun, "training run");

  async function start(req: TrainRequest) {
    setBusy(true);
    setError(null);
    try {
      const { training_run: run, job } = await startTrainingRun(api, req);
      useJobsStore.getState().upsert(job);
      runs.put(run);
      navigate(`/models/training/${run.id}`);
    } catch (e) {
      pushLog(`start training failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start training"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Training</h2>
        <p className="text-sm text-muted">
          Train a model on a dataset. Each run registers its model in the Library when it finishes.
        </p>
      </header>

      {runs.unavailable && (
        <Alert tone="danger" title="The model library could not be opened">
          Training needs the library. Check the library folder, then restart the app.
        </Alert>
      )}
      {runs.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={runs.reload}>
              Retry
            </Button>
          }
        >
          {runs.error}
        </Alert>
      )}

      {!runs.unavailable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={chooseProblem !== null}
            title={chooseProblem ?? undefined}
            onClick={() => setParams({ compare: chosen.join(",") })}
          >
            Compare
          </Button>
          <span className="text-xs text-muted">{chooseProblem ?? `${chosen.length} runs chosen`}</span>
        </div>
      )}
      {compared.length > 0 && (
        <GlassPanel variant="pane" className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 text-lg font-semibold">Compare</h3>
            <IconButton
              icon="x"
              label="Close compare"
              size="sm"
              onClick={() => setParams({}, { replace: true })}
            />
          </div>
          <CompareCurves runs={compared} />
        </GlassPanel>
      )}

      {!runs.unavailable && (
        <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
          <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
            <DataTable
              label="Training runs"
              columns={columns}
              rows={runs.runs}
              rowKey={(r) => r.id}
              activeKey={runId}
              onOpen={(r) => navigate(`/models/training/${r.id}`)}
              loading={runs.loading}
              onEndReached={runs.hasMore ? runs.loadMore : undefined}
              selected={new Set(chosen)}
              onSelectionChange={(next) => setChosen(Array.from(next))}
              empty={
                <EmptyState icon="train" title="No training runs yet">
                  Choose New training run to train a model on a dataset.
                </EmptyState>
              }
            />
          </GlassPanel>
          {runId &&
            (selected.item ? (
              <RunDetail
                key={selected.item.id}
                run={selected.item}
                datasetName={datasetName(selected.item.dataset_id)}
                modelName={modelName(selected.item.base_model_id)}
                onClose={() => navigate("/models/training")}
              />
            ) : selected.missing ? (
              <GlassPanel variant="pane" className="p-4">
                <EmptyState icon="train" title="That training run no longer exists">
                  The link is out of date. Choose a run from the list.
                </EmptyState>
              </GlassPanel>
            ) : selected.error ? (
              <Alert tone="danger">{selected.error}</Alert>
            ) : (
              <GlassPanel variant="pane" className="p-4">
                <SkeletonRows rows={4} columns={2} />
              </GlassPanel>
            ))}
        </div>
      )}

      <Dialog
        open={creating}
        title="New training run"
        width="lg"
        onClose={() => setParams({}, { replace: true })}
      >
        <TrainForm
          datasets={trainable}
          models={baseModels}
          datasetsUnavailable={datasets.unavailable}
          modelsUnavailable={library.unavailable}
          modelsLoading={library.loading}
          modelsError={library.error}
          busy={busy}
          onStart={(req) => void start(req)}
          initialDatasetId={params.get("dataset") ?? undefined}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </Dialog>
    </section>
  );
}
