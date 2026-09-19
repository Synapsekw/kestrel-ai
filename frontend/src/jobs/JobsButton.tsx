import { selectActiveCount, useJobsStore } from "@/store/jobs";
import { Button } from "@/ui";

/** Header toggle for the jobs drawer; its accessible name doubles as the active-job counter. */
export function JobsButton() {
  const count = useJobsStore(selectActiveCount);
  const open = useJobsStore((s) => s.panelOpen);
  const setPanelOpen = useJobsStore((s) => s.setPanelOpen);
  return (
    <Button
      size="sm"
      variant={open ? "secondary" : "ghost"}
      icon="jobs"
      aria-controls="jobs-panel"
      aria-expanded={open}
      aria-label={`${count} active ${count === 1 ? "job" : "jobs"}`}
      onClick={() => setPanelOpen(!open)}
    >
      Jobs
      {count > 0 && (
        <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
          {count}
        </span>
      )}
    </Button>
  );
}
