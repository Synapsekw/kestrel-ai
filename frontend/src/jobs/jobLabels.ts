import type { Job, JobState } from "@contract/client";

const TYPE_LABEL: Record<Job["type"], string> = {
  import: "Import",
  dataset: "Dataset",
  train: "Training",
  infer: "Detection run",
  export: "Export",
};

const STATE_LABEL: Record<JobState, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

function str(record: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = record?.[key];
  return typeof v === "string" && v ? v : null;
}

export function jobTitle(job: Job): string {
  const name = str(job.params, "name");
  return name ? `${TYPE_LABEL[job.type]}: ${name}` : TYPE_LABEL[job.type];
}

export function stateLabel(state: JobState): string {
  return STATE_LABEL[state];
}

/** Seconds from `started_at` to `finished_at` (or to `nowMs` while running); null before the job starts. */
export function elapsedSeconds(job: Job, nowMs: number): number | null {
  if (!job.started_at) return null;
  const start = Date.parse(job.started_at);
  const end = job.finished_at ? Date.parse(job.finished_at) : nowMs;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}

export interface ResultTarget {
  label: string;
  to: string;
}

/** Where a succeeded job's output lives (contract `Job.result` shapes per type). */
export function resultTarget(job: Job, projectId: string): ResultTarget | null {
  if (job.state !== "succeeded") return null;
  const p = `/p/${projectId}`;
  switch (job.type) {
    case "train": {
      const id = str(job.result, "model_id");
      return id ? { label: "Open model", to: `${p}/models?model=${id}` } : null;
    }
    case "infer": {
      const id = str(job.result, "query_run_id");
      return id ? { label: "Open run", to: `${p}/query?run=${id}` } : null;
    }
    case "export": {
      const id = str(job.params, "model_id");
      return id ? { label: "Open model", to: `${p}/models?model=${id}` } : null;
    }
    case "dataset":
      return { label: "Train on it", to: `${p}/train` };
    case "import":
      return { label: "Open images", to: `${p}/data` };
  }
}
