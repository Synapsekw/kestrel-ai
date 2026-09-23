import type { MapRun } from "@contract/client";
import { useApi } from "@/api/client";
import { deleteMapRun, resumeMapRun } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Checkbox, IconButton, Pill, Progress, type PillTone } from "@/ui";
import { runTitle } from "./runModel";

const TONE: Record<string, PillTone> = {
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
  running: "accent",
  queued: "neutral",
};

export function RunList({
  projectId,
  runs,
  selected,
  onToggle,
  onChanged,
  readOnly = false,
}: {
  projectId: string;
  runs: MapRun[];
  selected: string[];
  onToggle: (runId: string) => void;
  onChanged: () => void;
  /** Hide Resume and Delete: the runs can be shown, not changed. */
  readOnly?: boolean;
}) {
  const api = useApi();
  const jobs = useJobsStore((s) => s.jobs);
  if (!runs.length) return <p className="text-sm text-muted">No runs on this map yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Runs">
      {runs.map((r) => {
        const job = r.job_id ? jobs[r.job_id] : undefined;
        const state = job?.state ?? r.state ?? "queued";
        const done = state === "succeeded";
        return (
          <li key={r.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={selected.includes(r.id)}
                disabled={!done}
                onChange={() => onToggle(r.id)}
                aria-label={`Show ${runTitle(r)}`}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{runTitle(r)}</span>
              <Pill tone={TONE[state] ?? "neutral"}>{done ? `${r.detection_count}` : state}</Pill>
            </div>
            {(state === "running" || state === "queued") && (
              <Progress value={job?.progress} running label={`Detecting: ${runTitle(r)}`} thin />
            )}
            {!readOnly && (state === "failed" || state === "cancelled") && (
              <div className="flex gap-1">
                <IconButton
                  icon="refresh"
                  size="sm"
                  label="Resume run"
                  onClick={() =>
                    void resumeMapRun(api, projectId, r.id).then((j) => {
                      useJobsStore.getState().upsert(j);
                      onChanged();
                    })
                  }
                />
                <IconButton
                  icon="trash"
                  size="sm"
                  label="Delete run"
                  onClick={() => void deleteMapRun(api, projectId, r.id).then(onChanged)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
