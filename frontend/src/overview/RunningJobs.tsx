import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { jobTitle } from "@/jobs/jobLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { GlassPanel, Progress, StatusDot, cx, focusRing, stagger } from "@/ui";

const SHOWN = 2;

function JobCard({ job, index }: { job: Job; index: number }) {
  const running = isActiveJob(job);
  const title = jobTitle(job);
  return (
    <GlassPanel variant="pane" className="stagger animate-rise px-4 py-3.5" style={stagger(6 + index)}>
      <p className="flex items-center gap-2 text-xs text-muted">
        <StatusDot status={running ? "running" : "idle"} live={running} />
        {running ? (job.state === "queued" ? "Queued" : "Running") : "Last finished"}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="truncate font-semibold text-ink">{title}</span>
        {running ? (
          <span className="font-mono text-xs tabular-nums text-muted">{Math.round(job.progress * 100)}%</span>
        ) : (
          <span className="text-xs text-ok">Done</span>
        )}
      </div>
      {running && <Progress value={job.progress} running label={title} className="mt-2.5" />}
      {job.message && <p className="mt-2 truncate font-mono text-2xs text-muted">{job.message}</p>}
    </GlassPanel>
  );
}

/** The project's active jobs (live from the WebSocket store) and the newest finished one. */
export function RunningJobs({ projectId }: { projectId: string }) {
  const jobs = useJobsStore((s) => s.jobs);
  const { running, done } = useMemo(() => {
    const mine = Object.values(jobs)
      .filter((j) => j.project_id === projectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { running: mine.filter(isActiveJob), done: mine.find((j) => j.state === "succeeded") };
  }, [jobs, projectId]);

  if (running.length === 0 && !done)
    return (
      <GlassPanel variant="pane" className="stagger animate-rise px-4 py-3.5" style={stagger(6)}>
        <h2 className="text-xs text-muted">Jobs</h2>
        <p className="mt-2 text-sm text-muted">Nothing is running.</p>
      </GlassPanel>
    );
  return (
    <>
      {running.slice(0, SHOWN).map((j, i) => (
        <JobCard key={j.id} job={j} index={i} />
      ))}
      {running.length > SHOWN && (
        <Link
          to={`/jobs?project=${projectId}`}
          className={cx("self-start rounded-sm px-1 text-xs text-accent-ink", focusRing)}
        >
          {running.length - SHOWN} more running in Jobs →
        </Link>
      )}
      {done && <JobCard job={done} index={SHOWN} />}
    </>
  );
}
