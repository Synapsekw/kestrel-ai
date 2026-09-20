import { useCallback, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { DatasetDetail } from "@/datasets/DatasetDetail";
import { DatasetList } from "@/datasets/DatasetList";
import { NewDatasetForm } from "@/datasets/NewDatasetForm";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useDatasets } from "@/train/useDatasets";
import { Alert, Button, EmptyState, SkeletonRows } from "@/ui";

const linkClass = "font-medium text-accent hover:underline";

export function DatasetsScreen() {
  const { projectId = "" } = useParams();
  const datasets = useDatasets(projectId);
  const [creating, setCreating] = useState(false);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("dataset");
  const selected = datasets.datasets.find((d) => d.id === selectedId) ?? null;
  const count = datasets.datasets.length;
  const hasList = !datasets.unavailable && count > 0;

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
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">Datasets</h1>
          <p className="text-sm text-muted">
            A dataset is a frozen copy of the labeled images that training reads.
          </p>
          {!datasets.loading && !datasets.unavailable && (
            <p className="text-sm tabular-nums text-muted">
              {count} {count === 1 ? "dataset" : "datasets"}
            </p>
          )}
        </div>
        <Button
          variant="primary"
          icon="plus"
          onClick={() => setCreating((v) => !v)}
          disabled={datasets.unavailable}
        >
          New dataset from all labeled images
        </Button>
      </div>

      {datasets.error && <Alert tone="danger">{datasets.error}</Alert>}
      {datasets.unavailable && (
        <div role="note">
          <Alert tone="info" role="status">
            Datasets are not available. Restart the app; if it persists, use Copy diagnostics in the error
            dialog.
          </Alert>
        </div>
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

      {datasets.loading && count === 0 ? (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <SkeletonRows rows={3} columns={2} />
        </div>
      ) : hasList ? (
        <div className="grid items-start gap-6 lg:grid-cols-[20rem_1fr]">
          <DatasetList datasets={datasets.datasets} selectedId={selectedId} onSelect={select} />
          {selected ? (
            <DatasetDetail key={selected.id} projectId={projectId} dataset={selected} onDeleted={onDeleted} />
          ) : selectedId ? (
            <EmptyState
              icon="datasets"
              title="That dataset no longer exists"
              className="rounded-lg border border-line"
            >
              <span role="note">It was deleted, or the link is out of date. Choose one from the list.</span>
            </EmptyState>
          ) : (
            <EmptyState icon="datasets" title="Choose a dataset" className="rounded-lg border border-line">
              Its classes, split and folder show here, with a button to train on it.
            </EmptyState>
          )}
        </div>
      ) : (
        !datasets.loading &&
        !datasets.unavailable &&
        !datasets.error && (
          <EmptyState icon="datasets" title="No datasets yet">
            <Link to={`/p/${projectId}/data`} className={linkClass}>
              Label some images
            </Link>{" "}
            first, then create a dataset here or from a selection on{" "}
            <Link to={`/p/${projectId}/data`} className={linkClass}>
              the Images screen
            </Link>
            .
          </EmptyState>
        )
      )}
    </section>
  );
}
