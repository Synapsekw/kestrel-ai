import type { Job } from "@contract/client";
import type { CatalogueType } from "@/api/catalogue";
import { normaliseName } from "@/catalogue/normaliseName";
import type {
  CatalogueTypeSpec,
  EnsureTypesRequest,
  EnsureTypesResult,
  InspectBucket,
  InspectResult,
  ProjectTemplate,
  TemplateSlot,
} from "@/setup/api";
import { bucketId, type DraftBucket } from "@/setup/remap";
import { runningJob, type FakeRoute, type RecordedRequest } from "./fixtures";

// S1-U5's fixtures, typed against U1's schemas. When tsc names a missing required field, add it here
// with a neutral value; never cast. The slot keys are U5's own: no test depends on U1's built-in seed.

export const INSPECT_JOB_ID = "j0000000-4444-4000-8000-000000000091";
export const INSPECT_JOB_ID_2 = "j0000000-4444-4000-8000-000000000092";
const T0 = "2026-09-30T00:00:00Z";

export function typeSpec(
  name: string,
  kind: "defect" | "object",
  severity: number | null,
  hotkey: string | null,
  colour = "#ff9c3a",
): CatalogueTypeSpec {
  return {
    name,
    kind,
    colour,
    default_severity: severity,
    hotkey,
    definition: `${name}, in one sentence.`,
    severity_rules: [],
  };
}

function slot(
  key: string,
  label: string,
  route: TemplateSlot["route"],
  required: boolean,
  accepts: string[],
  match: TemplateSlot["match"] = null,
): TemplateSlot {
  return { key, label, route, required, accepts, match };
}

function template(
  id: string,
  name: string,
  description: string,
  slots: TemplateSlot[],
  types: CatalogueTypeSpec[],
  builtin = true,
): ProjectTemplate {
  return {
    id,
    name,
    description,
    builtin,
    config: { config_version: 1, slots, types },
    created_at: T0,
    updated_at: T0,
  };
}

export const MAPPING = template(
  "builtin-mapping",
  "Mapping and survey",
  "Orthomosaics, elevation models and site change.",
  [
    slot("ortho", "Orthomosaic", "map", true, ["tif", "tiff"], { raster: "ortho" }),
    slot("dsm", "Elevation (DSM / DTM)", "elevation", false, ["tif", "tiff"]),
    slot("design", "Design surface / CAD", "drawing", false, ["pdf", "dxf", "xml"]),
    slot("raw", "Raw drone images", "images", false, ["jpg", "jpeg", "dng"]),
  ],
  [
    typeSpec("Stockpile", "object", 1, "1"),
    typeSpec("Erosion / washout", "defect", 3, "2"),
    typeSpec("Standing water", "defect", 2, "3"),
    typeSpec("Unapproved machinery", "object", 2, "4"),
    typeSpec("Slope failure", "defect", 4, "5"),
    typeSpec("Vegetation encroachment", "defect", 1, "6"),
  ],
);

export const VERTICAL = template(
  "builtin-vertical",
  "Vertical asset inspection",
  "Towers, turbines, chimneys and façades.",
  [
    slot("visual", "Visual photos", "images", true, ["jpg", "jpeg", "dng"], { thermal: false }),
    slot("thermal", "Thermal photos", "images", false, ["jpg", "jpeg"], { thermal: true }),
    slot("cloud", "3D point cloud", "pointcloud", false, ["las", "laz"]),
    slot("drawings", "Asset drawings", "drawing", false, ["pdf", "dxf"]),
  ],
  [
    typeSpec("Corrosion", "defect", 2, "1"),
    typeSpec("Coating damage", "defect", 1, "2"),
    typeSpec("Loose / missing bolt", "defect", 3, "3"),
    typeSpec("Antenna misalignment", "defect", 3, "4"),
    typeSpec("Bird nest", "object", 2, "5", "#22c55e"),
    typeSpec("Thermal hot spot", "defect", 4, "6"),
    typeSpec("Cracked weld", "defect", 4, "7"),
  ],
);

