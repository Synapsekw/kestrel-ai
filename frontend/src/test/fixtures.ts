import {
  createApiClient,
  type ApiClient,
  type Box,
  type ClassDef,
  type CostEstimate,
  type Dataset,
  type GeoMap,
  type Image as ImageRow,
  type ImagePage,
  type Job,
  type JobLog,
  type MapLabel,
  type MapRun,
  type MapScore,
  type LibraryModel,
  type LibraryStatus,
  type MapZone,
  type ModelUsage,
  type Project,
  type Provider,
  type QueryRun,
  type Source,
  type Stats,
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
  kind: "train",
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
  marked_empty: false,
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
  angle: 0,
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
  angle: 0,
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

export const exampleModel: LibraryModel = {
  id: MODEL_ID,
  name: "yolo11m-coco",
  notes: "",
  supplier: null,
  task: "detect",
  format: "pt",
  origin: "starter",
  state: "ready",
  class_names: ["person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck"],
  class_aliases: { truck: "dump_truck" },
  provenance: {},
  hyperparameters: {},
  metrics: null,
  exports: {},
  artifacts: {},
  train_gsd_cm: null,
  sha256: "0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c",
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

export const TRAINED_MODEL_ID = "m0000000-2222-4000-8000-000000000002";
export const DATASET_ID = "d0000000-7777-4000-8000-000000000001";
export const RUN_ID = "q0000000-8888-4000-8000-000000000001";
export const JOB_ID = "j0000000-4444-4000-8000-000000000001";

export const exampleTrainedModel: LibraryModel = {
  id: TRAINED_MODEL_ID,
  name: "ahmadia-v1-n",
  notes: "First model trained on the April flights.",
  supplier: null,
  task: "detect",
  format: "pt",
  origin: "trained",
  state: "ready",
  class_names: ["excavator", "dump_truck"],
  class_aliases: {},
  provenance: {
    project_id: PROJECT_ID,
    project_name: "Ahmadia",
    project_folder: "E:\\Projects\\Ahmadia",
    dataset_id: DATASET_ID,
    dataset_name: "v1",
    run_id: "j0000000-4444-4000-8000-000000000009",
    base_model_id: MODEL_ID,
    base_model_name: "yolo11m-coco",
    source_file: null,
  },
  hyperparameters: { epochs: 3, imgsz: 1280, augmentation: "aerial" },
  metrics: {
    map50: 0.71,
    map50_95: 0.44,
    precision: 0.78,
    recall: 0.66,
    per_class: [
      { class_name: "excavator", map50: 0.8, map50_95: 0.5, precision: 0.82, recall: 0.7 },
      { class_name: "dump_truck", map50: 0.62, map50_95: 0.38, precision: 0.74, recall: 0.62 },
    ],
  },
  exports: { onnx: "exports/weights.onnx" },
  artifacts: {
    results_csv: "artifacts/results.csv",
    confusion_matrix: "artifacts/confusion_matrix.png",
    pr_curve: "artifacts/PR_curve.png",
  },
  train_gsd_cm: 2,
  sha256: "9f2c4a1b7e3d5f6a8b0c2d4e6f8a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e1f2a",
  created_at: "2026-09-17T15:00:00Z",
};

export const IMPORTED_MODEL_ID = "m0000000-2222-4000-8000-000000000003";

export const exampleImportedModel: LibraryModel = {
  ...exampleModel,
  id: IMPORTED_MODEL_ID,
  name: "client-x-machinery",
  origin: "imported",
  supplier: "Client X",
  class_names: ["excavator", "truck"],
  provenance: { source_file: "E:\\Models\\client-x\\best.pt" },
  sha256: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  created_at: "2026-09-18T08:00:00Z",
};

export const exampleLibraryStatus: LibraryStatus = {
  available: true,
  root: "C:\\Users\\operator\\AppData\\Roaming\\kestrel-ai\\library",
  error: null,
};

export const exampleUsage: ModelUsage = {
  projects: [
    {
      project_id: PROJECT_ID,
      name: "Ahmadia",
      folder: "E:\\Projects\\Ahmadia",
      preannotation: true,
      query_runs: 2,
      map_runs: 1,
    },
  ],
};


export const exampleDataset: Dataset = {
  id: DATASET_ID,
  name: "v1",
  classes: [exampleClasses[0]],
  split_method: "by_group",
  split_params: { val_fraction: 0.2, seed: 42 },
  path: "datasets/v1",
  image_count: 30,
  train_count: 24,
  val_count: 6,
  job_id: "j0000000-4444-4000-8000-000000000002",
  created_at: "2026-09-17T12:00:00Z",
};

export const exampleProviders: Provider[] = [
  { name: "openai", has_key: false, model_name: "gpt-5", requests_per_minute: 30, cost_per_request: 0.02 },
  {
    name: "anthropic",
    has_key: true,
    model_name: "claude-opus-5",
    requests_per_minute: 30,
    cost_per_request: 0.02,
  },
];

export const exampleQueryRun: QueryRun = {
  id: RUN_ID,
  kind: "cloud_provider",
  model_id: null,
  provider: "anthropic",
  model_name: "claude-opus-5",
  query: "dump trucks",
  image_ids: [IMAGE_ID, IMAGE_ID_2],
  tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
  conf: 0.25,
  job_id: "j0000000-4444-4000-8000-000000000003",
  box_count: 7,
  promoted_at: null,
  created_at: "2026-09-17T13:00:00Z",
};

export const exampleEstimate: CostEstimate = {
  images: 5,
  tiles: 40,
  requests: 40,
  cost_per_request: 0.02,
  estimated_cost: 0.8,
};

export const exampleJobLog: JobLog = {
  lines: ["2026-09-17 10:05:01 INFO job started", "2026-09-17 10:05:09 INFO 50 / 3299 images"],
  path: "runs/j0000000-4444-4000-8000-000000000001/job.log",
};

/** The mock's example job: what every job endpoint and every job-returning POST answers. */
export const runningJob: Job = {
  id: JOB_ID,
  project_id: PROJECT_ID,
  type: "import",
  state: "running",
  progress: 0.42,
  message: "1386 / 3299 images",
  log_path: "runs/j0000000-4444-4000-8000-000000000001/job.log",
  params: { source_id: SOURCE_ID },
  result: null,
  error: null,
  created_at: "2026-09-17T10:05:00Z",
  started_at: "2026-09-17T10:05:01Z",
  finished_at: null,
};

/** Ultralytics `results.csv` shape (8.4); older versions pad the header cells with spaces. */
export const RESULTS_CSV = [
  "epoch,time,train/box_loss,train/cls_loss,train/dfl_loss,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B),val/box_loss,val/cls_loss,val/dfl_loss,lr/pg0,lr/pg1,lr/pg2",
  "1,12.3,1.9,2.4,1.5,0.31,0.22,0.18,0.09,1.8,2.1,1.4,0.001,0.001,0.001",
  "2,24.1,1.6,1.9,1.4,0.52,0.41,0.45,0.24,1.5,1.7,1.3,0.001,0.001,0.001",
  "3,36.0,1.4,1.6,1.3,0.78,0.66,0.71,0.44,1.3,1.4,1.2,0.001,0.001,0.001",
].join("\n");

export const exampleSource: Source = {
  id: SOURCE_ID,
  folder: "E:\\Dev\\Yolo\\Ahmadia Construction Data",
  site: "ahmadia",
  settings: exampleProject.import_defaults,
  image_count: 3299,
  duplicate_count: 0,
  job_id: JOB_ID,
  imported_at: "2026-09-17T10:30:00Z",
  created_at: "2026-09-17T10:05:00Z",
};

export const exampleStats: Stats = {
  image_count: 3299,
  labeled_count: 30,
  unlabeled_count: 3269,
  box_count: 112,
  pending_review_count: 41,
  duplicate_count: 0,
  boxes_per_class: [
    { class_id: CLASS_ID(1), class_name: "excavator", count: 40 },
    { class_id: CLASS_ID(4), class_name: "dump_truck", count: 72 },
  ],
  sources: [{ source_id: SOURCE_ID, site: "ahmadia", image_count: 3299 }],
  groups: [
    { group_key: "0031", image_count: 697 },
    { group_key: "0033", image_count: 622 },
  ],
  resolution_histogram: [{ width: 4000, height: 2667, count: 3299 }],
  capture_time_range: { min: "2019-04-15T06:35:36Z", max: "2019-04-15T09:12:01Z" },
  gps_bounds: { min_lat: 29.4901, min_lon: 47.7602, max_lat: 29.4988, max_lon: 47.7701 },
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

/** A JSON response payload; kept narrower than `unknown` so a body function keeps its parameter type. */
export type FakeBody = object | string | number | boolean | null;

export interface FakeRoute {
  method: string;
  path: RegExp;
  status?: number;
  body?: FakeBody | ((req: RecordedRequest) => FakeBody);
  /** Send `body` verbatim as `text/csv` instead of JSON (artifact downloads). */
  raw?: boolean;
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
    if (route.raw) {
      return new Response(String(payload), { status, headers: { "Content-Type": "text/csv" } });
    }
    if (status === 204 || payload === undefined) return new Response(null, { status });
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

export function fakeClient(routes: FakeRoute[]): { api: ApiClient; requests: RecordedRequest[] } {
  const { fetch: fetchImpl, requests } = fakeFetch(routes);
  return { api: createApiClient({ baseUrl: "http://fake", token: "t", fetch: fetchImpl }), requests };
}

export const MAP_ID = "a0000000-6666-4000-8000-000000000001";
export const MAP_RUN_ID = "r0000000-7777-4000-8000-000000000001";

export const exampleGeoMap: GeoMap = {
  id: MAP_ID,
  name: "Site north ortho",
  captured_on: "2026-04-15",
  status: "ready",
  error: null,
  source_path: "D:/orthos/site-north.tif",
  source_size: 3221225472,
  width: 80000,
  height: 60000,
  band_count: 4,
  dtype: "uint8",
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 33N"]',
  epsg: 32633,
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  geotransform: [500000, 0.03, 0, 4983000, 0, -0.03],
  bounds_native: [500000, 4981200, 502400, 4983000],
  bounds_wgs84: [15.0, 44.98, 15.03, 45.0],
  gsd_cm: 3,
  tile_grid: { tile_size: 256, max_zoom: 9 },
  labels_version: 3,
  job_id: JOB_ID,
  created_at: "2026-09-22T10:00:00Z",
};

export const exampleMapRun: MapRun = {
  id: MAP_RUN_ID,
  map_id: MAP_ID,
  kind: "local_model",
  model_id: MODEL_ID,
  provider: null,
  model_name: "machinery-v3",
  query: "",
  tile_size: 1280,
  overlap: 0.2,
  nms_iou: 0.5,
  conf: 0.25,
  target_gsd_cm: 2,
  job_id: JOB_ID,
  state: "succeeded",
  counts: { [CLASS_ID(1)]: 42, [CLASS_ID(4)]: 17 },
  detection_count: 59,
  created_at: "2026-09-22T11:00:00Z",
};

export const exampleZone: MapZone = {
  id: "z0000000-9999-4000-8000-000000000001",
  map_id: MAP_ID,
  name: "Zone 1",
  polygon: [
    [1000, 1000],
    [6000, 1000],
    [6000, 5000],
    [1000, 5000],
  ],
};

export const exampleLabel: MapLabel = {
  id: "l0000000-1212-4000-8000-000000000001",
  map_id: MAP_ID,
  class_id: CLASS_ID(1),
  x: 1210,
  y: 1205,
  w: 175,
  h: 118,
  angle: null,
  source: "manual",
  created_at: "2026-09-22T12:00:00Z",
  updated_at: "2026-09-22T12:00:00Z",
};

const scoreRow = (class_id: string | null) => ({
  class_id,
  tp: 18,
  fp: 2,
  fn: 3,
  precision: 0.9,
  recall: 0.857,
  f1: 0.878,
  predicted: 20,
  actual: 21,
  count_error: -1,
  count_error_pct: -4.76,
});

export const exampleMapScore: MapScore = {
  run_id: MAP_RUN_ID,
  iou: 0.5,
  labels_version: 3,
  has_zones: true,
  overall: scoreRow(null),
  per_class: [scoreRow(CLASS_ID(1))],
  per_zone: [{ ...scoreRow(null), zone_id: exampleZone.id }],
  matches: [
    {
      kind: "detection",
      id: "d1",
      match: "tp",
      zone_id: exampleZone.id,
      class_id: CLASS_ID(1),
      x: 1200,
      y: 1200,
      w: 180,
      h: 120,
    },
    {
      kind: "detection",
      id: "d2",
      match: "fp",
      zone_id: exampleZone.id,
      class_id: CLASS_ID(1),
      x: 3000,
      y: 2400,
      w: 170,
      h: 110,
    },
    {
      kind: "label",
      id: exampleLabel.id,
      match: "fn",
      zone_id: exampleZone.id,
      class_id: CLASS_ID(4),
      x: 4100,
      y: 3300,
      w: 200,
      h: 140,
    },
  ],
};

export const exampleTimeline = {
  basis: { model_id: MODEL_ID, model_name: "yolo11m-coco", conf: 0.25 },
  classes: [{ id: CLASS_ID(1), name: "excavator", colour: "#f97316" }],
  surveys: [
    {
      map_id: MAP_ID,
      map_name: "April survey",
      captured_on: "2026-04-15",
      date_is_import_date: false,
      run_id: "5e4d3c2b-0000-4000-8000-000000000001",
      model_name: "yolo11m-coco",
      conf: 0.25,
      counts: { [CLASS_ID(1)]: 12 },
      deltas: {},
      state: "ok" as const,
      reason: null,
    },
    {
      map_id: "7c9e1b2a-5555-4000-8000-000000000002",
      map_name: "May survey",
      captured_on: "2026-05-20",
      date_is_import_date: false,
      run_id: "5e4d3c2b-0000-4000-8000-000000000002",
      model_name: "yolo11m-coco",
      conf: 0.25,
      counts: { [CLASS_ID(1)]: 15 },
      deltas: { [CLASS_ID(1)]: 3 },
      state: "ok" as const,
      reason: null,
    },
  ],
};
