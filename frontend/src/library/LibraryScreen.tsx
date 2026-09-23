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
import { Alert, Disclosure, Skeleton, SkeletonRows } from "@/ui";

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

  const empty = !registry.loading && registry.models.length === 0;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Models</h1>
        {registry.loading ? (
          <Skeleton className="h-4 w-28 self-center" />
        ) : (
          !registry.unavailable && (
            <span className="text-xs tabular-nums text-muted">{registry.models.length} in the registry</span>
          )
        )}
      </div>
      {projectError && <Alert tone="danger">{projectError}</Alert>}
      {registry.error && <Alert tone="danger">{registry.error}</Alert>}
      {registry.unavailable && (
        <div role="note">
          <Alert tone="info">
            The model registry is not available yet (it arrives with the training backend).
          </Alert>
        </div>
      )}
      {!registry.unavailable && (
        <StarterModels
          key={projectId}
          projectId={projectId}
          existingNames={registry.models.map((m) => m.name)}
          onImported={onImported}
        />
      )}
      {!registry.unavailable && (
        <Disclosure label="Import weights from a file" open={importing} onOpenChange={setImporting}>
          <ImportModelForm
            projectId={projectId}
            onImported={onImported}
            onClose={() => setImporting(false)}
          />
        </Disclosure>
      )}
      {!registry.unavailable &&
        (registry.loading && registry.models.length === 0 ? (
          <SkeletonRows rows={3} columns={5} />
        ) : empty ? (
          <p className="text-sm text-muted">
            No models yet. Add a starter model above, or import your own weights.
          </p>
        ) : (
          <ModelTable
            models={registry.models}
            datasetNames={datasetNames}
            selectedId={selectedId}
            onSelect={select}
          />
        ))}
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
