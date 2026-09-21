import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { thumbnailUrl, type Job, type Image } from "@contract/client";
import { useBackend } from "@/api/client";
import { useProject } from "@/api/project";
import { nextStep } from "@/app/nextStep";
import { StepTicks } from "@/app/NextStepBar";
import { useProgress } from "@/app/useProjectProgress";
import { useHomePreviews } from "@/app/useHomePreviews";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Icon, Progress, Skeleton, buttonClass, cx } from "@/ui";

function Preview({ image, src, hero = false }: { image?: Image; src?: string; hero?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cx(
        "relative flex items-center justify-center overflow-hidden bg-canvas",
        hero ? "min-h-[220px] lg:min-h-[320px]" : "h-28 rounded-md",
      )}
    >
      {image && src && !failed ? (
        <img
          src={src}
          alt={image.file_name}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-3 p-8 text-muted">
          <Icon name="images" size={28} />
          <span className="text-xs">{image ? "Preview unavailable" : "Your images will appear here"}</span>
        </div>
      )}
      {hero && image && !failed && (
        <span className="absolute bottom-4 left-4 right-4 w-fit max-w-[calc(100%-2rem)] truncate rounded-md bg-canvas/90 px-3 py-2 font-mono text-xs text-inverse-fg">
          {image.file_name}
        </span>
      )}
    </div>
  );
}

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
  const previews = useHomePreviews(projectId);
  const { baseUrl, token } = useBackend();
  const firstPreview = previews[0];
  const jobs = useJobsStore((s) => s.jobs);
  const running = Object.values(jobs)
    .filter((j) => j.project_id === projectId && isActiveJob(j))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const step = progress ? nextStep(projectId, progress) : null;

  if (error) return <Alert tone="danger">{error}</Alert>;

  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-7 py-2 lg:px-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Project workspace</p>
          {project ? (
            <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">
              {project.name}
            </h1>
          ) : (
            <Skeleton className="h-7 w-48" />
          )}
          {project && <p className="truncate font-mono text-xs text-muted">{project.folder}</p>}
        </div>
        <Link to={`/p/${projectId}/data`} className={buttonClass("secondary", "md")}>
          <Icon name="images" size={15} />
          Browse images
        </Link>
      </div>

      {!progress ? (
        <Skeleton className="h-28 w-full rounded-lg" />
      ) : step ? (
        <div
          data-testid="home-next-step"
          className="grid overflow-hidden rounded-lg border border-line bg-panel lg:grid-cols-[1.2fr_1fr]"
        >
          <Preview
            key={firstPreview?.id ?? "empty"}
            image={firstPreview}
            src={firstPreview ? thumbnailUrl(baseUrl, token, projectId, firstPreview.id) : undefined}
            hero
          />
          <div className="flex flex-col items-start justify-center gap-4 p-6 lg:p-8">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-accent-ink">Next step</p>
            <h2 className="max-w-sm text-2xl font-semibold leading-tight tracking-tight text-ink">
              {step.text}
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-muted">{step.detail}</p>
            <Link to={step.to} className={buttonClass("primary", "md", "mt-2 w-fit")}>
              {step.text}
              <Icon name="arrow-right" size={15} />
            </Link>
          </div>
        </div>
      ) : null}

      {progress && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-5 text-xs text-muted">
          <span>
            {progress.labeled} of {progress.images} images labeled
          </span>
          <StepTicks projectId={projectId} />
        </div>
      )}

      {previews.length > 1 && (
        <section aria-label="Recent images" className="flex flex-col gap-3">
          <h2 className="text-base font-semibold">Recently imported</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {previews.slice(1).map((image) => (
              <Link
                key={image.id}
                to={`/p/${projectId}/edit/${image.id}`}
                className="group flex min-w-0 items-center gap-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <div className="w-40 shrink-0">
                  <Preview image={image} src={thumbnailUrl(baseUrl, token, projectId, image.id)} />
                </div>
                <div className="min-w-0">
                  <p
                    className="truncate font-mono text-xs group-hover:text-accent-ink"
                    title={image.file_name}
                  >
                    {image.file_name}
                  </p>
                  <p className="mt-2 text-xs text-muted">
                    {image.pending_count > 0
                      ? `${image.pending_count} suggestions to review`
                      : image.marked_empty
                        ? "No machinery"
                        : image.labeled
                          ? "Labeled"
                          : "Ready to label"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

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
