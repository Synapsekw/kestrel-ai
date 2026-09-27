import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { fetchLibraryDataset, type LibraryDataset } from "@/api/libraryDatasets";
import { useProvideRouteActions, type RouteAction } from "@/app/routeActions";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { formatLocalDate } from "@/library/modelLabels";
import { Alert, Button, DataTable, EmptyState, GlassPanel, Pill, SkeletonRows, type Column } from "@/ui";
import { DatasetDetail } from "./DatasetDetail";
import { DATASET_TASK_LABEL, datasetStateLabel, sourcesText } from "./datasetLabels";
import { useItemById } from "./useItemById";
import { useLibraryDatasets } from "./useLibraryDatasets";

const COLUMNS: Column<LibraryDataset>[] = [
  {
    key: "name",
    header: "Dataset",
    width: "minmax(10rem,2fr)",
    render: (d) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{d.name}</span>
        {d.origin === "legacy" && <Pill size="sm">Legacy</Pill>}
      </span>
    ),
  },
  {
    key: "task",
    header: "Task",
    width: "7rem",
    render: (d) => <span className="text-muted">{DATASET_TASK_LABEL[d.task]}</span>,
  },
  {
    key: "sources",
    header: "Sources",
    width: "minmax(9rem,2fr)",
    render: (d) => <span className="truncate text-muted">{sourcesText(d)}</span>,
  },
  {
    key: "images",
    header: "Images",
    width: "5rem",
    render: (d) => <span className="font-mono tabular-nums">{d.counts.images}</span>,
  },
  {
    key: "split",
    header: "Train / val",
    width: "7rem",
    render: (d) => (
      <span className="font-mono tabular-nums text-muted">
        {d.counts.train} / {d.counts.val}
      </span>
    ),
  },
  {
    key: "state",
    header: "State",
    width: "9rem",
    render: (d) => {
      const s = datasetStateLabel(d);
      return (
        <Pill tone={s.tone} live={s.live} size="sm">
          {s.text}
        </Pill>
      );
    },
  },
  {
    key: "created",
    header: "Created",
    width: "9rem",
    render: (d) => (
      <span className="font-mono text-xs tabular-nums text-muted">{formatLocalDate(d.created_at)}</span>
    ),
  },
];

/** F §12.4: datasets built across projects, with the detail at `/models/datasets/:datasetId`. */
export function DatasetsScreen() {
  const { datasetId = null } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const list = useLibraryDatasets();
  const fetchDataset = useCallback((id: string) => fetchLibraryDataset(api, id), [api]);
  const { reload } = list;
  useOnJobsFinished("dataset_build", reload);
  useOnJobsFinished("dataset", reload);

  const actions = useMemo<RouteAction[]>(
    () => [
      {
        id: "new-dataset",
        label: "New dataset",
        icon: "plus",
        variant: "primary",
        to: "/models/datasets?new=1",
      },
    ],
    [],
  );
  useProvideRouteActions(actions);

  const selected = useItemById(datasetId, list.datasets, list.loading, fetchDataset, "dataset");
  const count = list.datasets.length;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">Datasets</h2>
        {!list.loading && !list.unavailable && (
          <span className="text-xs tabular-nums text-muted">
            {count}
            {list.hasMore ? "+" : ""} {count === 1 ? "dataset" : "datasets"}
          </span>
        )}
        <p className="basis-full text-sm text-muted">
          A dataset gathers labelled images from any of your projects. Images are copied only when an export
          is built.
        </p>
      </header>

      {list.unavailable && (
        <Alert tone="danger" title="The model library could not be opened">
          Datasets and training need the library. Check the library folder, then restart the app.
        </Alert>
      )}
      {list.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={list.reload}>
              Retry
            </Button>
          }
        >
          {list.error}
        </Alert>
      )}

      {!list.unavailable && (
        <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
          <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
            <DataTable
              label="Datasets"
              columns={COLUMNS}
              rows={list.datasets}
              rowKey={(d) => d.id}
              activeKey={datasetId}
              onOpen={(d) => navigate(`/models/datasets/${d.id}`)}
              loading={list.loading}
              onEndReached={list.hasMore ? list.loadMore : undefined}
              empty={
                <EmptyState icon="datasets" title="No datasets yet">
                  Choose New dataset to gather labelled images from your projects.
                </EmptyState>
              }
            />
          </GlassPanel>
          {datasetId &&
            (selected.item ? (
              <DatasetDetail
                key={selected.item.id}
                dataset={selected.item}
                onChanged={list.put}
                onDeleted={(id) => {
                  list.remove(id);
                  navigate("/models/datasets");
                }}
                onClose={() => navigate("/models/datasets")}
              />
            ) : selected.missing ? (
              <GlassPanel variant="pane" className="p-4">
                <EmptyState icon="datasets" title="That dataset no longer exists">
                  It was deleted, or the link is out of date. Choose one from the list.
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
    </section>
  );
}
