// e2e/fixtures/assetInspect.ts
import type { Page, Route } from "@playwright/test";
import { fromMock } from "../mock";
import { MODEL, P } from "./assetModels";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" };
const T = "2026-10-03T09:00:00Z";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==", "base64");

export const IMG = ["10000000-0000-4000-8000-0000000000a1", "10000000-0000-4000-8000-0000000000a2"];
export const F1 = "f0000000-bbbb-4000-8000-000000000001";
export const F2 = "f0000000-bbbb-4000-8000-000000000002";
const SIZES: Record<string, [number, number]> = { [IMG[0]]: [4000, 3000], [IMG[1]]: [5280, 3956] };

const finding = (id: string, number: number, severity: number, height: number) => ({
  id, number, type_id: "c1a2b3c4-0000-4000-8000-000000000009", severity, status: "open", note: "", created_by: "human",
  confidence: null, anchor: { kind: "asset", asset_model_id: MODEL, asset_version: 2, point: [2, 6, -2], normal: [0, 0, -1] }, lon: null, lat: null, data_type: "asset_model",
  data_id: MODEL, created_at: T, updated_at: T, reviewed_at: null, closed_at: null, asset_model_id: MODEL,
  height_m: height, bearing_deg: 270, side: "W", zone: "shell", component: null, placement: "point",
  sighting_count: id === F1 ? 2 : 1, representative: { image_id: IMG[0], annotation_id: "b0000000-cccc-4000-8000-000000000001" },
});

const sighting = (n: number, findingId: string, imageId: string) => ({
  id: `50000000-cccc-4000-8000-00000000000${n}`, asset_model_id: MODEL, finding_id: findingId, image_id: imageId,
  image_name: `DJI_000${n}.JPG`, captured_at: "2026-09-14T06:05:00Z", stale: false, height_m: 6.2, bearing_deg: 270, side: "W", zone: "shell",
  annotation_id: `b0000000-cccc-4000-8000-00000000000${n}`, severity: 2, group_tag: null, placement: "point",
  center: [2, 6, -2], normal: [0, 0, -1], part: null, coverage: 0.01, placed_version: 2, created_at: T,
});

/** Serves two asset findings on the M1 e2e model, F1 seen from two photos, with their photos and polygons. */
export async function routeAssetInspect(page: Page): Promise<void> {
  const imageExample = await fromMock<Record<string, unknown>>(page, `/api/v1/projects/${P}/images/${IMG[0]}`);
  const boxExample = (await fromMock<{ items: Record<string, unknown>[] }>(page, `/api/v1/projects/${P}/images/${IMG[0]}/boxes`)).items[0];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const sightings = [sighting(1, F1, IMG[0]), sighting(2, F1, IMG[1]), sighting(3, F2, IMG[1])];
  await page.route(
    (u) => u.pathname.startsWith(`/api/v1/projects/${P}/findings`) || u.pathname.startsWith(`/api/v1/projects/${P}/images/`),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const path = new URL(req.url()).pathname.slice(`/api/v1/projects/${P}`.length);
      if (path === "/findings") return json(route, { items: [finding(F1, 1, 2, 6.2), finding(F2, 2, 1, 1.1)], next_cursor: null });
      const s = /^\/findings\/([^/]+)\/sightings$/.exec(path);
      if (s) return json(route, { items: sightings.filter((x) => x.finding_id === s[1]) });
      const img = /^\/images\/([^/]+)(\/[a-z]+)?$/.exec(path);
      if (img && SIZES[img[1]]) {
        const [w, h] = SIZES[img[1]];
        if (!img[2]) return json(route, { ...imageExample, id: img[1], width: w, height: h, capture_time: "2026-09-14T06:05:00Z" });
        if (img[2] === "/boxes")
          return json(route, {
            items: sightings
              .filter((x) => x.image_id === img[1])
              .map((x) => ({ ...boxExample, id: x.annotation_id, image_id: img[1], shape: "polygon", x: 1000, y: 800, w: 900, h: 700, angle: 0,
                points: [[1000, 800], [1900, 850], [1800, 1500], [1050, 1400]] })),
          });
        if (img[2] === "/measurements") return json(route, { items: [] });
        if (img[2] === "/file") return route.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG });
      }
      return route.fallback();
    },
  );
  const base = `/api/v1/projects/${P}/asset-models/${MODEL}`;
  await page.route(
    (u) => u.pathname === `${base}/poses` || u.pathname === `${base}/placements`,
    (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (new URL(route.request().url()).pathname.endsWith("/poses"))
        return json(route, {
          items: IMG.map((id, i) => ({ image_id: id, position: [8, 4 + i, 6], target: [0, 4, 0], up: [0, 1, 0], hfov_deg: 70, vfov_deg: 52,
            source: "exif_gimbal", accuracy_m: 3, sequence: "Flight 1", outcome: "finding", updated_at: T })),
          next: null,
        });
      return json(route, {
        version: 2,
        items: [{ sighting_id: sightings[0].id, finding_id: F1, kind: "point", center: [2, 6, -2], normal: [0, 0, -1], size: null, severity: 2, type_id: "c1a2b3c4-0000-4000-8000-000000000009", has_patch: false }],
        next: null,
      });
    },
  );
}
