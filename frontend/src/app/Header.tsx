/* eslint-disable react-refresh/only-export-components --
   screenName is a pure helper exported next to the header that uses it; not a fast-refresh boundary. */
import { useLocation } from "react-router-dom";
import type { Job } from "@contract/client";
import { JobsButton } from "@/jobs/JobsButton";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Button, Pill } from "@/ui";
import { useAgentPanel } from "@/agent/panelStore";

const SCREEN: Record<string, string> = {
  data: "Images",
  label: "Label",
  edit: "Label",
  review: "Review",
  datasets: "Datasets",
  models: "Models",
  train: "Train",
  query: "Detect",
  settings: "Project settings",
  export: "Export",
};

/** The human name of the screen at `pathname`. */
export function screenName(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "Projects";
  if (parts[0] === "settings") return "App settings";
  if (parts[0] === "p") return parts.length >= 3 ? (SCREEN[parts[2]] ?? "") : "Home";
  return "";
}

const TYPE_VERB: Record<Job["type"], string> = {
  import: "Importing",
  dataset: "Building a dataset",
  train: "Training",
  infer: "Detecting",
  export: "Exporting",
  results_export: "Exporting results",
  map_import: "Importing a map",
  map_detect: "Detecting on a map",
  map_export: "Exporting map results",
};

/** The newest active job as a live pill; nothing when the project is idle. */
function RunningPill({ projectId }: { projectId: string | undefined }) {
  const jobs = useJobsStore((s) => s.jobs);
  if (!projectId) return null;
  const active = Object.values(jobs)
    .filter((j) => j.project_id === projectId && isActiveJob(j))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (active.length === 0) return null;
  const job = active[0];
  const text = job.message ? `${TYPE_VERB[job.type]}: ${job.message}` : TYPE_VERB[job.type];
  const more = active.length > 1 ? ` (+${active.length - 1})` : "";
  return (
    <Pill tone="accent" live className="hidden max-w-xs sm:inline-flex" title={text}>
      <span className="truncate">
        {text}
        {more}
      </span>
    </Pill>
  );
}

/** Breadcrumb on the left, running work and the jobs drawer on the right. */
export function Header({
  projectId,
  projectName,
}: {
  projectId: string | undefined;
  projectName: string | null;
}) {
  const { pathname } = useLocation();
  const screen = screenName(pathname);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-ground px-4 lg:px-6">
      <p className="min-w-0 flex-1 truncate text-sm">
        {projectId ? (
          <>
            <span className="text-muted">{projectName ?? "Project"}</span>
            {screen && <span className="mx-1.5 text-dim">/</span>}
            <span className="font-medium text-ink">{screen}</span>
          </>
        ) : (
          <span className="font-medium text-ink">{screen}</span>
        )}
      </p>
      <RunningPill projectId={projectId} />
      <Button
        size="sm"
        aria-controls="setup-agent"
        aria-expanded={useAgentPanel((s) => s.open)}
        onClick={() => {
          useJobsStore.getState().setPanelOpen(false);
          useAgentPanel.getState().setOpen(true);
        }}
      >
        Setup agent
      </Button>
      <JobsButton />
    </header>
  );
}
