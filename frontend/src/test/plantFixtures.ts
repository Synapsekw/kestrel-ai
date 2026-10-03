import type { AssetModel, AssetSpec } from "@contract/client";
import type { AssetItem, AssetItemRow, CatalogueEntry, SiteModelPackage } from "@/api/plantItems";
import { MODEL } from "./assetModelFixtures";

export const PLANT_ID = "m1";

export const itemRow = (o: Partial<AssetItemRow> = {}): AssetItemRow =>
  ({
    node: "20-T-0001",
    tag: "20-T-0001",
    name: "LNG tank 1",
    type: "tank_lng",
    area: "20",
    plant_e: 100,
    plant_n: 200,
    site_x: null,
    site_y: null,
    lon: null,
    lat: null,
    base_el: 100,
    top_el: 135,
    height_source: "drawing",
    confidence: "high",
    flags: [],
    source_sheet: "T0006",
    has_geometry: true,
    ...o,
  }) as AssetItemRow;

export const ITEM = {
  id: "20-T-0001",
  tag: "20-T-0001",
  name: "LNG tank 1",
  type: "tank_lng",
  area: "20",
  footprint: { kind: "circle", center: [100, 200], d: 80 },
  base_el: 100,
  top_el: 135,
  levels: [],
  params: { d_m: 80, roof: "dome", platforms: true },
  height_source: "drawing",
  source: { kind: "drawing", id: "dr-1", page: 2, region: [0.1, 0.2, 0.3, 0.4] },
  confidence: "high",
  flags: [{ code: "height_mismatch", value: 1.2, note: "Scan top at EL 136.2" }],
  parts: [],
  notes: null,
} as unknown as AssetItem;

export const PUMP = {
  ...ITEM,
  id: "30-P-0001",
  tag: "30-P-0001",
  name: "Send-out pump 1",
  type: "other",
  area: "30",
  footprint: { kind: "rect", center: [260, 180], size: [6, 3], rot_deg: 0 },
  top_el: 103,
  params: {},
  flags: [],
} as unknown as AssetItem;

/** pydantic model_json_schema shapes: a number with an exclusive minimum, an enum, a boolean, an integer, a nullable array. */
export const CATALOGUE = [
  {
    type: "tank_lng",
    family: "equipment",
    doc: "Full-containment LNG tank: wall, dome, roof platforms",
    default_height_m: 40,
    params_schema: {
      type: "object",
      properties: {
        d_m: { type: "number", exclusiveMinimum: 0, default: 80, title: "D M" },
        roof: { type: "string", enum: ["dome", "flat"], default: "dome", title: "Roof" },
        platforms: { type: "boolean", default: true, title: "Platforms" },
        risers: { type: "integer", minimum: 0, default: 4, title: "Risers" },
        nozzles: {
          anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }],
          default: null,
          title: "Nozzles",
        },
      },
    },
  },
  {
    type: "other",
    family: "fallback",
    doc: "Extrudes the footprint from base to top",
    default_height_m: 3,
    params_schema: { type: "object", properties: {} },
  },
] as unknown as CatalogueEntry[];

export const PACKAGES = [
  {
    id: "k1",
    run_id: "r1",
    n: 1,
    label: "Jetty head 1",
    drawing_id: "dr-1",
    region: [0, 0, 1, 1],
    area: "10",
    expected: [],
    state: "done",
    attempts: 1,
    item_count: 42,
    usage: { input_tokens: 0, output_tokens: 0 },
    summary: null,
    started_at: "2026-10-03T09:00:00Z",
    ended_at: "2026-10-03T09:20:00Z",
  },
  {
    id: "k2",
    run_id: "r1",
    n: 2,
    label: "Tank row north",
    drawing_id: "dr-1",
    region: [0, 0, 1, 1],
    area: "20",
    expected: [],
    state: "running",
    attempts: 1,
    item_count: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    summary: null,
    started_at: "2026-10-03T09:20:00Z",
    ended_at: null,
  },
  {
    id: "k3",
    run_id: "r1",
    n: 3,
    label: "Process area",
    drawing_id: "dr-1",
    region: [0, 0, 1, 1],
    area: "30",
    expected: [],
    state: "queued",
    attempts: 1,
    item_count: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    summary: null,
    started_at: null,
    ended_at: null,
  },
] as SiteModelPackage[];

export const plantModel = (o: Partial<AssetModel> = {}): AssetModel =>
  ({
    ...MODEL,
    id: PLANT_ID,
    name: "Al-Zour LNG plant",
    kind: "plant",
    current_version: 3,
    ...o,
  }) as AssetModel;

export const plantSpec = (items: AssetItem[] = [ITEM, PUMP]): AssetSpec =>
  ({ asset: {}, parts: [], items, environment: [], site: null }) as unknown as AssetSpec;
