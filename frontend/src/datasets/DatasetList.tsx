import type { Dataset } from "@contract/client";
import { formatLocalDate } from "@/models/modelLabels";

interface Props {
  datasets: Dataset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const HEADERS = ["Name", "Images", "Train / val", "Split", "Created"];

const SPLIT_LABEL: Record<Dataset["split_method"], string> = {
  by_group: "by group",
  by_tile: "by tile",
  random: "random",
};

export function DatasetList({ datasets, selectedId, onSelect }: Props) {
  return (
    <table data-testid="dataset-table" className="w-full border-collapse text-left text-sm">
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
        {datasets.map((d) => {
          const selected = d.id === selectedId;
          return (
            <tr
              key={d.id}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(d.id)}
              className={`cursor-pointer border-b border-slate-800/60 ${
                selected ? "bg-slate-800" : "hover:bg-slate-800/50"
              }`}
            >
              <td className="px-2 py-1">
                <button
                  type="button"
                  aria-label={`Select dataset ${d.name}`}
                  onClick={() => onSelect(d.id)}
                  className="font-medium hover:underline"
                >
                  {d.name}
                </button>
              </td>
              <td className="px-2 py-1 tabular-nums">{d.image_count}</td>
              <td className="px-2 py-1 tabular-nums">
                {d.train_count} / {d.val_count}
              </td>
              <td className="px-2 py-1 text-xs text-slate-400">{SPLIT_LABEL[d.split_method]}</td>
              <td className="px-2 py-1 text-xs text-slate-400">{formatLocalDate(d.created_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
