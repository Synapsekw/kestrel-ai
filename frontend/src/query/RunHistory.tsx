import type { QueryRun } from "@contract/client";
import { formatLocalDate } from "@/library/modelLabels";
import { Button, Pill, cx } from "@/ui";
import { runTitle } from "./queryModel";

interface Props {
  runs: QueryRun[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const th = "h-9 px-3 text-left text-xs font-medium text-muted";
const td = "h-9 px-3";

export function RunHistory({ runs, selectedId, onSelect }: Props) {
  if (runs.length === 0) return <p className="text-sm text-muted">No detection runs yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table data-testid="run-history" className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>
              Run
            </th>
            <th scope="col" className={th}>
              Started
            </th>
            <th scope="col" className={cx(th, "text-right")}>
              Images
            </th>
            <th scope="col" className={cx(th, "text-right")}>
              Boxes
            </th>
            <th scope="col" className={th}>
              <span className="sr-only">Accepted</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const title = runTitle(run);
            const selected = run.id === selectedId;
            return (
              <tr
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={cx(
                  "cursor-pointer border-b border-line last:border-b-0 hover:bg-hover",
                  selected && "bg-hover",
                )}
              >
                <td className={cx(td, "pl-1.5")}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Open run ${title}`}
                    aria-current={selected ? "true" : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(run.id);
                    }}
                    className="max-w-[28rem] justify-start truncate hover:bg-transparent"
                  >
                    <span className="truncate">{title}</span>
                  </Button>
                </td>
                <td className={cx(td, "whitespace-nowrap text-muted")}>{formatLocalDate(run.created_at)}</td>
                <td className={cx(td, "text-right tabular-nums")}>{run.image_ids.length}</td>
                <td className={cx(td, "text-right tabular-nums")}>{run.box_count}</td>
                <td className={td}>
                  {run.promoted_at && (
                    <Pill tone="ok" size="sm">
                      Accepted as labels
                    </Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
