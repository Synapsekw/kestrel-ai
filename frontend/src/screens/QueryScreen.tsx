import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { CostEstimate } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { useProject } from "@/api/project";
import { useProviders } from "@/api/providers";
import { createQueryRun, estimateQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { useModels } from "@/models/useModels";
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
import { RunHistory } from "@/query/RunHistory";
import { SourcePicker } from "@/query/SourcePicker";
import { TilingFields } from "@/query/TilingFields";
import { useImageSelection } from "@/query/useImageSelection";
import { useQueryRuns } from "@/query/useQueryRuns";
import { useJobsStore } from "@/store/jobs";
import { useNavigationStore } from "@/store/navigation";

const EMPTY: string[] = [];
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

export function QueryScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const runId = params.get("run");
  const { project } = useProject(projectId);
  const registry = useModels(projectId);
  const providers = useProviders();
  const history = useQueryRuns(projectId);
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

  const doEstimate = () => {
    if (validate() || !currentKey) return;
    void guard("estimate", async () => {
      const value = await estimateQueryRun(api, projectId, toQueryRunCreate(effectiveForm, selection.ids));
      setEstimate({ key: currentKey, value });
    });
  };

  const doStart = () => {
    if (validate() || !currentEstimate) return;
    void guard("start query run", async () => {
      const created = await createQueryRun(api, projectId, toQueryRunCreate(effectiveForm, selection.ids));
      useJobsStore.getState().upsert(created.job);
      setEstimate(null);
      setParams({ run: created.query_run.id });
      history.reload();
    });
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Query</h1>
        {runId && (
          <button type="button" className={`${secondary} ml-auto`} onClick={() => setParams({})}>
            New query
          </button>
        )}
      </div>
      {runId ? (
        <RunCard projectId={projectId} runId={runId} />
      ) : (
        <div className="flex max-w-3xl flex-col gap-5">
          <SourcePicker
            projectId={projectId}
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
            count={selection.ids.length}
            loading={selection.loading}
          />
          <TilingFields form={effectiveForm} onChange={patch} />
          {selection.error && (
            <p role="alert" className="text-xs text-red-300">
              {selection.error}
            </p>
          )}
          {currentEstimate && <EstimateCard estimate={currentEstimate} />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={secondary}
              onClick={doEstimate}
              disabled={busy || selection.loading}
            >
              Estimate
            </button>
            <button type="button" className={primary} onClick={doStart} disabled={busy || !currentEstimate}>
              Start
            </button>
            <span className="text-xs text-slate-400">Estimate first; Start runs the estimated request.</span>
          </div>
        </div>
      )}
      {unavailable && (
        <p
          role="note"
          className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
        >
          Query runs are not available yet (they arrive with the inference backend).
        </p>
      )}
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="flex max-w-3xl flex-col gap-2">
        <h2 className="text-lg font-medium">Run history</h2>
        {history.error && (
          <p role="alert" className="text-xs text-red-300">
            {history.error}
          </p>
        )}
        {history.unavailable ? (
          <p role="note" className="text-xs text-slate-400">
            Query runs are not available yet (they arrive with the inference backend).
          </p>
        ) : (
          <RunHistory runs={history.runs} selectedId={runId} onSelect={(id) => setParams({ run: id })} />
        )}
      </div>
    </section>
  );
}
