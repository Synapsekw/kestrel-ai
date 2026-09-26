import { Link } from "react-router-dom";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Pill, cx, focusRing } from "@/ui";
import { JOB_VERB } from "./jobVerbs";

/** The project's newest active job as a live pill that opens its jobs; nothing when idle. */
export function RunningPill({ projectId }: { projectId: string | undefined }) {
  const jobs = useJobsStore((s) => s.jobs);
  if (!projectId) return null;
  const active = Object.values(jobs)
    .filter((j) => j.project_id === projectId && isActiveJob(j))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (active.length === 0) return null;
  const job = active[0];
  const text = job.message ? `${JOB_VERB[job.type]}: ${job.message}` : JOB_VERB[job.type];
  const more = active.length > 1 ? ` (+${active.length - 1})` : "";
  return (
    <Link
      to={`/jobs?project=${projectId}`}
      title={text}
      className={cx("hidden min-w-0 max-w-xs rounded-chip sm:inline-flex", focusRing)}
    >
      <Pill tone="accent" live>
        <span className="truncate">
          {text}
          {more}
        </span>
      </Pill>
    </Link>
  );
}
