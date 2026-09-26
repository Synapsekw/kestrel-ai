import { Link } from "react-router-dom";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Pill, Progress, buttonClass } from "@/ui";
import { SurveyDateCell } from "./SurveyDateCell";
import { runLine, sizeLine, type SourceRow } from "./sourceRows";

/** Where a source stands before it can be run: importing, failed, or ready. */
function useImportState(row: SourceRow): { importing: boolean; progress?: number; failed: boolean } {
  const job = useJobsStore((s) => {
    const id = row.map?.job_id ?? row.source?.job_id;
    return id ? s.jobs[id] : undefined;
  });
  if (row.map) {
    return {
      importing: row.map.status === "importing",
      progress: job?.progress,
      failed: row.map.status === "failed",
    };
  }
  const running = !!job && job.type === "import" && isActiveJob(job);
  return { importing: running, progress: running ? job.progress : undefined, failed: false };
}

function SizeCell({ row }: { row: SourceRow }) {
  const state = useImportState(row);
  if (state.importing)
    return (
      <div className="flex w-32 flex-col gap-1">
        <span className="text-xs text-muted">Importing</span>
        <Progress value={state.progress} running thin label={`Importing ${row.label}`} />
      </div>
    );
  if (state.failed) return <Pill tone="danger">Import failed</Pill>;
  return <span className="tabular-nums text-muted">{sizeLine(row.source, row.map)}</span>;
}

function RunCell({ row }: { row: SourceRow }) {
  const run = row.run;
  if (!run) return <span className="text-muted">No run yet</span>;
  const line = runLine(run, row.kind);
  if (run.job_state === "queued" || run.job_state === "running")
    return (
      <span className="flex flex-col items-start gap-1">
        <span className="text-ink">{line.model}</span>
        <Pill tone="accent" live size="sm">
          Running
        </Pill>
      </span>
    );
  if (run.job_state === "failed" || run.job_state === "cancelled")
    return (
      <span className="flex flex-col items-start gap-1">
        <span className="text-ink">{line.model}</span>
        <Pill tone="danger" size="sm">
          {run.job_state === "failed" ? "Run failed" : "Run cancelled"}
        </Pill>
      </span>
    );
  return (
    <span className="flex flex-col">
      <span className="text-ink">
        {line.model}
        {run.pinned && <span className="text-muted"> · pinned</span>}
      </span>
      <span className="tabular-nums text-muted">{line.counts}</span>
      <span className="text-xs tabular-nums text-dim">{line.review}</span>
    </span>
  );
}

function Actions({ row, projectId }: { row: SourceRow; projectId: string }) {
  const { importing, failed } = useImportState(row);
  const ready = !importing && !failed;
  const runnable =
    ready && !!row.source && (row.kind === "map" ? row.map?.status === "ready" : row.source.image_count > 0);
  return (
    <div className="flex justify-end gap-2">
      {row.map && row.map.status === "ready" && (
        <Link to={`/p/${projectId}/maps/${row.map.id}`} className={buttonClass("ghost", "sm")}>
          Open map
        </Link>
      )}
      {runnable && (
        <Link
          to={`/p/${projectId}/runs?source=${encodeURIComponent(row.source!.id)}`}
          className={buttonClass("secondary", "sm")}
        >
          Run a model
        </Link>
      )}
    </div>
  );
}

/**
 * Every photo batch and map of the project in one table: what it is, when it was flown, how big it
 * is and what its chosen run found.
 */
export function SourceTable({
  projectId,
  rows,
  onSaveDate,
}: {
  projectId: string;
  rows: SourceRow[];
  onSaveDate: (row: SourceRow, capturedOn: string | null) => Promise<void>;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th scope="col" className="py-2 pr-4 font-medium">
            Source
          </th>
          <th scope="col" className="pr-4 font-medium">
            Survey date
          </th>
          <th scope="col" className="pr-4 font-medium">
            Size
          </th>
          <th scope="col" className="pr-4 font-medium">
            Latest run
          </th>
          <th scope="col" className="font-medium">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-line align-top">
            <th scope="row" className="max-w-0 py-3 pr-4 text-left font-normal sm:w-[30%]">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-ink">{row.label}</span>
                <Pill tone={row.kind === "map" ? "accent" : "neutral"} size="sm">
                  {row.kind === "map" ? "Map" : "Photos"}
                </Pill>
              </span>
              <span className="mt-0.5 block truncate font-mono text-xs text-dim" title={row.path}>
                {row.path}
              </span>
            </th>
            <td className="py-3 pr-4">
              <SurveyDateCell
                label={row.label}
                value={row.capturedOn}
                onSave={(next) => onSaveDate(row, next)}
              />
            </td>
            <td className="py-3 pr-4">
              <SizeCell row={row} />
            </td>
            <td className="py-3 pr-4">
              <RunCell row={row} />
            </td>
            <td className="py-3">
              <Actions row={row} projectId={projectId} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
