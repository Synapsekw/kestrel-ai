import type { Route } from "@playwright/test";

export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const JOB = "j0000000-4444-4000-8000-000000000001";
export const T0 = "2026-09-26T08:00:00Z";

/** Answers a routed request with JSON; the dev UI and the mock are different origins. */
export function fulfilJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  });
}

/** The catalogue as the Catalogue, builder and project-types specs see it (Tasks 5, 10, 15). */
export const CATALOGUE_PAGE = {
  items: [
    {
      id: "t-1",
      name: "Excavator",
      colour: "#f97316",
      kind: "object",
      default_severity: null,
      hotkey: "1",
      group: null,
      archived: false,
      origin: "migrated",
    },
    {
      id: "t-2",
      name: "Dump truck",
      colour: "#06b6d4",
      kind: "object",
      default_severity: null,
      hotkey: "2",
      group: null,
      archived: false,
      origin: "migrated",
    },
    {
      id: "t-3",
      name: "Crack",
      colour: "#ef4444",
      kind: "defect",
      default_severity: 2,
      hotkey: "c",
      group: "Concrete defects",
      archived: false,
      origin: "user",
    },
  ],
  next_cursor: null,
  needs_classification: true,
};

const RUNNING_IMPORT = {
  id: JOB,
  project_id: P,
  project_name: "Ahmadia",
  type: "import",
  state: "running",
  progress: 0.42,
  message: "1386 / 3299 images",
  log_path: `runs/${JOB}/job.log`,
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-26T10:05:00Z",
  started_at: "2026-09-26T10:05:01Z",
  finished_at: null,
};

const DONE_BUILD = {
  ...RUNNING_IMPORT,
  id: "j-build",
  project_id: "library",
  project_name: null,
  type: "dataset_build",
  state: "succeeded",
  progress: 1,
  message: "30 images",
  params: { name: "machines-v1", dataset_id: "d-lib-1" },
  result: { dataset_id: "d-lib-1" },
  created_at: "2026-09-26T09:00:00Z",
  finished_at: "2026-09-26T09:00:09Z",
};

const FAILED_TRAIN = {
  ...RUNNING_IMPORT,
  id: "j-failed",
  project_id: "library",
  project_name: null,
  type: "train",
  state: "failed",
  progress: 0.3,
  message: "epoch 15/50 mAP50 0.410",
  params: { name: "ahmadia-v1-n" },
  error: "CUDA out of memory",
  created_at: "2026-09-26T08:05:00Z",
  started_at: "2026-09-26T08:05:01Z",
  finished_at: "2026-09-26T08:35:01Z",
};

export const APP_JOBS = [RUNNING_IMPORT, DONE_BUILD, FAILED_TRAIN];

export const SEVERITY = [
  { level: 1, name: "Minor", colour: "#3fb68e" },
  { level: 2, name: "Moderate", colour: "#e2bf2e" },
  { level: 3, name: "Major", colour: "#ff9c3a" },
  { level: 4, name: "Critical", colour: "#ff5a4f" },
];

export const BACKFILL_JOB = {
  id: "j-backfill",
  project_id: "library",
  type: "findings_backfill",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "library/runs/j-backfill/job.log",
  params: {},
  result: null,
  error: null,
  created_at: T0,
  started_at: null,
  finished_at: null,
};

/** `GET /jobs` filtered by the request's `state` params, as the backend does. */
export function appJobsBody(url: string) {
  const states = new URL(url).searchParams.getAll("state");
  return {
    items: APP_JOBS.filter((j) => states.length === 0 || states.includes(j.state)),
    next_cursor: null,
  };
}

export const LIB_DATASET = {
  id: "d-lib-1",
  name: "machines-v1",
  task: "detect",
  origin: "built",
  filter: {
    project_ids: [P],
    type_ids: ["t-1", "t-2"],
    captured_from: null,
    captured_to: null,
    reviewed_only: true,
  },
  classes: [
    { type_id: "t-1", name: "Excavator" },
    { type_id: "t-2", name: "Dump truck" },
  ],
  split_method: "by_group",
  split_params: { val_fraction: 0.2, seed: 42 },
  state: "ready",
  counts: { images: 30, train: 24, val: 6, per_class: { "t-1": 40, "t-2": 72 } },
  export_path: null,
  export_state: "none",
  legacy_path: null,
  job_id: "j-build",
  created_at: T0,
  sources: [
    { project_id: P, project_name: "Ahmadia", project_folder: "E:\\Projects\\Ahmadia", image_count: 30 },
  ],
};

