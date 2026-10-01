import type { ClassDef, components } from "@contract/client";
import type { TrainableDataset } from "@/train/trainModel";
import { IMAGE_ID, JOB_ID, MODEL_ID, PROJECT_ID, TRAINED_MODEL_ID, runningJob } from "./fixtures";

type S = components["schemas"];

export const TYPE_ID = (n: number): string => `70000000-9999-4000-8000-00000000000${n}`;

/** Two migrated objects, one defect in a group, one archived defect. */
export const exampleTypes: S["CatalogueType"][] = [
  {
    id: TYPE_ID(1),
    name: "Excavator",
    colour: "#f97316",
    kind: "object",
    default_severity: null,
    hotkey: "1",
    group: null,
    archived: false,
    origin: "migrated",
    definition: null,
    severity_rules: [],
  },
  {
    id: TYPE_ID(2),
    name: "Dump truck",
    colour: "#06b6d4",
    kind: "object",
    default_severity: null,
    hotkey: "2",
    group: null,
    archived: false,
    origin: "migrated",
    definition: null,
    severity_rules: [],
  },
  {
    id: TYPE_ID(3),
    name: "Crack",
    colour: "#ef4444",
    kind: "defect",
    default_severity: 2,
    hotkey: "c",
    group: "Concrete defects",
    archived: false,
    origin: "user",
    definition: null,
    severity_rules: [],
  },
  {
    id: TYPE_ID(4),
    name: "Spalling",
    colour: "#a855f7",
    kind: "defect",
    default_severity: 3,
    hotkey: null,
    group: "Concrete defects",
    archived: true,
    origin: "user",
    definition: null,
    severity_rules: [],
  },
];

/** D4's default scale (F §4.1 severity defaults). */
export const exampleSeverity: S["SeverityLevel"][] = [
  { level: 1, name: "Minor", colour: "#3fb68e" },
  { level: 2, name: "Moderate", colour: "#e2bf2e" },
  { level: 3, name: "Major", colour: "#ff9c3a" },
  { level: 4, name: "Critical", colour: "#ff5a4f" },
];

export const exampleCataloguePage = { items: exampleTypes, next_cursor: null, needs_classification: true };

/** A project's derived type list (F §7.3): Excavator first with a project hotkey override "9", then Crack. */
export const exampleProjectClasses: ClassDef[] = [
  {
    id: TYPE_ID(3),
    name: "Crack",
    colour: "#ef4444",
    hotkey: "c",
    order: 1,
    kind: "defect",
    default_severity: 2,
    group: "Concrete defects",
  },
  {
    id: TYPE_ID(1),
    name: "Excavator",
    colour: "#f97316",
    hotkey: "9",
    order: 0,
    kind: "object",
    default_severity: null,
    group: null,
  },
];

export const LIB_DATASET_ID = "d1000000-7777-4000-8000-000000000001";
export const LIB_JOB_ID = "j1000000-4444-4000-8000-000000000001";

export const exampleLibraryDataset: S["LibraryDataset"] = {
  id: LIB_DATASET_ID,
  name: "machines-v1",
  task: "detect",
  origin: "built",
  filter: {
    project_ids: [PROJECT_ID],
    type_ids: [TYPE_ID(1), TYPE_ID(2)],
    captured_from: null,
    captured_to: null,
    reviewed_only: true,
  },
  classes: [
    { type_id: TYPE_ID(1), name: "Excavator" },
    { type_id: TYPE_ID(2), name: "Dump truck" },
  ],
  split_method: "by_group",
  split_params: { val_fraction: 0.2, seed: 42 },
  state: "ready",
  counts: { images: 30, train: 24, val: 6, per_class: { [TYPE_ID(1)]: 40, [TYPE_ID(2)]: 72 } },
  export_path: null,
  export_state: "none",
  legacy_path: null,
  job_id: LIB_JOB_ID,
  created_at: "2026-09-26T09:00:00Z",
  sources: [
    {
      project_id: PROJECT_ID,
      project_name: "Ahmadia",
      project_folder: "E:\\Projects\\Ahmadia",
      image_count: 30,
    },
  ],
};

