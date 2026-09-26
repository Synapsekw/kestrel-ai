import { useEffect, useMemo, useRef } from "react";
import { useJobsStore } from "@/store/jobs";
import { Alert, IconButton, SkeletonRows } from "@/ui";
import { JobCard } from "./JobCard";
import { useJobList } from "./useJobList";

/** Global slide-over listing the project's jobs newest first; fed by the websocket and by polling while open. */
export function JobsPanel({ projectId }: { projectId: string }) {
  const open = useJobsStore((s) => s.panelOpen);
  const setPanelOpen = useJobsStore((s) => s.setPanelOpen);
  const jobs = useJobsStore((s) => s.jobs);
  const list = useJobList(projectId, open);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sorted = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs, projectId],
  );
  // Focus moves into the slide-over when it opens and back to whatever opened it when it closes;
  // Escape closes it from anywhere.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      panelRef.current?.focus();
      return;
    }
    triggerRef.current?.focus();
    triggerRef.current = null;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setPanelOpen]);

  if (!open) return null;
  return (
    <aside
      ref={panelRef}
      id="jobs-panel"
      role="dialog"
      aria-label="Jobs"
      aria-modal="false"
      tabIndex={-1}
      className="absolute inset-y-0 right-0 z-20 flex w-[28rem] max-w-full flex-col border-l border-line bg-surface shadow-float animate-slide-in focus:outline-none reduce-motion:animate-none"
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pl-4 pr-2">
        <h2 className="flex-1 text-base font-semibold">Jobs</h2>
        <IconButton icon="refresh" label="Refresh" size="sm" onClick={list.reload} disabled={list.loading} />
        <IconButton icon="x" label="Close jobs" size="sm" onClick={() => setPanelOpen(false)} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {list.error && <Alert tone="danger">{list.error}</Alert>}
        {sorted.length === 0 &&
          (list.loading ? (
            <SkeletonRows rows={3} columns={3} className="py-2" />
          ) : (
            <p className="py-6 text-center text-sm text-muted">No jobs yet.</p>
          ))}
        {sorted.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {sorted.map((job) => (
              <li key={job.id}>
                <JobCard projectId={projectId} job={job} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
