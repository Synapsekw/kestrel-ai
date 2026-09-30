import type { ClassDef, Project } from "@contract/client";
import { DEFAULT_SEVERITY_SCALE } from "@/ui";
import type { DataItem } from "@/api/dataItems";
import type {
  Activity,
  Finding,
  FindingAttachment,
  FindingComment,
  FindingDetail,
  FindingSummary,
} from "@/api/findings";
import type { OverviewSite, ProjectOverview } from "@/api/overview";
import { exampleProject, IMAGE_ID, MAP_ID, MODEL_ID, SOURCE_ID, type FakeRoute } from "./fixtures";

export const FINDING_ID = "f0000000-9999-4000-8000-000000000217";
export const FINDING_ID_2 = "f0000000-9999-4000-8000-000000000218";
export const ANNOTATION_ID = "b0000000-1212-4000-8000-000000000001";
export const TYPE_SPALLING = "t0000000-1111-4000-8000-000000000001";
export const TYPE_CRACK = "t0000000-1111-4000-8000-000000000002";
export const TYPE_EXCAVATOR = "t0000000-1111-4000-8000-000000000003";

export const projectTypes: ClassDef[] = [
  {
    id: TYPE_SPALLING,
    name: "Spalling",
    colour: "#ff5a4f",
    hotkey: null,
    order: 0,
    kind: "defect",
    default_severity: 3,
    group: "Concrete defects",
  },
  {
    id: TYPE_CRACK,
    name: "Crack",
    colour: "#ff9c3a",
    hotkey: null,
    order: 1,
    kind: "defect",
    default_severity: null,
    group: null,
  },
  {
    id: TYPE_EXCAVATOR,
    name: "excavator",
    colour: "#f97316",
    hotkey: "1",
    order: 2,
    kind: "object",
    default_severity: null,
    group: null,
  },
];

/** The example project with a catalogue type list (defects and one object). */
export const typedProject: Project = { ...exampleProject, classes: projectTypes };

/** F16: reuse DS's default scale instead of copying it. */
export const SEVERITY_SCALE = DEFAULT_SEVERITY_SCALE;

/** The scale endpoint, for tests that mount S2's provider; DS's default scale equals SEVERITY_SCALE.
 *  F16: `SeverityScale` is `{levels}`, not `{items}`. */
export const severityRoute: FakeRoute = {
  method: "GET",
  path: /\/catalogue\/severity$/,
  body: { levels: SEVERITY_SCALE },
};

export const exampleFinding: Finding = {
  id: FINDING_ID,
  number: 217,
  type_id: TYPE_SPALLING,
  severity: 4,
  status: "open",
  note: "Spall at the column base, north face.",
  created_by: `model:${MODEL_ID}`,
  confidence: 0.87,
  anchor: { kind: "image", image_id: IMAGE_ID, annotation_id: ANNOTATION_ID },
  lon: 47.765,
  lat: 29.495,
  data_type: "image_set",
  data_id: SOURCE_ID,
  created_at: "2026-09-14T09:00:00Z",
  updated_at: "2026-09-14T11:06:00Z",
  reviewed_at: null,
  closed_at: null,
};

export const exampleFinding2: Finding = {
  ...exampleFinding,
  id: FINDING_ID_2,
  number: 218,
  type_id: TYPE_CRACK,
  severity: null,
  status: "closed",
  created_by: "human",
  confidence: null,
  anchor: { kind: "map", map_id: MAP_ID, geometry: { type: "Point", coordinates: [500, 500] } },
  data_type: "map",
  data_id: MAP_ID,
  closed_at: "2026-09-20T08:00:00Z",
};

export const exampleFindingDetail: FindingDetail = {
  ...exampleFinding,
  attachment_count: 1,
  comment_count: 1,
};

/** 30 days ending 2026-09-26: open 41 a week ago, 47 today; two closures this week. */
function trend(): FindingSummary["trend"] {
  const days: FindingSummary["trend"] = [];
  for (let i = 29; i >= 0; i -= 1) {
    const day = new Date(Date.UTC(2026, 8, 26 - i)).toISOString().slice(0, 10);
    days.push({ day, open: i >= 7 ? 41 : 47 - i, open_by_severity: {}, closed: i === 2 || i === 5 ? 1 : 0 });
  }
  return days;
}

export const exampleSummary: FindingSummary = {
  by_status: { open: 47, reviewed: 12, closed: 30 },
  open_by_severity: { "1": 9, "2": 19, "3": 14, "4": 5 },
  open_no_severity: 0,
  by_type: [
    { type_id: TYPE_SPALLING, n: 20 },
    { type_id: TYPE_CRACK, n: 27 },
  ],
  trend: trend(),
};

