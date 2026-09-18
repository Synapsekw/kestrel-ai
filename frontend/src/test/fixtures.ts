import {
  createApiClient,
  type ApiClient,
  type Box,
  type ClassDef,
  type Image as ImageRow,
  type ImagePage,
  type Job,
  type Model,
  type Project,
} from "@contract/client";

export const PROJECT_ID = "7f1c2e3a-1111-4000-8000-000000000001";
export const IMAGE_ID = "10000000-5555-4000-8000-000000000001";
export const IMAGE_ID_2 = "10000000-5555-4000-8000-000000000002";
export const MODEL_ID = "m0000000-2222-4000-8000-000000000001";
export const SOURCE_ID = "50000000-3333-4000-8000-000000000001";
export const CLASS_ID = (n: number): string => `c1a2b3c4-0000-4000-8000-00000000000${n}`;

const NAMES = [
  "excavator",
  "wheel_loader",
  "bulldozer",
  "dump_truck",
  "crane",
  "concrete_mixer",
  "roller",
  "backhoe",
];
const COLOURS = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444"];

export const exampleClasses: ClassDef[] = NAMES.map((name, i) => ({
  id: CLASS_ID(i + 1),
  name,
  colour: COLOURS[i],
  hotkey: String(i + 1),
  order: i,
}));

export const exampleProject: Project = {
  id: PROJECT_ID,
  name: "Ahmadia",
  folder: "E:\\Projects\\Ahmadia",
  classes: exampleClasses,
  preannotation_model_id: MODEL_ID,
  import_defaults: {
    max_side: 4000,
    quality: 95,
    dedupe_threshold: 4,
    group_regex: "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)",
  },
  schema_version: 1,
  created_at: "2026-09-17T10:00:00Z",
};

export const exampleImage: ImageRow = {
  id: IMAGE_ID,
  path: "images/ahmadia/IX-12-02491_0031_0001.jpg",
  file_name: "IX-12-02491_0031_0001.jpg",
  width: 4000,
  height: 2667,
  source_id: SOURCE_ID,
  group_key: "IX-12-02491_0031",
  capture_time: "2019-04-15T06:35:36Z",
  lat: 29.49469,
  lon: 47.76513,
  alt: 191.3,
  phash: "82a81f67f94615ae",
  box_count: 3,
  pending_count: 2,
  max_pending_confidence: 0.81,
  labeled: true,
  created_at: "2026-09-17T10:06:00Z",
};

export const exampleImage2: ImageRow = {
  ...exampleImage,
  id: IMAGE_ID_2,
  path: "images/ahmadia/IX-12-02491_0031_0002.jpg",
  file_name: "IX-12-02491_0031_0002.jpg",
  capture_time: "2019-04-15T06:35:39Z",
  lat: 29.49476,
  lon: 47.76486,
  alt: 191.8,
  phash: "8488349d3494bffb",
  box_count: 0,
  pending_count: 0,
  max_pending_confidence: null,
  labeled: false,
};

export const exampleImagePage: ImagePage = {
  items: [exampleImage, exampleImage2],
  next_cursor: null,
  total: 2,
};

export const personBox: Box = {
  id: "b0000000-6666-4000-8000-000000000001",
  image_id: IMAGE_ID,
  class_id: CLASS_ID(1),
  x: 512,
  y: 300,
  w: 140,
  h: 90,
  confidence: null,
  provenance: { kind: "person", model_id: null, provider: null, model_name: null, query_run_id: null },
  review_state: "accepted",
  reviewed_at: "2026-09-17T10:45:00Z",
  created_at: "2026-09-17T10:45:00Z",
};

export const proposalBox: Box = {
  id: "b0000000-6666-4000-8000-000000000002",
  image_id: IMAGE_ID,
  class_id: CLASS_ID(4),
  x: 1210.5,
  y: 802,
  w: 96,
  h: 61,
  confidence: 0.81,
  provenance: {
    kind: "local_model",
    model_id: MODEL_ID,
    provider: null,
    model_name: "yolo11m-coco",
    query_run_id: null,
  },
  review_state: "unreviewed",
  reviewed_at: null,
  created_at: "2026-09-17T11:00:00Z",
};

export const exampleModel: Model = {
  id: MODEL_ID,
  name: "yolo11m-coco",
  kind: "imported",
  weights_path: "models/yolo11m.pt",
  base_weights: null,
  dataset_id: null,
  hyperparameters: {},
  metrics: null,
  class_names: ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck"],
  class_aliases: { truck: "dump_truck" },
  exports: {},
  artifacts: {},
  run_id: null,
  created_at: "2026-09-17T10:10:00Z",
};

export const exampleJob: Job = {
  id: "j0000000-4444-4000-8000-000000000003",
  project_id: PROJECT_ID,
  type: "infer",
  state: "queued",
  progress: 0,
  message: "",
  log_path: "runs/j0000000-4444-4000-8000-000000000003/job.log",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-17T13:00:00Z",
  started_at: null,
  finished_at: null,
};

export function errorBody(code: string, message: string, details: Record<string, unknown> = {}) {
  return { error: { code, message, details } };
}

export interface RecordedRequest {
  method: string;
  /** path plus query string, e.g. `/api/v1/projects/p/images?sort=path` */
  url: string;
  body: unknown;
}

export interface FakeRoute {
  method: string;
  path: RegExp;
  status?: number;
  body?: unknown | ((req: RecordedRequest) => unknown);
}

/** A `fetch` that answers from `routes` (first match wins) and records every request. */
export function fakeFetch(routes: FakeRoute[]): { fetch: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const text = await req.text();
    const rec: RecordedRequest = {
      method: req.method,
      url: url.pathname + url.search,
      body: text ? JSON.parse(text) : null,
    };
    requests.push(rec);
    const route = routes.find((r) => r.method === req.method && r.path.test(url.pathname));
    if (!route) {
      return new Response(
        JSON.stringify(errorBody("not_found", `no fake route for ${req.method} ${url.pathname}`)),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const status = route.status ?? 200;
    const payload =
      typeof route.body === "function" ? (route.body as (r: RecordedRequest) => unknown)(rec) : route.body;
    if (status === 204 || payload === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export function fakeClient(routes: FakeRoute[]): { api: ApiClient; requests: RecordedRequest[] } {
  const { fetch: fetchImpl, requests } = fakeFetch(routes);
  return { api: createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl }), requests };
}

/** Routes that mirror the mock server for the common S2 reads. */
export function mockRoutes(): FakeRoute[] {
  return [
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
    { method: "GET", path: /\/projects\/[^/]+\/images$/, body: exampleImagePage },
    { method: "GET", path: /\/images\/[^/]+$/, body: exampleImage },
    { method: "GET", path: /\/images\/[^/]+\/boxes$/, body: { items: [personBox, proposalBox] } },
    { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
    { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
  ];
}
