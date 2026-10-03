import type { SceneCloud, SiteScene } from "@/api/siteScene";
import type { SiteFrameT } from "@/site3d/engine/siteTransform";

export const SCENE_PROJECT = "p1";
export const SCENE_MODEL = "m1";

export const TEST_FRAME: NonNullable<SiteScene["frame"]> = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [244338.089, 3179515.69],
  plant_north_deg: 17.9991,
  datum: { label: "HPFS", el_m: 100 },
};

/** Nothing placed, no model: the view has no frame (Review Focus 1, "no frame"). */
export const EMPTY_SCENE: SiteScene = {
  frame: null,
  model: null,
  orthos: [],
  clouds: [],
  drawings: [],
  photos: { count: 0, url: "" },
  findings: { count: 0, url: `/api/v1/projects/${SCENE_PROJECT}/map-workspace/findings` },
};

/** A frame (from the map workspace) but no plant model yet (Review Focus 1, "no model"). */
export const FRAME_ONLY_SCENE: SiteScene = { ...EMPTY_SCENE, frame: TEST_FRAME };

export const MODEL_SCENE: SiteScene = {
  ...FRAME_ONLY_SCENE,
  model: {
    id: SCENE_MODEL,
    version: 1,
    glb_url: `/api/v1/projects/${SCENE_PROJECT}/asset-models/${SCENE_MODEL}/versions/1/glb`,
    csv_url: `/api/v1/projects/${SCENE_PROJECT}/asset-models/${SCENE_MODEL}/versions/1/csv`,
    kind: "plant",
  },
  clouds: [
    {
      id: "c1",
      name: "Site scan",
      octree_url: `/api/v1/projects/${SCENE_PROJECT}/pointclouds/c1/octree/metadata.json`,
      crs_epsg: 32639,
      same_crs: true,
      z_offset_m: 120.45,
    },
  ],
  photos: { count: 36, url: `/api/v1/projects/${SCENE_PROJECT}/pointclouds/c1/cameras` },
  findings: { count: 3, url: `/api/v1/projects/${SCENE_PROJECT}/map-workspace/findings` },
};

export const TILE_SCENE: SiteScene = {
  ...MODEL_SCENE,
  orthos: [
    {
      id: "o1",
      name: "Site ortho",
      tile_url_template: `/api/v1/projects/${SCENE_PROJECT}/site-tiles/map/o1/{z}/{x}/{y}?v=o1&frame_key=epsg%3A32639`,
      bounds_site: [244000, 3179000, 246000, 3181000],
      min_z: 7,
      max_z: 17,
    },
  ],
  drawings: [
    {
      id: "d1",
      name: "Plot plan T0006",
      tile_url_template: `/api/v1/projects/${SCENE_PROJECT}/site-tiles/drawing_raster/d1/{z}/{x}/{y}?v=3&frame_key=epsg%3A32639`,
      bounds_site: [245000, 3179200, 246200, 3180400],
    },
  ],
};

/** Al-Zour's plant grid: UTM 39N, theta 17.9991 deg, datum HPFS 100. */
export const FRAME: SiteFrameT = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [244338.089, 3179515.69],
  plant_north_deg: 17.9991,
  datum: { label: "HPFS", el_m: 100 },
};

export const cloudRow = (o: Partial<SceneCloud> = {}): SceneCloud => ({
  id: "c1",
  name: "May survey",
  octree_url: "/api/v1/projects/p/pointclouds/c1/octree/metadata.json",
  crs_epsg: 32639,
  same_crs: true,
  // plant EL = cloud z + 120.45 (Al-Zour's cloud ground is z = -20.45 at EL 100)
  z_offset_m: 120.45,
  ...o,
});

export const sceneWith = (o: Partial<SiteScene> = {}): SiteScene => ({
  frame: { ...FRAME },
  model: null,
  orthos: [],
  clouds: [],
  drawings: [],
  photos: { count: 0, url: "" },
  findings: { count: 0, url: "" },
  ...o,
});
