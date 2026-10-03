import type { AssetModel } from "@contract/client";
import type { Finding } from "@/api/findings";
import type { ProjectOverview } from "@/api/overview";
import { exampleFinding, fullOverview, TYPE_CRACK, TYPE_SPALLING } from "./findingFixtures";

export const ASSET_MODEL_ID = "a0000000-9999-4000-8000-000000000001";
export const ASSET_FINDING_ID = "f0000000-9999-4000-8000-000000000401";
export const ASSET_FINDING_ID_2 = "f0000000-9999-4000-8000-000000000402";
export const ASSET_FINDING_ID_3 = "f0000000-9999-4000-8000-000000000403";

/** An 80 m stack with the `stack` profile resolved (spec §5.1, §7): three zones, eight compass sides. */
export const exampleAssetModel: AssetModel = {
  id: ASSET_MODEL_ID,
  name: "Flare stack F-1",
  asset_type: "stack",
  tag: "F-1",
  status: "ready",
  current_version: 2,
  live_run_id: null,
  captured_on: null,
  created_at: "2026-10-02T09:00:00Z",
  updated_at: "2026-10-02T09:00:00Z",
  frame: {
    origin: { lat: 29.495, lon: 47.765, ground_alt_m: 12 },
    north_offset_deg: 0,
    height_m: 80,
    datum_label: "Ground",
    datum_note: "",
    line_azimuth_deg: null,
    silhouette: [
      [0, 2.4],
      [15, 2.2],
      [74, 1.6],
      [80, 1.8],
    ],
    levels: [20, 40, 60],
    presets: [],
  },
  review: {
    profile_id: "stack",
    name: "Stack",
    asset_noun: "stack",
    finding_noun: "finding",
    assessment_title: "Stack assessment",
    finding_unit: "photo",
    placement: "patch",
    patch_grid: 14,
    cluster_m: 1.6,
    zones: [
      { id: "head", label: "Head", min_m: 73.6, max_m: 80 },
      { id: "shaft", label: "Shaft", min_m: 15.2, max_m: 73.6 },
      { id: "base", label: "Base", min_m: 0, max_m: 15.2 },
    ],
    sides: {
      type: "compass",
      labels: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
      basis: "position",
      title: "Side",
      noun: "side",
    },
    focus: { frustum: [4], oblique_deg: 0 },
    report: { pages: "finding", min_severity: 1 },
    component_map: [],
    facts: [],
    limits: [],
    breakdowns: [],
    footer_disclaimer: "",
  },
  kind: "asset",
};

const assetBase: Finding = {
  ...exampleFinding,
  anchor: { kind: "asset", asset_model_id: ASSET_MODEL_ID, asset_version: 2, point: null, normal: null },
  data_type: "asset_model",
  data_id: ASSET_MODEL_ID,
  created_by: "human",
  confidence: null,
  asset_model_id: ASSET_MODEL_ID,
  bearing_deg: 90,
  component: "Shell",
  placement: "patch",
  representative: {
    image_id: "10000000-5555-4000-8000-000000000001",
    annotation_id: "b0000000-1212-4000-8000-000000000009",
  },
};

export const exampleAssetFinding: Finding = {
  ...assetBase,
  id: ASSET_FINDING_ID,
  number: 401,
  type_id: TYPE_SPALLING,
  severity: 3,
  height_m: 42.5,
  side: "E",
  zone: "shaft",
  sighting_count: 3,
};

export const exampleAssetFinding2: Finding = {
  ...assetBase,
  id: ASSET_FINDING_ID_2,
  number: 402,
  type_id: TYPE_CRACK,
  severity: 1,
  height_m: 77.1,
  bearing_deg: 200,
  side: "SW",
  zone: "head",
  sighting_count: 1,
};

/** A sighting the ray never hit: no height, zone or side (Global Constraints, data rules). */
export const exampleUnplacedAssetFinding: Finding = {
  ...assetBase,
  id: ASSET_FINDING_ID_3,
  number: 403,
  severity: 2,
  height_m: null,
  bearing_deg: null,
  side: null,
  zone: null,
  component: null,
  placement: "none",
  sighting_count: 1,
};

export const examplePhotoReview: NonNullable<ProjectOverview["photo_review"]> = {
  finding: 12,
  none: 90,
  uncertain: 15,
  not_assessed: 3,
};

/** An asset-inspection project: photos, a reviewed asset model as the hero, no map or cloud. */
export const assetOverview: ProjectOverview = {
  ...fullOverview,
  data: { image_sets: 1, images: 120, maps: 0, elevations: 0, point_clouds: 0, drawings: 0 },
  latest_volume: null,
  hero_map_id: null,
  hero: { kind: "asset_model", id: ASSET_MODEL_ID },
  photo_review: examplePhotoReview,
};
