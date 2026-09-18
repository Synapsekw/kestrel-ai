import { selectActiveCount, useJobsStore } from "@/store/jobs";

/** Top-bar toggle for the jobs panel; the text doubles as the active-job counter. */
export function JobsButton() {
  const count = useJobsStore(selectActiveCount);
  const open = useJobsStore((s) => s.panelOpen);
  const setPanelOpen = useJobsStore((s) => s.setPanelOpen);
  return (
    <button
      type="button"
      aria-controls="jobs-panel"
      aria-expanded={open}
      onClick={() => setPanelOpen(!open)}
      className={`rounded px-2 py-1 text-xs hover:bg-slate-700 ${count > 0 ? "bg-orange-700 text-orange-50" : "bg-slate-800 text-slate-300"}`}
    >
      {count} active {count === 1 ? "job" : "jobs"}
    </button>
  );
}
