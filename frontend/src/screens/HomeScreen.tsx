import { Link, useParams } from "react-router-dom";
import type { Job } from "@contract/client";
import { useProject } from "@/api/project";
import { nextStep } from "@/app/nextStep";
import { StepTicks } from "@/app/NextStepBar";
import { useProgress } from "@/app/useProjectProgress";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Icon, Progress, Skeleton, buttonClass } from "@/ui";

const TYPE_VERB: Record<Job["type"], string> = {
  import: "Importing images",
  dataset: "Building a dataset",
  train: "Training",
  infer: "Detecting",
  export: "Exporting",
  results_export: "Exporting results",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** The project's front page: where it stands, what to do next, what is running. */
export function HomeScreen() {
  const { projectId = "" } = useParams();
  const { project, error } = useProject(projectId);
  const progress = useProgress(projectId);
  const jobs = useJobsStore((s) => s.jobs);
  const running = Object.values(jobs)
    .filter((j) => j.project_id === projectId && isActiveJob(j))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const step = progress ? nextStep(projectId, progress) : null;

  if (error) return <Alert tone="danger">{error}</Alert>;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      <div className="flex flex-col gap-1">
        {project ? (
          <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        ) : (
          <Skeleton className="h-7 w-48" />
        )}
        {project && <p className="truncate font-mono text-xs text-muted">{project.folder}</p>}
      </div>

      {!progress ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : step ? (
        <div
          data-testid="home-next-step"
          className="flex flex-col gap-3 rounded-lg border border-accent-line bg-accent-soft p-5 text-accent-ink animate-reveal motion-reduce:animate-none"
        >
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-ink/70">Next step</p>
            <StepTicks projectId={projectId} />
          </div>
          <p className="text-lg font-semibold text-ink">{step.text}</p>
          <p className="max-w-prose text-sm leading-relaxed">{step.detail}</p>
          <Link to={step.to} className={buttonClass("primary", "md", "mt-1 w-fit")}>
            {step.text}
            <Icon name="arrow-right" size={15} />
          </Link>
        </div>
      ) : null}

      <div className="grid gap-8 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Where this project stands</h2>
          {progress ? (
            <dl className="flex flex-col">
              <Row label="Images" value={String(progress.images)} />
              <Row label="Labeled" value={`${progress.labeled} of ${progress.images}`} />
              <Row label="Datasets" value={String(progress.datasets)} />
              <Row
                label="Models"
                value={progress.models === 0 ? "0" : `${progress.models} (${progress.trainedModels} trained)`}
              />
              <Row label="Detection runs" value={String(progress.queryRuns)} />
              <Row label="Waiting for review" value={String(progress.pendingReview)} />
            </dl>
          ) : (
            <div className="flex flex-col gap-3 pt-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">Running now</h2>
          {running.length === 0 ? (
            <p className="text-sm text-muted">Nothing is running.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {running.map((job) => (
                <li key={job.id} className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{TYPE_VERB[job.type]}</span>
                    <span className="truncate text-xs text-muted">{job.message}</span>
                  </div>
                  <Progress value={job.progress} running label={TYPE_VERB[job.type]} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
