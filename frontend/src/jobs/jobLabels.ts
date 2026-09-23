import type { Job, JobState } from "@contract/client";

const TYPE_LABEL: Record<Job["type"], string> = {
  import: "Import",
  dataset: "Dataset",
  train: "Training",
  infer: "Detection run",
  export: "Export",
  results_export: "Results export",
  map_import: "Map import",
  map_detect: "Map detection",
  map_export: "Map export",
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
  if (job.type === "import" && job.params?.purpose === "starter_model") {
    return `Model download: ${str(job.params, "name") ?? str(job.params, "key") ?? "YOLO"}`;
  }
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
      if (job.params?.purpose === "starter_model") {
        const id = str(job.result, "model_id");
        return id ? { label: "Open model", to: `${p}/models?model=${id}` } : null;
      }
      return { label: "Open images", to: `${p}/data` };
    case "results_export":
      return null; // it already lives on the Export screen that started it
    case "map_import":
    case "map_detect":
      return { label: "Open maps", to: `${p}/maps` };
    case "map_export":
      // Its files and "show in folder" live in `ExportJobs` on the Export screen (widened to list
      // map exports alongside results exports), not on the Maps screen that started it.
      return { label: "Open export", to: `${p}/export` };
  }
}

/** "N images, M boxes" for a finished results export, or null (still running, failed, or not one). */
export function resultsExportSummary(job: Job): string | null {
  if (job.type !== "results_export" || job.state !== "succeeded" || !job.result) return null;
  const imageCount = job.result.image_count;
  const boxCount = job.result.box_count;
  if (typeof imageCount !== "number" || typeof boxCount !== "number") return null;
  return `${imageCount} image${imageCount === 1 ? "" : "s"}, ${boxCount} box${boxCount === 1 ? "" : "es"}`;
}

/** The file list of a finished results or map export, project-relative to its folder; [] when not
 * available. */
export function resultsExportFiles(job: Job): string[] {
  const files = job.result?.files;
  return (job.type === "results_export" || job.type === "map_export") &&
    job.state === "succeeded" &&
    Array.isArray(files)
    ? files.filter((f): f is string => typeof f === "string")
    : [];
}

/** The folder a finished results or map export wrote into (project-relative), or null. */
export function resultsExportFolder(job: Job): string | null {
  const folder = job.result?.folder;
  return (job.type === "results_export" || job.type === "map_export") &&
    job.state === "succeeded" &&
    typeof folder === "string"
    ? folder
    : null;
}
