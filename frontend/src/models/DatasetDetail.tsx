import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { thumbnailUrl } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { LIBRARY_JOBS } from "@/api/library";
import {
  deleteLibraryDataset,
  exportLibraryDataset,
  fetchDatasetSamples,
  type LibraryDataset,
  type LibraryDatasetItem,
} from "@/api/libraryDatasets";
import { pushLog } from "@/app/diagnostics";
import { splitAdvice } from "@/datasets/splitAdvice";
import { jobTitle } from "@/jobs/jobLabels";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { formatLocalDate } from "@/library/modelLabels";
import { useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  IconButton,
  InspectorPane,
  InspectorSection,
  Pill,
  Progress,
  SkeletonRows,
  buttonClass,
} from "@/ui";
import { DATASET_TASK_LABEL, SPLIT_LABEL, datasetStateLabel, toSplitAdviceInput } from "./datasetLabels";
import { trainingHref } from "./links";

export interface DatasetDetailProps {
  dataset: LibraryDataset;
  onChanged: (dataset: LibraryDataset) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
}

function Row({ term, children, mono }: { term: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className={mono ? "min-w-0 truncate font-mono text-xs" : "font-medium tabular-nums"}>{children}</dd>
    </div>
  );
}

/** 24 referenced images through the per-project thumbnail route; nothing is copied (F §12.2). */
function DatasetSamples({ datasetId }: { datasetId: string }) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const [state, setState] = useState<{
    id: string;
    items: LibraryDatasetItem[];
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchDatasetSamples(api, datasetId)
      .then((items) => {
        if (!cancelled) setState({ id: datasetId, items, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({ id: datasetId, items: [], error: messageOf(e, "could not load the samples") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, datasetId]);
  if (!state || state.id !== datasetId) return <SkeletonRows rows={2} columns={4} />;
  if (state.error) return <p className="text-xs text-muted">{state.error}</p>;
  return (
    <ul data-testid="dataset-samples" className="grid grid-cols-4 gap-1.5">
      {state.items.map((i) => (
        <li key={`${i.project_id}/${i.image_id}`}>
          <img
            src={thumbnailUrl(baseUrl, token, i.project_id, i.image_id)}
            alt={`${i.split} image, ${i.label_count} labels`}
            loading="lazy"
            className="aspect-[4/3] w-full rounded-sm bg-surface-2 object-cover"
          />
        </li>
      ))}
    </ul>
  );
}

export function DatasetDetail({ dataset, onChanged, onDeleted, onClose }: DatasetDetailProps) {
  const api = useApi();
  const building = dataset.state === "resolving" || dataset.export_state === "building";
  // `job_id` is the dataset's latest job: the build, then the export.
  const { job } = useTrackedJob(LIBRARY_JOBS, building || dataset.state === "failed" ? dataset.job_id : null);
  const state = datasetStateLabel(dataset);
  const advice = dataset.state === "ready" ? splitAdvice(toSplitAdviceInput(dataset)) : null;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteLibraryDataset(api, dataset.id);
      onDeleted(dataset.id);
    } catch (e) {
      pushLog(`delete dataset ${dataset.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not delete the dataset"));
      setBusy(false);
    }
  }

  async function buildExport() {
    setExporting(true);
    setError(null);
    try {
      const started = await exportLibraryDataset(api, dataset.id);
      useJobsStore.getState().upsert(started);
      onChanged({ ...dataset, export_state: "building", job_id: started.id });
    } catch (e) {
      pushLog(`export dataset ${dataset.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <InspectorPane
      label="Dataset"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{dataset.name}</h2>
          <Pill tone={state.tone} live={state.live} size="sm">
            {state.text}
          </Pill>
          <IconButton icon="x" label="Close dataset" size="sm" onClick={onClose} />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {dataset.state === "ready" && !confirming && (
            <Link to={trainingHref({ datasetId: dataset.id })} className={buttonClass("primary", "sm")}>
              Train on this dataset
            </Link>
          )}
          {confirming ? (
            <>
              <span className="basis-full text-xs text-danger">
                Delete dataset {dataset.name}? Its export folder goes too; project images are never touched.
              </span>
              <Button size="sm" variant="danger" loading={busy} onClick={() => void remove()}>
                Delete permanently
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                Keep it
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
              Delete dataset
            </Button>
          )}
        </div>
      }
    >
      {building && job && (
        <InspectorSection title="Progress">
          <Progress
            value={job.progress}
            running={job.state === "running"}
            label={`${jobTitle(job)} progress`}
          />
          {job.message && <p className="mt-1 text-xs text-muted">{job.message}</p>}
        </InspectorSection>
      )}
      {dataset.state === "failed" && (
        <Alert tone="danger" title="The dataset could not be built">
          {job?.error ?? "Open Jobs for the log."}
        </Alert>
      )}

      <InspectorSection title="Split">
        <dl className="divide-y divide-line">
          <Row term="Task">{DATASET_TASK_LABEL[dataset.task]}</Row>
          <Row term="Split">
            {SPLIT_LABEL[dataset.split_method] ?? dataset.split_method} ·{" "}
            {Math.round(Number(dataset.split_params.val_fraction ?? 0) * 100)}% validation
          </Row>
          <Row term="Images">{dataset.counts.images}</Row>
          <Row term="Train / val">
            {dataset.counts.train} / {dataset.counts.val}
          </Row>
          <Row term="Created">{formatLocalDate(dataset.created_at)}</Row>
        </dl>
        {advice && <Alert tone="warn">{advice}</Alert>}
      </InspectorSection>

      <InspectorSection title="Classes">
        <table data-testid="dataset-classes" className="w-full text-sm">
          <tbody>
            {dataset.classes.map((c, i) => (
              <tr key={c.type_id} className="border-b border-line last:border-b-0">
                <td className="w-6 py-1.5 font-mono text-xs tabular-nums text-dim">{i}</td>
                <td className="py-1.5">{c.name}</td>
                <td className="py-1.5 text-right font-mono tabular-nums">
                  {dataset.counts.per_class[c.type_id] ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </InspectorSection>

      <InspectorSection title="Sources">
        <ul data-testid="dataset-sources" className="flex flex-col divide-y divide-line">
          {dataset.sources.map((s) => (
            <li key={s.project_id} className="flex flex-col gap-0.5 py-1.5">
              <span className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium">{s.project_name}</span>
                <span className="font-mono tabular-nums">{s.image_count}</span>
              </span>
              <span className="truncate font-mono text-xs text-muted">{s.project_folder}</span>
            </li>
          ))}
        </ul>
      </InspectorSection>

      {dataset.state === "ready" && (
        <InspectorSection title="Samples">
          <DatasetSamples datasetId={dataset.id} />
        </InspectorSection>
      )}

      <InspectorSection title="Export">
        {dataset.origin === "legacy" ? (
          <>
            <p className="text-xs text-muted">
              A dataset from before the Models section. It trains from its own folder.
            </p>
            <p className="mt-1 break-all font-mono text-xs">{dataset.legacy_path}</p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {dataset.export_state === "ready" && dataset.export_path && (
              <p className="break-all font-mono text-xs">{dataset.export_path}</p>
            )}
            <p className="text-xs text-muted">
              {dataset.task === "segment"
                ? "Polygon datasets export with the Images workspace."
                : "Training builds the export when it needs one. Build it here to use the files elsewhere."}
            </p>
            <Button
              size="sm"
              className="self-start"
              loading={exporting}
              disabled={
                dataset.state !== "ready" || dataset.export_state === "building" || dataset.task === "segment"
              }
              onClick={() => void buildExport()}
            >
              {dataset.export_state === "none" ? "Build export" : "Rebuild export"}
            </Button>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </InspectorSection>
    </InspectorPane>
  );
}
