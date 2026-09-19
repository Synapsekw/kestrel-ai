import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Dataset, DatasetStats } from "@contract/client";
import { useApi } from "@/api/client";
import { deleteDataset, fetchDatasetStats } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { splitAdvice } from "./splitAdvice";

export interface DatasetDetailProps {
  projectId: string;
  dataset: Dataset;
  onDeleted: (id: string) => void;
}

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const danger = "rounded bg-red-800 px-3 py-1 text-sm hover:bg-red-700 disabled:opacity-50";
const dt = "text-xs uppercase tracking-wide text-slate-500";
const dd = "text-sm";

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
      className="flex flex-col gap-4 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-medium">{dataset.name}</h2>
        <span className="text-xs text-slate-400">
          {dataset.image_count} images, {dataset.train_count} train / {dataset.val_count} val
        </span>
      </header>

      {advice && (
        <p
          role="alert"
          className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
        >
          {advice}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Boxes per class</h3>
        {statsError && (
          <p role="alert" className="text-xs text-red-300">
            {statsError}
          </p>
        )}
        {stats && (
          <table data-testid="dataset-class-stats" className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500">
                <th className="px-2 py-1 font-medium">Class</th>
                <th className="px-2 py-1 font-medium">Train</th>
                <th className="px-2 py-1 font-medium">Val</th>
              </tr>
            </thead>
            <tbody>
              {stats.boxes_per_class.map((c) => (
                <tr key={c.class_id} className="border-t border-slate-800">
                  <td className="px-2 py-1">{c.class_name}</td>
                  <td className="px-2 py-1 tabular-nums">{c.train}</td>
                  <td className="px-2 py-1 tabular-nums">{c.val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {stats && stats.groups.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Groups</h3>
          <table data-testid="dataset-group-stats" className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-500">
                <th className="px-2 py-1 font-medium">Group</th>
                <th className="px-2 py-1 font-medium">Split</th>
                <th className="px-2 py-1 font-medium">Images</th>
              </tr>
            </thead>
            <tbody>
              {stats.groups.map((g) => (
                <tr key={`${g.group_key}-${g.split}`} className="border-t border-slate-800">
                  <td className="px-2 py-1">{g.group_key}</td>
                  <td className="px-2 py-1">{g.split}</td>
                  <td className="px-2 py-1 tabular-nums">{g.image_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dl>
        <div>
          <dt className={dt}>Folder</dt>
          <dd className={`${dd} font-mono`}>{dataset.path}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={`/p/${projectId}/train?dataset=${dataset.id}`}
            className="text-sm text-orange-300 hover:underline"
          >
            Train on this dataset
          </Link>
          {!confirming && (
            <button type="button" className={danger} onClick={() => setConfirming(true)} disabled={busy}>
              Delete dataset
            </button>
          )}
        </div>
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Delete dataset {dataset.name}? The frozen copy under {dataset.path} is removed. Images, labels
              and trained models are kept.
            </span>
            <button type="button" className={danger} onClick={() => void remove()} disabled={busy}>
              Delete permanently
            </button>
            <button type="button" className={btn} onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
