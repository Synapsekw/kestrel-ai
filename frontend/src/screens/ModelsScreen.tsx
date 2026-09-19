import { useCallback, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { Model } from "@contract/client";
import { useProject } from "@/api/project";
import { ImportModelForm } from "@/models/ImportModelForm";
import { ModelDetail } from "@/models/ModelDetail";
import { ModelTable } from "@/models/ModelTable";
import { StarterModels } from "@/models/StarterModels";
import { useDatasetNames } from "@/models/useDatasetNames";
import { useModels } from "@/models/useModels";

export function ModelsScreen() {
  const { projectId = "" } = useParams();
  const { project, error: projectError, setProject } = useProject(projectId);
  const registry = useModels(projectId);
  const datasetNames = useDatasetNames(projectId);
  const [importing, setImporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("model");
  const selected = registry.models.find((m) => m.id === selectedId) ?? null;

  const select = useCallback(
    (id: string | null) => setParams(id ? { model: id } : {}, { replace: true }),
    [setParams],
  );

  const replace = registry.replace;
  const onImported = useCallback(
    (model: Model) => {
      replace(model);
      setImporting(false);
      select(model.id);
    },
    [replace, select],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Models</h1>
        <span className="text-xs text-slate-400">
          {registry.loading ? "Loading…" : `${registry.models.length} in the registry`}
        </span>
        <button
          type="button"
          onClick={() => setImporting((v) => !v)}
          disabled={registry.unavailable}
          className="ml-auto rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50"
        >
          Import weights
        </button>
      </div>
      {projectError && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {projectError}
        </p>
      )}
      {registry.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {registry.error}
        </p>
      )}
      {registry.unavailable && (
        <p
          role="note"
          className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
        >
          The model registry is not available yet (it arrives with the training backend).
        </p>
      )}
      {importing && (
        <ImportModelForm projectId={projectId} onImported={onImported} onClose={() => setImporting(false)} />
      )}
      {!registry.unavailable && (
        <StarterModels
          projectId={projectId}
          existingNames={registry.models.map((m) => m.name)}
          onImported={onImported}
        />
      )}
      {!registry.unavailable && (
        <ModelTable
          models={registry.models}
          datasetNames={datasetNames}
          selectedId={selectedId}
          onSelect={select}
        />
      )}
      {!registry.loading && !registry.unavailable && registry.models.length === 0 && (
        <p className="text-sm text-slate-400">
          No models yet. Add a starter model above, or import your own weights.
        </p>
      )}
      {selected && project && (
        <ModelDetail
          key={selected.id}
          projectId={projectId}
          model={selected}
          project={project}
          datasetNames={datasetNames}
          onProjectSaved={setProject}
          onChanged={registry.replace}
          onDeleted={(id) => {
            registry.remove(id);
            select(null);
          }}
        />
      )}
    </section>
  );
}
