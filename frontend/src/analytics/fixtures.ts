/** Test data for the Analytics and Site areas screens, shaped like the contract's examples. */
import type { Source } from "@contract/client";
import type { AreaAnalytics, PhotoBatchAnalytics, RunSummary, SourceAnalytics } from "@/api/analytics";
import type { SiteArea } from "@/api/siteAreas";
import { CLASS_ID, MAP_ID, MODEL_ID, PROJECT_ID, exampleTimeline } from "@/test/fixtures";

export { PROJECT_ID, MAP_ID };
export const EXC = CLASS_ID(1);
export const DUMP = CLASS_ID(4);
export const AREA_1 = "5a000000-aaaa-4000-8000-000000000001";
export const AREA_2 = "5a000000-aaaa-4000-8000-000000000002";
export const MAP_SOURCE_ID = "50000000-3333-4000-8000-000000000002";
export const PHOTO_SOURCE_ID = "50000000-3333-4000-8000-000000000001";
export const MAY_MAP_ID = "7c9e1b2a-5555-4000-8000-000000000002";

export const timeline = {
  ...exampleTimeline,
  classes: [
    { id: EXC, name: "excavator", colour: "#f97316" },
    { id: DUMP, name: "dump truck", colour: "#0ea5e9" },
  ],
};

/** The same surveys counted from verified detections only. */
export const verifiedTimeline = {
  ...timeline,
  surveys: timeline.surveys.map((s) => ({ ...s, counts: s.verified_counts, deltas: {} })),
};

const baseSource = {
  folder: "D:/Surveys/may-ortho.tif",
  site: "may-ortho",
  settings: { max_side: 4000, quality: 95, dedupe_threshold: 4, group_regex: "" },
  duplicate_count: 0,
  job_id: null,
  imported_at: "2026-05-21T10:00:00Z",
  created_at: "2026-05-21T09:55:00Z",
};

export const mapSource: Source = {
  ...baseSource,
  id: MAP_SOURCE_ID,
  kind: "map",
  label: "May survey",
  captured_on: "2026-05-20",
  map_id: MAP_ID,
  image_count: 0,
};

export const photoSource: Source = {
  ...baseSource,
  id: PHOTO_SOURCE_ID,
  kind: "images",
  label: "Flight 15 Apr",
  captured_on: "2026-04-15",
  map_id: null,
  folder: "D:/Flights/apr",
  image_count: 3299,
};

export const mapRun: RunSummary = {
  id: "r0000000-7777-4000-8000-000000000001",
  kind: "map",
  source_id: MAP_SOURCE_ID,
  source_label: "May survey",
  model_id: MODEL_ID,
  model_name: "machinery-v3",
  conf: 0.25,
  job_state: "succeeded",
  pinned: false,
  counts: { [EXC]: 42, [DUMP]: 17 },
  verified_counts: { [EXC]: 30 },
  review: { total: 530, reviewed: 412 },
  created_at: "2026-09-22T11:00:00Z",
};

export const mapSourceAnalytics: SourceAnalytics = {
  source: mapSource,
  unit: "objects",
  image_count: null,
  run: mapRun,
  classes: [
    { class_id: EXC, name: "excavator", colour: "#f97316", total: 42, verified: 30 },
    { class_id: DUMP, name: "dump truck", colour: "#0ea5e9", total: 17, verified: 0 },
  ],
  review: { total: 530, reviewed: 412 },
};

export const photoRun: RunSummary = {
  ...mapRun,
  id: "q0000000-8888-4000-8000-000000000001",
  kind: "images",
  source_id: PHOTO_SOURCE_ID,
  source_label: "Flight 15 Apr",
  counts: { [EXC]: 31, [DUMP]: 9 },
  verified_counts: { [EXC]: 12 },
  review: { total: 40, reviewed: 12 },
};

export const photoBatches: PhotoBatchAnalytics = {
  batches: [
    {
      source: photoSource,
      run: photoRun,
      classes: [
        { class_id: EXC, name: "excavator", colour: "#f97316", total: 31, verified: 12 },
        { class_id: DUMP, name: "dump truck", colour: "#0ea5e9", total: 9, verified: 0 },
      ],
    },
  ],
};

export const areaAnalytics: AreaAnalytics = {
  areas: [
    { id: AREA_1, name: "North laydown yard" },
    { id: AREA_2, name: "Batching plant" },
  ],
  surveys: [
    {
      map_id: MAP_ID,
      map_name: "April survey",
      captured_on: "2026-04-15",
      state: "ok",
      per_area: {
        [AREA_1]: {
          partial: false,
          counts: { [EXC]: { total: 5, verified: 5 }, [DUMP]: { total: 2, verified: 1 } },
        },
        [AREA_2]: { partial: true, counts: { [EXC]: { total: 1, verified: 0 } } },
      },
    },
    {
      map_id: MAY_MAP_ID,
      map_name: "May survey",
      captured_on: "2026-05-20",
      state: "ok",
      per_area: {
        [AREA_1]: {
          partial: false,
          counts: { [EXC]: { total: 7, verified: 6 }, [DUMP]: { total: 3, verified: 3 } },
        },
      },
    },
  ],
};

export const siteAreas: SiteArea[] = [
  {
    id: AREA_1,
    name: "North laydown yard",
    polygon_wgs84: [
      [15.0, 44.99],
      [15.01, 44.99],
      [15.01, 44.995],
    ],
    created_at: "2026-09-23T09:00:00Z",
  },
];