export const CONFINED = template(
  "builtin-confined",
  "Confined space inspection",
  "Tanks, boilers, silos, sewers and pipes.",
  [
    slot("video", "Inspection video", "video", false, ["mp4", "mov"]),
    slot("stills", "Stills", "images", true, ["jpg", "jpeg"]),
    slot("lidar", "LiDAR scan", "pointcloud", false, ["las", "laz"]),
    slot("drawings", "Structure drawings", "drawing", false, ["pdf", "dxf"]),
  ],
  [
    typeSpec("Pitting corrosion", "defect", 3, "1"),
    typeSpec("Weld crack", "defect", 4, "2"),
    typeSpec("Liner blistering", "defect", 2, "3"),
    typeSpec("Deposits / scale", "defect", 1, "4"),
    typeSpec("Wall deformation", "defect", 3, "5"),
    typeSpec("Leak / seepage", "defect", 4, "6"),
    typeSpec("Debris / foreign object", "object", 1, "7"),
  ],
);

export const SAVED = template(
  "tpl-saved-1",
  "Telecom mast, client X",
  "",
  VERTICAL.config.slots,
  [
    typeSpec("Corrosion", "defect", 2, "1"),
    typeSpec("Bird nest", "object", 2, "5", "#22c55e"),
    typeSpec("Feeder damage", "defect", 3, "8"),
  ],
  false,
);

export const TEMPLATES: ProjectTemplate[] = [MAPPING, VERTICAL, CONFINED, SAVED];

export function bucket(
  over: Partial<InspectBucket> & Pick<InspectBucket, "route" | "folder">,
): InspectBucket {
  return {
    match: {},
    slot_key: null,
    files: [],
    count: 1,
    bytes: 1_000_000,
    samples: [],
    crs: null,
    ...over,
  };
}

export const VISUAL = bucket({
  route: "images",
  match: { thermal: false },
  folder: "E:\\DCIM\\100MEDIA",
  count: 612,
  bytes: 7_800_000_000,
  samples: ["DJI_0001_V.JPG"],
});
export const THERMAL = bucket({
  route: "images",
  match: { thermal: true },
  folder: "E:\\DCIM\\100MEDIA",
  count: 88,
  bytes: 412_000_000,
  samples: ["DJI_0001_T.JPG"],
});
export const ORTHO = bucket({
  route: "map",
  match: { raster: "ortho" },
  folder: "E:\\Delivery\\ortho",
  files: ["E:\\Delivery\\ortho\\ortho_q3.tif"],
  bytes: 4_100_000_000,
  crs: "EPSG:32634",
});
export const DSM = bucket({
  route: "elevation",
  match: { raster: "elevation" },
  folder: "E:\\Delivery\\dsm",
  files: ["E:\\Delivery\\dsm\\dsm_q3.tif"],
  bytes: 1_300_000_000,
  crs: "EPSG:32634",
});
export const LAS = bucket({
  route: "pointcloud",
  folder: "E:\\Delivery\\scan",
  files: ["E:\\Delivery\\scan\\tower.las"],
  bytes: 2_200_000_000,
});
export const PDF = bucket({
  route: "drawing",
  folder: "E:\\Delivery\\docs",
  files: ["E:\\Delivery\\docs\\SR-0412_GA.pdf"],
  bytes: 3_000_000,
});
export const VIDEO = bucket({
  route: "video",
  folder: "E:\\Flights",
  files: ["E:\\Flights\\FLIGHT_01.MP4"],
  bytes: 4_800_000_000,
});

export const draftBucket = (b: InspectBucket, over: Partial<DraftBucket> = {}): DraftBucket => ({
  ...b,
  id: bucketId(b),
  skipped: false,
  ...over,
});

export function inspectResult(buckets: InspectBucket[], over: Partial<InspectResult> = {}): InspectResult {
  return {
    buckets,
    not_recognised: { count: 0, samples: [] },
    suggested_template_id: null,
    truncated: false,
    ...over,
  };
}

