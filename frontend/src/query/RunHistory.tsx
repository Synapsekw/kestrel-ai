import type { QueryRun } from "@contract/client";
import { formatDate } from "@/models/modelLabels";
import { runTitle } from "./queryModel";

interface Props {
  runs: QueryRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RunHistory({ runs, selectedId, onSelect }: Props) {
  if (runs.length === 0) return <p className="text-sm text-slate-400">No query runs yet.</p>;
  return (
    <ul data-testid="run-history" className="flex flex-col gap-1">
      {runs.map((run) => {
        const title = runTitle(run);
        return (
          <li key={run.id}>
            <button
              type="button"
              aria-label={`Open run ${title}`}
              aria-current={run.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(run.id)}
              className={`flex w-full flex-wrap items-center gap-3 rounded px-2 py-1 text-left text-sm hover:bg-slate-800 ${run.id === selectedId ? "bg-slate-800" : ""}`}
            >
              <span className="font-medium">{title}</span>
              <span className="text-xs text-slate-400">
                {formatDate(run.created_at)} · {run.image_ids.length} images · {run.box_count} boxes
                {run.promoted_at ? " · promoted" : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
