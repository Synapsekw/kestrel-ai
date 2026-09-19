import { useCallback, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DatasetDetail } from "@/datasets/DatasetDetail";
import { DatasetList } from "@/datasets/DatasetList";
import { NewDatasetForm } from "@/datasets/NewDatasetForm";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useDatasets } from "@/train/useDatasets";

export function DatasetsScreen() {
  const { projectId = "" } = useParams();
  const datasets = useDatasets(projectId);
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("dataset");
  const selected = datasets.datasets.find((d) => d.id === selectedId) ?? null;

  const select = useCallback(
    (id: string | null) => setParams(id ? { dataset: id } : {}, { replace: true }),
    [setParams],
  );

  useOnJobsFinished("dataset", datasets.reload);

  const { remove, reload } = datasets;
  const onDeleted = useCallback(
    (id: string) => {
      select(null);
      // Drop it from the list at once; reload() then confirms it with the server (M5b, I6).
      remove(id);
      reload();
    },
    [select, remove, reload],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Datasets</h1>
        <span className="text-xs text-slate-400">
          {datasets.loading
            ? "Loading…"
            : datasets.datasets.length === 1
              ? "1 dataset"
              : `${datasets.datasets.length} datasets`}
        </span>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          disabled={datasets.unavailable}
          className="ml-auto rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50"
        >
          New dataset from all labeled images
        </button>
      </div>

      {datasets.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {datasets.error}
        </p>
      )}
      {datasets.unavailable && (
        <p
          role="note"
          className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
        >
          Datasets are not available. Restart the app; if it persists, use Copy diagnostics in the error
          dialog.
        </p>
      )}

      {creating && (
        <NewDatasetForm
          projectId={projectId}
          onClose={() => {
            setCreating(false);
            datasets.reload();
          }}
        />
      )}

      {!datasets.unavailable && datasets.datasets.length > 0 && (
        <DatasetList datasets={datasets.datasets} selectedId={selectedId} onSelect={select} />
      )}

      {!datasets.loading && !datasets.unavailable && datasets.datasets.length === 0 && (
        <p className="text-sm text-slate-400">
          No datasets yet. A dataset is a frozen copy of the labeled images that training reads.{" "}
          <Link to={`/p/${projectId}/data`} className="text-orange-300 hover:underline">
            Label some images
          </Link>{" "}
          first, then create one here or from a selection in{" "}
          <Link to={`/p/${projectId}/data`} className="text-orange-300 hover:underline">
            the Data Manager
          </Link>
          .
        </p>
      )}

      {selectedId &&
        !selected &&
        !datasets.loading &&
        !datasets.unavailable &&
        datasets.datasets.length > 0 && (
          <p role="note" className="text-sm text-slate-400">
            That dataset no longer exists.
          </p>
        )}

      {selected && (
        <DatasetDetail key={selected.id} projectId={projectId} dataset={selected} onDeleted={onDeleted} />
      )}
    </section>
  );
}