/** A queued library job; `patch` sets the id, type and params (export, build and training fixtures). */
export function libraryJob(patch: Record<string, unknown>) {
  return {
    id: "j-lib",
    project_id: "library",
    type: "dataset",
    state: "queued",
    progress: 0,
    message: "",
    log_path: "library/runs/j-lib/job.log",
    params: {},
    result: null,
    error: null,
    created_at: T0,
    started_at: null,
    finished_at: null,
    ...patch,
  };
}

export const RECENT_PROJECT = { id: P, name: "Ahmadia", folder: "E:\\Projects\\Ahmadia", classes: [] };

export const PREVIEW = {
  images: 30,
  boxes_per_type: { "t-1": 40, "t-2": 72 },
  projects: [{ project_id: P, project_name: "Ahmadia", images: 30, boxes: 112, state: "ok" }],
};

export const EXPORT_JOB = libraryJob({ id: "j-export", type: "dataset", params: { dataset_id: "d-lib-1" } });

/** Routes every `/library/datasets…` request to fixtures, the builder's preview and create included. */
export async function routeDatasets(page: import("@playwright/test").Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/library/datasets"),
    (route) => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      if (pathname === "/api/v1/library/datasets" && method === "GET")
        return fulfilJson(route, { items: [LIB_DATASET], next_cursor: null });
      if (pathname.endsWith("/preview")) return fulfilJson(route, PREVIEW);
      if (pathname === "/api/v1/library/datasets" && method === "POST")
        return fulfilJson(
          route,
          {
            dataset: { ...LIB_DATASET, id: "d-lib-2", name: "machines-v2", state: "resolving" },
            job: libraryJob({ id: "j-build-2", type: "dataset_build" }),
          },
          202,
        );
      if (pathname.endsWith("/items")) return fulfilJson(route, { items: [], next_cursor: null });
      if (pathname.endsWith("/export")) return fulfilJson(route, { job: EXPORT_JOB }, 202);
      if (method === "DELETE")
        return route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
      return fulfilJson(route, LIB_DATASET);
    },
  );
}

export const TRAINING_RUN = {
  id: "t-1",
  name: "machines-v1-yolo11m-coco",
  dataset_id: "d-lib-1",
  base_model_id: "m0000000-2222-4000-8000-000000000001",
  params: {
    name: "machines-v1-yolo11m-coco",
    dataset_id: "d-lib-1",
    base_model_id: "m0000000-2222-4000-8000-000000000001",
    epochs: 50,
    imgsz: 1280,
    batch: null,
    patience: 50,
    augmentation: "default",
    device: "0",
  },
  job_id: "j-train",
  state: "running",
  model_id: null,
  metrics: null,
  created_at: T0,
  finished_at: null,
};

/** Routes `/library/training-runs…` and the run's job; the model list comes from the Prism mock. */
export async function routeTraining(page: import("@playwright/test").Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/library/training-runs"),
    (route) => {
      const { pathname } = new URL(route.request().url());
      if (route.request().method() === "POST")
        return fulfilJson(
          route,
          {
            training_run: { ...TRAINING_RUN, id: "t-2", state: "queued" },
            job: libraryJob({ id: "j-train-2", type: "train" }),
          },
          202,
        );
      if (pathname === "/api/v1/library/training-runs")
        return fulfilJson(route, { items: [TRAINING_RUN], next_cursor: null });
      return fulfilJson(
        route,
        pathname.endsWith("/t-2") ? { ...TRAINING_RUN, id: "t-2", state: "queued" } : TRAINING_RUN,
      );
    },
  );
  await page.route(
    (url) => /^\/api\/v1\/library\/jobs\/j-train(-2)?$/.test(url.pathname),
    (route) =>
      fulfilJson(
        route,
        libraryJob({
          id: "j-train",
          type: "train",
          state: "running",
          progress: 0.2,
          message: "epoch 10/50 mAP50 0.412",
          started_at: T0,
        }),
      ),
  );
}
