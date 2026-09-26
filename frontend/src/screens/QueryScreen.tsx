import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { CostEstimate } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { useGroups, useProject } from "@/api/project";
import { useProviders } from "@/api/providers";
import { createQueryRun, estimateQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { useLibraryModels } from "@/library/useLibraryModels";
import { EstimateCard } from "@/query/EstimateCard";
import { ImagePicker } from "@/query/ImagePicker";
import {
  DEFAULT_QUERY_FORM,
  formKey,
  toQueryRunCreate,
  validateQueryForm,
  type QueryForm,
} from "@/query/queryModel";
import { RunCard } from "@/query/RunCard";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { RunHistory } from "@/query/RunHistory";
import { SourcePicker } from "@/query/SourcePicker";
import { TilingFields } from "@/query/TilingFields";
import { useImageSelection } from "@/query/useImageSelection";
import { useQueryRuns } from "@/query/useQueryRuns";
import { useJobsStore } from "@/store/jobs";
import { useNavigationStore } from "@/store/navigation";
import { Alert, Button, SkeletonRows, cx, focusRing } from "@/ui";

const EMPTY: string[] = [];
const link = cx("rounded-sm font-medium text-accent hover:underline", focusRing);

type RunHistoryState = ReturnType<typeof useQueryRuns>;

/** The project's detection runs, newest first; choosing one opens it above. */
function RunHistorySection({
  history,
  runId,
  onSelect,
}: {
  history: RunHistoryState;
  runId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">Run history</h2>
      {history.error && <Alert tone="danger">{history.error}</Alert>}
      {history.unavailable ? (
        <p role="note" className="text-sm text-muted">
          Detection runs are not available yet (they arrive with the inference backend).
        </p>
      ) : history.loading && history.runs.length === 0 ? (
        <SkeletonRows rows={3} columns={4} />
      ) : (
        <RunHistory runs={history.runs} selectedId={runId} onSelect={onSelect} />
      )}
    </section>
  );
}

/** Past runs only: each opens read-only, and nothing here starts, accepts or changes a run. */
function PastRuns() {
  const { projectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const history = useQueryRuns(projectId);
  const select = (id: string) =>
    setParams((p) => {
      p.set("run", id);
      return p;
    });
  return (
    <section className="flex max-w-5xl flex-col gap-6">
      {runId && <RunCard projectId={projectId} runId={runId} readOnly />}
      <RunHistorySection history={history} runId={runId} onSelect={select} />
    </section>
  );
}

/**
 * The Detect screen. `readOnly` shows the project's past runs only (a training project's
 * detections from before the split), without the form or any control that changes a run.
 */
export function QueryScreen({ readOnly = false }: { readOnly?: boolean }) {
  return readOnly ? <PastRuns /> : <DetectWorkspace />;
}

function DetectWorkspace() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const { project } = useProject(projectId);
  const registry = useLibraryModels();
  const providers = useProviders();
  const groups = useGroups(projectId);
  const history = useQueryRuns(projectId);
  // The history row carries the run's box count: refresh it when a detection job ends.
  useOnJobsFinished("infer", history.reload);
  // The Data Manager selection is consumed once, on entry: it is snapshotted here and dropped from
  // the store below, so a later visit cannot silently inherit a stale selection.
  const [preloaded] = useState<string[]>(() => {
    const nav = useNavigationStore.getState();
    return nav.source === "query" ? nav.ids : EMPTY;
  });
  const [form, setForm] = useState<QueryForm>(() => ({
    ...DEFAULT_QUERY_FORM,
    mode: preloaded.length > 0 ? "selection" : DEFAULT_QUERY_FORM.mode,
  }));
  const selection = useImageSelection(projectId, form, preloaded);

  useEffect(() => {
    if (useNavigationStore.getState().source === "query") {
      useNavigationStore.getState().setContext([], null);
    }
  }, []);
  const [estimate, setEstimate] = useState<{ key: string; value: CostEstimate } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // The project's pre-annotation model is the natural default once the registry has loaded.
  const preferredModelId = project?.preannotation_model_id ?? null;
  const modelId =
    form.modelId ||
    (preferredModelId && registry.models.some((m) => m.id === preferredModelId)
      ? preferredModelId
      : (registry.models[0]?.id ?? ""));
  const effectiveForm = useMemo(
    () => (modelId === form.modelId ? form : { ...form, modelId }),
    [form, modelId],
  );
  const currentKey = selection.loading ? null : formKey(effectiveForm, selection.ids);
  const currentEstimate = estimate && estimate.key === currentKey ? estimate.value : null;

  const patch = (p: Partial<QueryForm>) => {
    setForm((f) => ({ ...f, ...p }));
    setError(null);
  };

  function validate(): string | null {
    const problem = validateQueryForm(effectiveForm, selection.ids.length, providers.providers);
    setError(problem);
    return problem;
  }

  async function guard(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setUnavailable(false);
    try {
      await fn();
    } catch (e) {
      pushLog(`${label} failed: ${messageOf(e, String(e))}`);
      if (isNotImplemented(e)) setUnavailable(true);
      else setError(messageOf(e, `${label} failed`));
    } finally {
      setBusy(false);
    }
  }

  const local = form.kind === "local_model";

  const doEstimate = () => {
    if (validate() || !currentKey) return;
    void guard("estimate", async () => {
      const value = await estimateQueryRun(api, projectId, toQueryRunCreate(effectiveForm, selection.ids));
      setEstimate({ key: currentKey, value });
    });
  };

  const doStart = () => {
    // A cloud run starts from the estimate the operator saw; a local run costs nothing.
    if (validate() || !(local || currentEstimate)) return;
    void guard("start query run", async () => {
      const created = await createQueryRun(api, projectId, toQueryRunCreate(effectiveForm, selection.ids));
      useJobsStore.getState().upsert(created.job);
      setEstimate(null);
      setParams({ run: created.query_run.id });
      history.reload();
    });
  };

  return (
    <section className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Detect</h1>
          <p data-testid="query-intro" className="text-sm text-muted">
            Run a model over images; it suggests boxes for you to{" "}
            <Link to={`/p/${projectId}/review`} className={link}>
              review
            </Link>
            .
          </p>
        </div>
        {runId && (
          <Button variant="primary" icon="plus" className="ml-auto" onClick={() => setParams({})}>
            New detection
          </Button>
        )}
      </div>
      {runId ? (
        <RunCard projectId={projectId} runId={runId} />
      ) : (
        <div className="flex max-w-3xl flex-col gap-6 rounded-lg border border-line bg-surface p-5">
          <SourcePicker
            form={effectiveForm}
            onChange={patch}
            models={registry.models}
            modelsUnavailable={registry.unavailable}
            modelsLoading={registry.loading}
            modelsError={registry.error}
            providers={providers.providers}
            providersUnavailable={providers.unavailable}
          />
          <ImagePicker
            form={effectiveForm}
            onChange={patch}
            preloadedCount={preloaded.length}
            groups={groups}
            count={selection.ids.length}
            loading={selection.loading}
          />
          <TilingFields form={effectiveForm} onChange={patch} />
          {selection.error && <Alert tone="danger">{selection.error}</Alert>}
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            {currentEstimate && <EstimateCard estimate={currentEstimate} local={local} />}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={doEstimate} disabled={busy || selection.loading}>
                Estimate
              </Button>
              <Button
                variant="primary"
                icon="play"
                onClick={doStart}
                disabled={busy || selection.loading || !(local || currentEstimate)}
              >
                Start
              </Button>
              <span className="text-[13px] text-muted">
                {local
                  ? "Runs on this computer at no cost; Estimate shows how many tiles it takes."
                  : "Estimate the cost first; Start then runs exactly that request."}
              </span>
            </div>
          </div>
        </div>
      )}
      {unavailable && (
        <div role="note" className="max-w-3xl">
          <Alert tone="info" role="status">
            Detection runs are not available yet (they arrive with the inference backend).
          </Alert>
        </div>
      )}
      {error && (
        <Alert tone="danger" className="max-w-3xl">
          {error}
        </Alert>
      )}
      <RunHistorySection history={history} runId={runId} onSelect={(id) => setParams({ run: id })} />
    </section>
  );
}
