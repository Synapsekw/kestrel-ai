import { useSearchParams } from "react-router-dom";
import type { AppJob } from "@/api/appJobs";
import { useRecentProjects } from "@/api/recentProjects";
import { formatLocalDate } from "@/library/modelLabels";
import { isActiveJob } from "@/store/jobs";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  GlassPanel,
  Pill,
  Progress,
  Segmented,
  Select,
  type Column,
} from "@/ui";
import { JobInspector } from "./JobInspector";
import { elapsedSeconds, formatDuration, jobTitle, stateLabel } from "./jobLabels";
import {
  JOB_STATE_TONE,
  LIBRARY_FILTER,
  jobsViewParams,
  projectLabel,
  readJobsView,
  type JobSegment,
  type JobsView,
} from "./jobsFilters";
import { useActiveJobCounts, useAppJobs } from "./useAppJobs";
import { useNow } from "./useNow";

const EMPTY_TITLE: Record<JobSegment, string> = {
  running: "Nothing is running",
  queued: "Nothing is waiting",
  finished: "No finished jobs yet",
  failed: "No failed jobs",
};

function JobDuration({ job }: { job: AppJob }) {
  const now = useNow(1000, isActiveJob(job));
  const s = elapsedSeconds(job, now);
  return <span className="font-mono text-xs tabular-nums">{s === null ? "–" : formatDuration(s)}</span>;
}

const COLUMNS: Column<AppJob>[] = [
  {
    key: "type",
    header: "Job",
    width: "minmax(12rem,2fr)",
    render: (j) => <span className="truncate font-medium">{jobTitle(j)}</span>,
  },
  {
    key: "state",
    header: "State",
    width: "7rem",
    render: (j) => (
      <Pill tone={JOB_STATE_TONE[j.state]} live={j.state === "running"} size="sm">
        {stateLabel(j.state)}
      </Pill>
    ),
  },
  {
    key: "project",
    header: "Project",
    width: "minmax(8rem,1fr)",
    render: (j) => <span className="truncate text-muted">{projectLabel(j)}</span>,
  },
  {
    key: "message",
    header: "Message",
    width: "minmax(10rem,2fr)",
    render: (j) => <span className="truncate text-muted">{j.error ?? j.message}</span>,
  },
  {
    key: "progress",
    header: "Progress",
    width: "8rem",
    render: (j) => (
      <Progress value={j.progress} running={j.state === "running"} label={`${jobTitle(j)} progress`} />
    ),
  },
  {
    key: "started",
    header: "Started",
    width: "9rem",
    render: (j) => (
      <span className="font-mono text-xs tabular-nums text-muted">
        {j.started_at ? formatLocalDate(j.started_at) : "–"}
      </span>
    ),
  },
  { key: "duration", header: "Duration", width: "7rem", render: (j) => <JobDuration job={j} /> },
];

/** F §10.2: every job in the app, library and open projects together. */
export function JobsScreen() {
  const [params, setParams] = useSearchParams();
  const view = readJobsView(params);
  const jobs = useAppJobs(view.segment, view.project);
  const counts = useActiveJobCounts(view.project);
  const { projects } = useRecentProjects();
  const set = (next: Partial<JobsView>) => setParams(jobsViewParams({ ...view, ...next }), { replace: true });
  const selected = view.jobId ? jobs.find(view.jobId) : null;

  const segments: { value: JobSegment; label: string }[] = [
    { value: "running", label: `Running · ${counts.running}` },
    { value: "queued", label: `Queued · ${counts.queued}` },
    { value: "finished", label: "Finished" },
    { value: "failed", label: "Failed" },
  ];

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted">
          Every background job on this computer: imports, detection runs, dataset builds, training, exports
          and upgrades.
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Segmented
          label="Job state"
          options={segments}
          value={view.segment}
          onChange={(segment) => set({ segment, jobId: null })}
        />
        <Field label="Project" htmlFor="jobs-project" inline>
          <Select
            id="jobs-project"
            value={view.project ?? ""}
            onChange={(e) => set({ project: e.target.value || null, jobId: null })}
          >
            <option value="">All projects</option>
            <option value={LIBRARY_FILTER}>Model library</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {jobs.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" onClick={jobs.reload}>
              Retry
            </Button>
          }
        >
          {jobs.error}
        </Alert>
      )}
      <div className="grid items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <GlassPanel variant="pane" className="min-w-0 overflow-hidden">
          <DataTable
            label="Jobs"
            columns={COLUMNS}
            rows={jobs.rows}
            rowKey={(j) => j.id}
            activeKey={view.jobId}
            onOpen={(j) => set({ jobId: j.id })}
            loading={jobs.loading}
            onEndReached={jobs.hasMore ? jobs.loadMore : undefined}
            empty={<EmptyState icon="jobs" title={EMPTY_TITLE[view.segment]} />}
          />
        </GlassPanel>
        {view.jobId &&
          (selected ? (
            <JobInspector key={selected.id} job={selected} onClose={() => set({ jobId: null })} />
          ) : (
            !jobs.loading && (
              <GlassPanel variant="pane" className="p-4">
                <EmptyState icon="jobs" title="This job is not in the list">
                  It may be older than the loaded pages, or its project is closed. Choose a job from the list.
                </EmptyState>
              </GlassPanel>
            )
          ))}
      </div>
    </section>
  );
}
