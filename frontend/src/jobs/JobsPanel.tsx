import { useMemo } from "react";
import { useJobsStore } from "@/store/jobs";
import { JobCard } from "./JobCard";
import { useJobList } from "./useJobList";

const btn = "rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-50";

/** Global slide-over listing the project's jobs newest first; fed by the websocket and by polling while open. */
export function JobsPanel({ projectId }: { projectId: string }) {
  const open = useJobsStore((s) => s.panelOpen);
  const setPanelOpen = useJobsStore((s) => s.setPanelOpen);
  const jobs = useJobsStore((s) => s.jobs);
  const list = useJobList(projectId, open);
  const sorted = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs, projectId],
  );
  if (!open) return null;
  return (
    <aside
      id="jobs-panel"
      role="dialog"
      aria-label="Jobs"
      className="absolute inset-y-0 right-0 z-20 flex w-[28rem] max-w-full flex-col gap-3 overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 shadow-xl"
    >
      <header className="flex items-center gap-2">
        <h2 className="text-lg font-medium">Jobs</h2>
        <button type="button" className={btn} onClick={list.reload} disabled={list.loading}>
          Refresh
        </button>
        <button type="button" className={`${btn} ml-auto`} onClick={() => setPanelOpen(false)}>
          Close jobs
        </button>
      </header>
      {list.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {list.error}
        </p>
      )}
      {sorted.length === 0 && (
        <p className="text-sm text-slate-400">{list.loading ? "Loading…" : "No jobs yet."}</p>
      )}
      <ul className="flex flex-col gap-2">
        {sorted.map((job) => (
          <li key={job.id}>
            <JobCard projectId={projectId} job={job} />
          </li>
        ))}
      </ul>
    </aside>
  );
}
