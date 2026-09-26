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
