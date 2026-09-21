import type { Job } from "@contract/client";
import { isActiveJob } from "@/store/jobs";
import { Alert, Button, Pill, Progress } from "@/ui";
export function SetupJob({
  title,
  job,
  onCancel,
  onRetry,
  retryLabel,
  busy,
}: {
  title: string;
  job: Job;
  onCancel: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  busy: boolean;
}) {
  const active = isActiveJob(job);
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Pill tone={job.state === "succeeded" ? "ok" : "neutral"}>{job.state}</Pill>
      </div>
      <p role="status" className="text-sm text-muted">
        {job.message || (active ? "Waiting for progress…" : job.state)}
      </p>
      {active && (
        <>
          <Progress value={job.progress} running label={title} />
          <Button size="sm" disabled={busy} onClick={onCancel} className="self-start">
            Cancel {title.toLowerCase()}
          </Button>
        </>
      )}
      {job.state === "failed" && (
        <Alert tone="danger">
          {job.error || "This step failed. You can retry without recreating the project."}
        </Alert>
      )}
      {(job.state === "failed" || job.state === "cancelled") && onRetry && (
        <Button disabled={busy} onClick={onRetry}>
          {retryLabel ?? "Retry"}
        </Button>
      )}
    </section>
  );
}