export const exampleDatasetItems = {
  items: [{ project_id: PROJECT_ID, image_id: IMAGE_ID, split: "train", label_count: 3 }],
  next_cursor: null,
};

export const examplePreview: S["DatasetPreview"] = {
  images: 30,
  boxes_per_type: { [TYPE_ID(1)]: 40, [TYPE_ID(2)]: 72 },
  projects: [{ project_id: PROJECT_ID, project_name: "Ahmadia", images: 30, boxes: 112, state: "ok" }],
  skipped_by_task: 0,
};

export const TRAINING_RUN_ID = "t0000000-8888-4000-8000-000000000001";
export const TRAINING_RUN_2_ID = "t0000000-8888-4000-8000-000000000002";

/**
 * Reused across S2: `exampleTrainingRun.params` (below) and a later task's
 * `startTrainingRun(api, TRAIN_PARAMS)` test, so it is typed and exported as the real request
 * shape rather than kept as a file-local literal (controller ruling P4).
 */
export const TRAIN_PARAMS: S["TrainRequest"] = {
  name: "machines-v1-yolo11m-coco",
  dataset_id: LIB_DATASET_ID,
  base_model_id: MODEL_ID,
  epochs: 50,
  imgsz: 1280,
  batch: null,
  patience: 50,
  augmentation: "default",
  device: "0",
};

export const exampleTrainingRun: S["TrainingRun"] = {
  id: TRAINING_RUN_ID,
  name: "machines-v1-yolo11m-coco",
  dataset_id: LIB_DATASET_ID,
  base_model_id: MODEL_ID,
  params: TRAIN_PARAMS,
  job_id: JOB_ID,
  state: "succeeded",
  model_id: TRAINED_MODEL_ID,
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
  created_at: "2026-09-26T10:00:00Z",
  finished_at: "2026-09-26T10:42:00Z",
};

export const exampleTrainingRun2: S["TrainingRun"] = {
  ...exampleTrainingRun,
  id: TRAINING_RUN_2_ID,
  name: "machines-v1-e100",
  job_id: "j0000000-4444-4000-8000-000000000009",
  model_id: "m0000000-2222-4000-8000-000000000009",
  metrics: {
    map50: 0.74,
    map50_95: 0.47,
    precision: 0.8,
    recall: 0.69,
    per_class: [
      { class_name: "excavator", map50: 0.83, map50_95: 0.53, precision: 0.85, recall: 0.73 },
      { class_name: "dump_truck", map50: 0.65, map50_95: 0.41, precision: 0.76, recall: 0.65 },
    ],
  },
  created_at: "2026-09-26T11:00:00Z",
  finished_at: "2026-09-26T12:20:00Z",
};

/** A running project import, a finished library dataset build, a failed library training. */
export const exampleAppJobs: S["AppJob"][] = [
  // Newest first, as `GET /jobs` orders them (the e2e twin in `e2e/fixtures/appSections.ts` agrees).
  { ...runningJob, project_name: "Ahmadia", created_at: "2026-09-26T10:05:00Z" },
  {
    ...runningJob,
    id: LIB_JOB_ID,
    project_id: "library",
    project_name: null,
    type: "dataset_build",
    state: "succeeded",
    progress: 1,
    message: "30 images",
    params: { name: "machines-v1", dataset_id: LIB_DATASET_ID },
    result: { dataset_id: LIB_DATASET_ID },
    created_at: "2026-09-26T09:00:00Z",
    started_at: "2026-09-26T09:00:01Z",
    finished_at: "2026-09-26T09:00:09Z",
  },
  {
    ...runningJob,
    id: "j1000000-4444-4000-8000-000000000002",
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
  },
];

/** The training form's view of a dataset; the same id, name and counts as the old project fixture. */
export const exampleTrainable: TrainableDataset = {
  id: "d0000000-7777-4000-8000-000000000001",
  name: "v1",
  image_count: 30,
  train_count: 24,
  val_count: 6,
  class_count: 1,
  split_method: "by_group",
  task: "detect",
  exportBusy: false,
};
