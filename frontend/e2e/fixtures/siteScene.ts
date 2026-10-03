import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { MODEL, P } from "./assetModels";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const GLB = readFileSync(new URL("./site-plant.glb", import.meta.url));
/** A sea, a land block and one tank under an "environment" group (make-site-env-glb.mjs, plan S2-8). */
export const ENV_GLB = readFileSync(new URL("./site-env.glb", import.meta.url));

export const SITE_URL = `/p/${P}/site/${MODEL}`;

/** A manifest with the Al-Zour frame and, optionally, the two-item fixture plant (plan S1 T10). */
export function sceneJson(withModel: boolean) {
  return {
    frame: {
      crs: { epsg: 32639, wkt: null },
      origin_crs: [244338.089, 3179515.69],
      plant_north_deg: 17.9991,
      datum: { label: "HPFS", el_m: 100 },
    },
    model: withModel
      ? {
          id: MODEL,
          version: 1,
          glb_url: `/api/v1/projects/${P}/asset-models/${MODEL}/versions/1/glb`,
          csv_url: `/api/v1/projects/${P}/asset-models/${MODEL}/versions/1/csv`,
          kind: "plant",
        }
      : null,
    orthos: [],
    clouds: [],
    drawings: [],
    photos: { count: 0, url: "" },
    findings: { count: 0, url: `/api/v1/projects/${P}/map-workspace/findings` },
  };
}

/** S2's environment scene: the model plus one cloud the site can't place (index Review Focus 2). */
export function envSceneJson() {
  return {
    ...sceneJson(true),
    clouds: [
      {
        id: "c-local",
        name: "Local scan",
        octree_url: `/api/v1/projects/${P}/pointclouds/c-local/octree/metadata.json`,
        crs_epsg: null,
        same_crs: false,
        z_offset_m: 0,
      },
    ],
    photos: { count: 0, url: "" },
    findings: { count: 0, url: "" },
  };
}

/**
 * Serves the manifest and the GLB; everything else falls through to the Prism mock. `scene` and `glb`
 * replace the default manifest and plant (S2's environment fixture).
 */
export async function routeSiteScene(
  page: Page,
  { withModel, scene, glb = GLB }: { withModel: boolean; scene?: unknown; glb?: Buffer },
): Promise<void> {
  const body = JSON.stringify(scene ?? sceneJson(withModel));
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/site-scene`,
    (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: CORS })
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: CORS,
            body,
          }),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/asset-models/${MODEL}/versions/1/glb`,
    (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", headers: CORS, body: glb }),
  );
}
