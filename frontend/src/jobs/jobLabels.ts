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
  library_import: "Model import",
  library_export: "Model export",
  library_starter: "Model download",
  library_adopt: "Moving models to the library",
  map_move: "Map move",
  accept_above: "Bulk accept",
  recount: "Recount",
  area_recount: "Site-area recount",
  detect_export: "Detection export",
  pointcloud_import: "Point cloud import",
  pointcloud_export: "Point cloud export",
  surface_build: "Build surface",
  volume_calc: "Calculate volume",
  volume_export: "Export volumes",
  design_import: "Design surface import",
  project_migrate: "Project upgrade",
  findings_backfill: "Findings from annotations",
  findings_recount: "Findings recount",
  dataset_build: "Dataset build",
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
  if (job.type === "library_starter" || (job.type === "import" && job.params?.purpose === "starter_model")) {
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
  const model = (id: string | null) => (id ? { label: "Open model", to: `/library?model=${id}` } : null);
  switch (job.type) {
    case "train":
    case "library_import":
    case "library_starter":
      return model(str(job.result, "model_id"));
    case "export":
    case "library_export":
      return model(str(job.params, "model_id"));
    case "library_adopt":
      return { label: "Open library", to: "/library" };
    // Maps are sources and every run, photo or map, is listed on Runs: the old Detect and Maps
    // screens are no longer steps of a detection project, and neither opens in a training one.
    case "map_move":
      return { label: "Open sources", to: `${p}/sources` };
    case "infer":
      return str(job.result, "query_run_id") ? { label: "Open runs", to: `${p}/runs` } : null;
    case "dataset":
      return { label: "Train on it", to: `${p}/train` };
    case "import":
      if (job.params?.purpose === "starter_model") return model(str(job.result, "model_id"));
      return { label: "Open images", to: `${p}/data` };
    case "results_export":
      return null; // it already lives on the Export screen that started it
    case "map_import":
      return { label: "Open sources", to: `${p}/sources` };
    case "map_detect":
      return { label: "Open runs", to: `${p}/runs` };
    case "map_export":
      // Its files and "show in folder" live in `ExportJobs` on the Export screen (widened to list
      // map exports alongside results exports), not on the Maps screen that started it.
      return { label: "Open export", to: `${p}/export` };
    case "accept_above":
    case "recount":
      return { label: "Open runs", to: `${p}/runs` };
    case "area_recount":
      return { label: "Open analytics", to: `${p}/analytics` };
    case "detect_export":
      return { label: "Open export", to: `${p}/export` };
    case "pointcloud_import":
    case "pointcloud_export":
      return { label: "Open point clouds", to: `${p}/clouds` };
    case "surface_build":
    case "volume_calc":
    case "volume_export":
    case "design_import":
      return { label: "Open volumes", to: `${p}/volumes` };
    // Library jobs of the foundation: the Models and Catalogue sections that show their results
    // arrive with units S1 and S2, until then the job card has no link.
    case "project_migrate":
    case "findings_backfill":
    case "findings_recount":
    case "dataset_build":
      return null;
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

/** A job that writes files under `exports/`: a results export, a map export or a detection export. */
function isFileExport(job: Job): boolean {
  return job.type === "results_export" || job.type === "map_export" || job.type === "detect_export";
}

/** The file list of a finished results or map export, project-relative to its folder; [] when not
 * available. */
export function resultsExportFiles(job: Job): string[] {
  const files = job.result?.files;
  return isFileExport(job) && job.state === "succeeded" && Array.isArray(files)
    ? files.filter((f): f is string => typeof f === "string")
    : [];
}

/** The folder a finished results or map export wrote into (project-relative), or null. */
export function resultsExportFolder(job: Job): string | null {
  const folder = job.result?.folder;
  return isFileExport(job) && job.state === "succeeded" && typeof folder === "string" ? folder : null;
}
