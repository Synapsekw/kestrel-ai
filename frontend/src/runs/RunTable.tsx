import type { ClassDef } from "@contract/client";
import type { RunSummary } from "@/api/runs";
import { Button, Pill, Progress } from "@/ui";
import { countCells, reviewText, STATE } from "./runTableModel";

/**
 * Every run of the project, newest first. A pinned run is the one its source's counts come from in
 * Analytics and the survey timeline; pinning one unpins the source's others.
 */
export function RunTable({
  runs,
  classes,
  pinning,
  onPin,
}: {
  runs: RunSummary[];
  classes: ClassDef[];
  /** The run whose pin is being saved. */
  pinning: string | null;
  onPin: (run: RunSummary, pinned: boolean) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-2 pr-3 font-medium">Source</th>
          <th className="pr-3 font-medium">Model</th>
          <th className="pr-3 font-medium">State</th>
          <th className="pr-3 font-medium">
            Found <span className="font-normal text-dim">total (verified)</span>
          </th>
          <th className="pr-3 font-medium">Review</th>
          <th className="font-medium">
            <span className="sr-only">Pin</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => {
          const state = run.job_state
            ? STATE[run.job_state]
            : { text: "Not started", tone: "neutral" as const };
          const cells = countCells(run, classes);
          const label = run.source_label ?? "Unknown source";
          return (
            <tr key={run.id} className="border-t border-line align-top">
              <td className="py-2.5 pr-3">
                <div className="text-ink">{label}</div>
                <div className="text-xs text-muted">
                  {run.kind === "map" ? "Map · objects" : "Photos · detections"}
                </div>
              </td>
              <td className="py-2.5 pr-3">
                <div className="text-ink">{run.model_name ?? "Unknown model"}</div>
                <div className="text-xs tabular-nums text-muted">{`confidence ${run.conf}`}</div>
              </td>
              <td className="py-2.5 pr-3">
                <Pill tone={state.tone} live={"live" in state ? state.live : undefined}>
                  {state.text}
                </Pill>
              </td>
              <td className="py-2.5 pr-3">
                {cells.length === 0 ? (
                  <span className="text-dim">-</span>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {cells.map((c) => (
                      <li key={c.id} className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: c.colour }}
                        />
                        <span className="text-muted">{c.name}</span>
                        <span className="tabular-nums text-ink">{c.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="min-w-36 py-2.5 pr-3">
                <div className="text-xs tabular-nums text-muted">{reviewText(run.review)}</div>
                {run.review.total > 0 && (
                  <Progress
                    thin
                    className="mt-1.5"
                    value={run.review.reviewed / run.review.total}
                    label={`${label} review progress`}
                  />
                )}
              </td>
              <td className="py-2 text-right">
                <Button
                  size="sm"
                  variant={run.pinned ? "secondary" : "ghost"}
                  aria-pressed={run.pinned}
                  aria-label={run.pinned ? `Unpin the run on ${label}` : `Pin the run on ${label}`}
                  loading={pinning === run.id}
                  icon={run.pinned ? "check" : undefined}
                  onClick={() => onPin(run, !run.pinned)}
                >
                  {run.pinned ? "Pinned" : "Pin"}
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