export function inspectJob(over: Partial<Job> = {}): Job {
  return {
    ...runningJob,
    id: INSPECT_JOB_ID,
    project_id: "library",
    type: "setup_inspect",
    progress: 0.3,
    message: "Reading headers 6 / 20",
    params: { paths: ["E:\\DCIM"] },
    ...over,
  };
}

export function doneInspectJob(result: InspectResult, over: Partial<Job> = {}): Job {
  return inspectJob({
    state: "succeeded",
    progress: 1,
    message: "Sorted",
    result: result as unknown as NonNullable<Job["result"]>,
    finished_at: "2026-09-30T10:01:00Z",
    ...over,
  });
}

export const CATALOGUE_TYPES: CatalogueType[] = [
  {
    id: "t-corrosion",
    name: "Corrosion",
    colour: "#ff9c3a",
    kind: "defect",
    default_severity: 2,
    hotkey: null,
    group: null,
    archived: false,
    origin: "user",
    definition: "Red-brown staining or flaking on steel.",
    severity_rules: [{ when: "section loss visible", severity: 3 }],
  },
  {
    id: "t-bird",
    name: "Bird nest",
    colour: "#22c55e",
    kind: "defect",
    default_severity: 2,
    hotkey: null,
    group: null,
    archived: false,
    origin: "user",
    definition: null,
    severity_rules: [],
  },
  {
    id: "t-scaffold",
    name: "Scaffold",
    colour: "#3b82f6",
    kind: "object",
    default_severity: null,
    hotkey: "3",
    group: null,
    archived: false,
    origin: "user",
    definition: null,
    severity_rules: [],
  },
  {
    id: "t-old",
    name: "Old type",
    colour: "#888888",
    kind: "object",
    default_severity: null,
    hotkey: null,
    group: null,
    archived: true,
    origin: "user",
    definition: null,
    severity_rules: [],
  },
];

/** A stand-in for U2's `ensure`: a catalogue hit reuses its id (and reports a kind or colour conflict), a miss gets `new-<n>`. */
export function ensureEcho(req: RecordedRequest): EnsureTypesResult {
  const body = req.body as EnsureTypesRequest;
  return {
    items: body.types.map((t, i) => {
      const hit = CATALOGUE_TYPES.find((c) => normaliseName(c.name) === normaliseName(t.name));
      const differs =
        hit !== undefined &&
        (hit.kind !== t.kind || (t.colour != null && hit.colour.toLowerCase() !== t.colour.toLowerCase()));
      return {
        name: t.name,
        id: hit ? hit.id : body.dry_run ? null : `new-${i + 1}`,
        created: !hit && !body.dry_run,
        conflict: differs && hit ? { kind: hit.kind, colour: hit.colour } : null,
      };
    }),
  };
}

/** What `ensureEcho` gives Vertical's seven types, in order, and the hotkeys the template sets on them. */
export const VERTICAL_IDS = ["t-corrosion", "new-2", "new-3", "new-4", "t-bird", "new-6", "new-7"];
export const VERTICAL_HOTKEYS: Record<string, string> = Object.fromEntries(
  VERTICAL_IDS.map((id, i) => [id, String(i + 1)]),
);

export const LIBRARY_UP = {
  available: true,
  root: "C:\\Users\\operator\\AppData\\Roaming\\kestrel-ai\\library",
  error: null,
};

/** The routes every setup screen reads; `extra` comes first, so it overrides (first match wins). */
export function setupRoutes(extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    { method: "GET", path: /\/project-templates$/, body: { items: TEMPLATES } },
    { method: "GET", path: /\/library\/status$/, body: LIBRARY_UP },
    { method: "GET", path: /\/catalogue\/types$/, body: { items: CATALOGUE_TYPES, next_cursor: null } },
    { method: "POST", path: /\/catalogue\/types\/ensure$/, body: ensureEcho },
  ];
}