export const emptySummary: FindingSummary = {
  by_status: { open: 0, reviewed: 0, closed: 0 },
  open_by_severity: {},
  open_no_severity: 0,
  by_type: [],
  trend: [],
};

/** F16: named `fullOverview` (not `exampleOverview`) so it does not clash with
 *  `test/fixtures.ts::exampleOverview`, which carries different values. */
export const fullOverview: ProjectOverview = {
  findings: exampleSummary,
  data: { image_sets: 2, images: 1284, maps: 3, elevations: 1, point_clouds: 2, drawings: 0 },
  latest_volume: {
    measurement_id: "v0000000-8888-4000-8000-000000000001",
    name: "Stockpile N",
    net_m3: 12480,
    previous_net_m3: 12893,
  },
  hero_map_id: MAP_ID,
  hero: { kind: "map", id: MAP_ID },
  banners: [],
};

export const emptyOverview: ProjectOverview = {
  findings: emptySummary,
  data: { image_sets: 0, images: 0, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
  latest_volume: null,
  hero_map_id: null,
  hero: null,
  banners: [],
};

export const cloudOnlyOverview: ProjectOverview = {
  ...fullOverview,
  data: { image_sets: 1, images: 40, maps: 0, elevations: 0, point_clouds: 1, drawings: 0 },
  hero_map_id: null,
  hero: { kind: "point_cloud", id: "c0000000-1111-4000-8000-000000000001" },
};

export const imagesOnlyOverview: ProjectOverview = {
  ...fullOverview,
  data: { image_sets: 1, images: 1284, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
  latest_volume: null,
  hero_map_id: null,
  hero: { kind: "images", id: null },
};

export const exampleSite: OverviewSite = {
  center: [20.4612, 44.8125],
  bounds_wgs84: [20.4581, 44.8103, 20.4643, 44.8147],
  source: "map",
  area_m2: 241000,
  photo_points: [
    [20.459, 44.811],
    [20.46, 44.811],
    [20.461, 44.812],
  ],
  photo_points_total: 1280,
};

export const noSite: OverviewSite = {
  center: null,
  bounds_wgs84: null,
  source: null,
  area_m2: null,
  photo_points: [],
  photo_points_total: 0,
};

export const exampleActivity: Activity[] = [
  {
    id: "a1",
    at: "2026-09-26T09:48:00Z",
    kind: "detections.accepted",
    subject_id: null,
    summary: "9 detections accepted as findings",
    payload: {},
  },
  {
    id: "a2",
    at: "2026-09-26T09:00:00Z",
    kind: "finding.severity",
    subject_id: FINDING_ID,
    summary: "F-0217 set to Critical",
    payload: {},
  },
  {
    id: "a3",
    at: "2026-09-25T15:00:00Z",
    kind: "data.imported",
    subject_id: SOURCE_ID,
    summary: "Photos imported: Flight 14 Sep",
    payload: {},
  },
];

export const exampleComment: FindingComment = {
  id: "c0000000-0000-4000-8000-000000000001",
  finding_id: FINDING_ID,
  author: "Operator",
  text: "Depth measured with a gauge: 28 mm.",
  created_at: "2026-09-26T08:00:00Z",
  edited_at: null,
};

export const exampleAttachment: FindingAttachment = {
  id: "p0000000-0000-4000-8000-000000000001",
  finding_id: FINDING_ID,
  path: `findings/${FINDING_ID}/p0000000-0000-4000-8000-000000000001.jpg`,
  original_name: "site-photo.jpg",
  width: 4000,
  height: 3000,
  bytes: 2_400_000,
  created_at: "2026-09-26T08:05:00Z",
};

export const exampleDataItem: DataItem = {
  id: SOURCE_ID,
  type: "image_set",
  label: "Flight 14 Sep",
  captured_on: "2026-09-14",
  status: "ready",
  summary: { image_count: 312, duplicate_count: 0 },
  created_at: "2026-09-14T12:00:00Z",
};

/** Routes most findings screens need; `overrides` come first, so they win. */
export function baseRoutes(overrides: FakeRoute[] = []): FakeRoute[] {
  return [
    ...overrides,
    { method: "GET", path: /\/projects\/[^/]+$/, body: typedProject },
    severityRoute,
    {
      method: "GET",
      path: /\/projects\/[^/]+\/data$/,
      body: { items: [exampleDataItem], next_cursor: null },
    },
    { method: "GET", path: /\/findings\/summary$/, body: exampleSummary },
  ];
}
