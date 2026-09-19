import type { Model } from "@contract/client";
import { formatLocalDate, formatMetric, kindLabel } from "./modelLabels";

interface Props {
  models: Model[];
  datasetNames: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const HEADERS = ["Kind", "Name", "Base", "Dataset", "mAP50", "mAP50-95", "Precision", "Recall", "Created"];

export function ModelTable({ models, datasetNames, selectedId, onSelect }: Props) {
  return (
    <table data-testid="model-table" className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="text-xs uppercase tracking-wide text-slate-400">
          {HEADERS.map((h) => (
            <th key={h} className="border-b border-slate-800 px-2 py-1 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {models.map((m) => {
          const selected = m.id === selectedId;
          return (
            <tr
              key={m.id}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(m.id)}
              className={`cursor-pointer border-b border-slate-800/60 ${selected ? "bg-slate-800" : "hover:bg-slate-800/50"}`}
            >
              <td className="px-2 py-1 text-xs text-slate-400">{kindLabel(m.kind)}</td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  aria-label={`Select model ${m.name}`}
                  onClick={() => onSelect(m.id)}
                  className="font-medium hover:underline"
                >
                  {m.name}
                </button>
              </td>
              <td className="px-2 py-1 font-mono text-xs">{m.base_weights ?? "–"}</td>
              <td className="px-2 py-1">
                {m.dataset_id ? (datasetNames[m.dataset_id] ?? m.dataset_id.slice(0, 8)) : "–"}
              </td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.map50)}</td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.map50_95)}</td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.precision)}</td>
              <td className="px-2 py-1 tabular-nums">{formatMetric(m.metrics?.recall)}</td>
              <td className="px-2 py-1 text-xs text-slate-400">{formatLocalDate(m.created_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
