import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Dataset, DatasetStats } from "@contract/client";
import { useApi } from "@/api/client";
import { deleteDataset, fetchDatasetStats } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { formatLocalDate } from "@/models/modelLabels";
import { Alert, Button, Skeleton, buttonClass } from "@/ui";
import { splitAdvice } from "./splitAdvice";

export interface DatasetDetailProps {
  projectId: string;
  dataset: Dataset;
  onDeleted: (id: string) => void;
}

interface StatsState {
  datasetId: string;
  stats: DatasetStats | null;
  error: string | null;
}

function useDatasetStats(projectId: string, datasetId: string): StatsState {
  const api = useApi();
  const [state, setState] = useState<StatsState>({ datasetId: "", stats: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetchDatasetStats(api, projectId, datasetId)
      .then((stats) => {
        if (!cancelled) setState({ datasetId, stats, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load dataset stats ${datasetId} failed: ${messageOf(e, String(e))}`);
        setState({ datasetId, stats: null, error: messageOf(e, "could not load dataset statistics") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, datasetId]);

  return state.datasetId === datasetId ? state : { datasetId, stats: null, error: null };
}

const SPLIT_LABEL: Record<Dataset["split_method"], string> = {
  by_group: "By group",
  by_tile: "By tile",
  random: "Random",
};

const th = "h-8 px-2 text-xs font-medium text-muted";
const td = "h-9 px-2";

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className={mono ? "min-w-0 truncate font-mono text-ink" : "font-medium tabular-nums text-ink"}>
        {children}
      </dd>
    </div>
  );
}

export function DatasetDetail({ projectId, dataset, onDeleted }: DatasetDetailProps) {
  const api = useApi();
  const { stats, error: statsError } = useDatasetStats(projectId, dataset.id);
  const advice = splitAdvice(dataset);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteDataset(api, projectId, dataset.id);
      onDeleted(dataset.id);
    } catch (e) {
      pushLog(`delete dataset ${dataset.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not delete the dataset"));
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="dataset-detail"
      className="flex flex-col gap-5 rounded-lg border border-line bg-panel p-5 animate-reveal motion-reduce:animate-none"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{dataset.name}</h2>
        <Link to={`/p/${projectId}/train?dataset=${dataset.id}`} className={buttonClass("secondary", "sm")}>
          Train on this dataset
        </Link>
      </header>

      {advice && <Alert tone="warn">{advice}</Alert>}

      <dl className="flex flex-col">
        <Row label="Images">{dataset.image_count}</Row>
        <Row label="Train / validation">
          {dataset.train_count} / {dataset.val_count}
        </Row>
        <Row label="Split">{SPLIT_LABEL[dataset.split_method]}</Row>
        <Row label="Validation fraction">{dataset.split_params.val_fraction}</Row>
        <Row label="Seed">{dataset.split_params.seed}</Row>
        <Row label="Created">{formatLocalDate(dataset.created_at)}</Row>
        <Row label="Folder" mono>
          {dataset.path}
        </Row>
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Boxes per class</h3>
        {statsError && <Alert tone="danger">{statsError}</Alert>}
        {!stats && !statsError && (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {stats && (
          <table data-testid="dataset-class-stats" className="w-full text-left text-[13px]">
            <thead>
              <tr>
                <th className={th}>Class</th>
                <th className={`${th} text-right`}>Train</th>
                <th className={`${th} text-right`}>Validation</th>
              </tr>
            </thead>
            <tbody>
              {stats.boxes_per_class.map((c) => (
                <tr key={c.class_id} className="border-t border-line">
                  <td className={td}>{c.class_name}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.train}</td>
                  <td className={`${td} text-right tabular-nums`}>{c.val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {stats && stats.groups.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Flights and tiles</h3>
          <table data-testid="dataset-group-stats" className="w-full text-left text-[13px]">
            <thead>
              <tr>
                <th className={th}>Flight or tile</th>
                <th className={th}>Split</th>
                <th className={`${th} text-right`}>Images</th>
              </tr>
            </thead>
            <tbody>
              {stats.groups.map((g) => (
                <tr key={`${g.group_key}-${g.split}`} className="border-t border-line">
                  <td className={`${td} font-mono`}>{g.group_key}</td>
                  <td className={td}>{g.split}</td>
                  <td className={`${td} text-right tabular-nums`}>{g.image_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {confirming ? (
          <Alert
            tone="warn"
            actions={
              <>
                <Button variant="danger" size="sm" onClick={() => void remove()} loading={busy}>
                  Delete permanently
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </Button>
              </>
            }
          >
            Delete dataset {dataset.name}? The frozen copy under {dataset.path} is removed. Images, labels and
            trained models are kept.
          </Alert>
        ) : (
          <Button
            variant="danger"
            size="sm"
            icon="trash"
            className="self-start"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            Delete dataset
          </Button>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </section>
  );
}
