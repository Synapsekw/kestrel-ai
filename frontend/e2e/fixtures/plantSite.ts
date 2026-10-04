import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { P, modelJson, versionJson } from "./assetModels";
import { routeSiteScene, sceneJson } from "./siteScene";

/** The S3 e2e plant (make_plant_site.py, built by A1's `assemble_glb`). */
export const PLANT = "a0000000-9999-4000-8000-0000000000f1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const GLB = {
  1: readFileSync(new URL("./plant-site-v1.glb", import.meta.url)),
  2: readFileSync(new URL("./plant-site-v2.glb", import.meta.url)),
} as const;
const SPEC_V1 = JSON.parse(readFileSync(new URL("./plant-site-spec-v1.json", import.meta.url), "utf-8")) as {
  items: Item[];
} & Record<string, unknown>;
const T = "2026-10-03T09:00:00Z";

interface Item {
  id: string;
  tag: string | null;
  name: string;
  type: string;
  area: string | null;
  footprint: { kind: string; center?: number[]; pts?: number[][] };
  base_el: number | null;
  top_el: number | null;
  height_source: string;
  confidence: string;
  flags: unknown[];
}
export interface PostedVersion {
  spec: { items: Item[] };
  note: string | null;
}

/** AssetItemRow from a spec item: the row's key is `node` (the GLB node name, the item id), it has no `id`. */
function row(i: Item) {
  const c = i.footprint.center ?? i.footprint.pts?.[0] ?? [0, 0];
  return {
    node: i.id,
    tag: i.tag,
    name: i.name,
    type: i.type,
    area: i.area,
    plant_e: c[0],
    plant_n: c[1],
    site_x: null,
    site_y: null,
    lon: null,
    lat: null,
    base_el: i.base_el,
    top_el: i.top_el,
    height_source: i.height_source,
    confidence: i.confidence,
    flags: i.flags ?? [],
    source_sheet: "T0006",
    has_geometry: true,
  };
}

/** The site manifest naming the plant's version 1 (S1's frame; photos and findings empty). */
export function plantSceneJson() {
  const base = `/api/v1/projects/${P}/asset-models/${PLANT}/versions/1`;
  return {
    ...sceneJson(true),
    model: { id: PLANT, version: 1, glb_url: `${base}/glb`, csv_url: `${base}/csv`, kind: "plant" },
    photos: { count: 0, url: "" },
    findings: { count: 0, url: "" },
  };
}

/**
 * A plant model with version 1 (the generated fixture), a catalogue, the register API and the site scene
 * (S1's `routeSiteScene`); a save adds version 2, whose build job has already succeeded.
 */
export async function routePlantSite(page: Page): Promise<{ versions: PostedVersion[] }> {
  const posted: PostedVersion[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const current = () => (posted.length ? 2 : 1);
  const specOf = (v: number) => (v === 2 ? posted[0].spec : SPEC_V1);
  const model = () => ({
    ...modelJson(current()),
    id: PLANT,
    name: "Al-Zour LNG plant",
    asset_type: "plant",
    tag: null,
    kind: "plant",
  });
  const versionRow = (v: number) => ({
    ...versionJson(v, v === 1 ? "agent" : "manual", v === 2 ? posted[0].note : null),
    id: `b0000000-9999-4000-8000-0000000000f${v}`,
    model_id: PLANT,
    part_count: 0,
  });
  const base = `/api/v1/projects/${P}/asset-models`;

  await routeSiteScene(page, { withModel: true, scene: plantSceneJson(), glb: GLB[1] });
  await page.route(
    (u) => u.pathname === "/api/v1/asset-models/catalogue",
    (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: CORS })
        : json(route, {
            types: [
              {
                type: "other",
                family: "fallback",
                doc: "Extrudes the footprint from base to top",
                default_height_m: 3,
                params_schema: { type: "object", properties: {} },
              },
              {
                type: "tank_lng",
                family: "equipment",
                doc: "LNG tank",
                default_height_m: 40,
                params_schema: {
                  type: "object",
                  properties: { d_m: { type: "number", exclusiveMinimum: 0, default: 80 } },
                },
              },
            ],
          }),
  );
  await page.route(
    (u) => u.pathname.startsWith(base),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const url = new URL(req.url());
      const rest = url.pathname.slice(base.length);
      if (req.method() === "POST" && rest === `/${PLANT}/versions`) {
        posted.push(req.postDataJSON() as PostedVersion);
        const job = {
          id: "c0000000-9999-4000-8000-0000000000f9",
          project_id: P,
          type: "asset_model_glb",
          state: "succeeded",
          progress: 1,
          message: "",
          log_path: "",
          params: { model_id: PLANT, version: 2 },
          result: { model_id: PLANT, version: 2 },
          error: null,
          created_at: T,
          started_at: T,
          finished_at: T,
        };
        return json(route, { version: versionRow(2), job }, 201);
      }
      if (req.method() !== "GET") return route.fallback();
      if (rest === "") return json(route, { items: [model()] });
      if (rest === `/${PLANT}`) return json(route, model());
      if (rest === `/${PLANT}/versions`)
        return json(route, { items: posted.length ? [versionRow(2), versionRow(1)] : [versionRow(1)] });
      if (rest === `/${PLANT}/runs`) return json(route, { items: [] });
      const glb = /^\/[^/]+\/versions\/(\d)\/glb$/.exec(rest);
      if (glb)
        return route.fulfill({
          status: 200,
          contentType: "model/gltf-binary",
          headers: CORS,
          body: GLB[Number(glb[1]) as 1 | 2],
        });
      const items = /^\/[^/]+\/versions\/(\d)\/items$/.exec(rest);
      if (items) {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const rows = specOf(Number(items[1]))
          .items.filter((i) => !q || `${i.tag ?? ""} ${i.name}`.toLowerCase().includes(q))
          .map(row);
        return json(route, { items: rows, next_cursor: null });
      }
      const one = /^\/[^/]+\/versions\/(\d)\/items\/(.+)$/.exec(rest);
      if (one) {
        const it = specOf(Number(one[1])).items.find((i) => i.id === decodeURIComponent(one[2]));
        return it
          ? json(route, it)
          : json(route, { error: { code: "not_found", message: "no such item", details: {} } }, 404);
      }
      const detail = /^\/[^/]+\/versions\/(\d)$/.exec(rest);
      if (detail)
        return json(route, {
          ...versionRow(Number(detail[1])),
          spec: specOf(Number(detail[1])),
          warnings: [],
        });
      return route.fallback();
    },
  );
  return { versions: posted };
}
