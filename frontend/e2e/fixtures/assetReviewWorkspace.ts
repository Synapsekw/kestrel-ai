// e2e/fixtures/assetReviewWorkspace.ts
import type { Page, Route } from "@playwright/test";
import { MODEL, P } from "./assetModels";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const T = "2026-10-03T09:00:00Z";

const finding = (id: string, number: number, severity: number, extra: object = {}) => ({
  id,
  number,
  type_id: "c1a2b3c4-0000-4000-8000-000000000009",
  severity,
  status: "open",
  note: "",
  created_by: "human",
  confidence: null,
  anchor: { kind: "asset", asset_model_id: MODEL },
  lon: null,
  lat: null,
  data_type: "asset_model",
  data_id: MODEL,
  created_at: T,
  updated_at: T,
  reviewed_at: null,
  closed_at: null,
  asset_model_id: MODEL,
  height_m: 6.2,
  bearing_deg: 270,
  side: "West",
  zone: "shell",
  component: null,
  placement: "point",
  sighting_count: 2,
  representative: { image_id: "10000000-0000-4000-8000-000000000001", annotation_id: "b1" },
  ...extra,
});

export const FINDINGS = [
  finding("f0000000-aaaa-4000-8000-000000000001", 1, 2),
  finding("f0000000-aaaa-4000-8000-000000000002", 2, 1, { height_m: 1.1, zone: "bottom" }),
];

const pose = (i: number, outcome: string) => ({
  image_id: `10000000-0000-4000-8000-00000000000${i}`,
  position: [6 * Math.cos(i), 3 + i, 6 * Math.sin(i)],
  target: [0, 4, 0],
  up: [0, 1, 0],
  hfov_deg: 70,
  vfov_deg: 52,
  source: "exif_gimbal",
  accuracy_m: 3,
  sequence: "Flight 1",
  outcome,
  updated_at: T,
});

export const SOURCE_ID = "50000000-3333-4000-8000-000000000001";
type ImportBody = { dry_run: boolean; class_map?: Record<string, string> };

/** Records the job POSTs and review imports; serves findings, placements (pins only), three poses, an image set and a dry-run preview. */
export async function routeAssetReview(page: Page): Promise<{ posts: string[]; imports: ImportBody[] }> {
  const posts: string[] = [];
  const imports: ImportBody[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const job = (type: string) => ({
    job: {
      id: `c0000000-af00-4000-8000-00000000000${posts.length}`,
      project_id: P,
      type,
      state: "queued",
      progress: 0,
      message: "",
      log_path: "",
      params: { asset_model_id: MODEL },
      result: null,
      error: null,
      created_at: T,
      started_at: null,
      finished_at: null,
    },
  });
  // The contract's Project example lists only object types; the import maps the kit's "crack" to a defect type, so add it.
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}`,
    async (route) => {
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const res = await route.fetch();
      const project = (await res.json()) as { classes: object[] };
      project.classes = [
        ...project.classes,
        {
          id: FINDINGS[0].type_id,
          name: "crack",
          colour: "#ff5a4f",
          hotkey: "c",
          order: project.classes.length,
          kind: "defect",
          default_severity: 2,
          group: "Concrete defects",
        },
      ];
      return json(route, project);
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/findings`,
    (route) =>
      route.request().method() === "OPTIONS"
        ? route.fulfill({ status: 204, headers: CORS })
        : json(route, { items: FINDINGS, next_cursor: null }),
  );
  const base = `/api/v1/projects/${P}/asset-models/${MODEL}`;
  await page.route(
    (u) =>
      u.pathname.startsWith(`${base}/poses`) ||
      u.pathname.startsWith(`${base}/placements`) ||
      u.pathname === `${base}/findings/regroup`,
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const path = new URL(req.url()).pathname.slice(base.length);
      if (req.method() === "POST") {
        posts.push(path);
        const type =
          path === "/poses/estimate"
            ? "asset_pose"
            : path === "/placements/compute"
              ? "asset_place"
              : "asset_group";
        return json(route, job(type), 202);
      }
      if (path === "/poses")
        return json(route, {
          items: [pose(1, "finding"), pose(2, "uncertain"), pose(3, "none")],
          next: null,
        });
      if (path === "/placements")
        return json(route, {
          version: 1,
          items: FINDINGS.map((f, i) => ({
            sighting_id: `s${i}`,
            finding_id: f.id,
            kind: "point",
            center: [2, f.height_m, -2],
            normal: [0, 0, -1],
            size: 0,
            severity: f.severity,
            type_id: f.type_id,
            has_patch: false,
          })),
          next: null,
        });
      return route.fallback();
    },
  );
  await page.route(
    (u) =>
      u.pathname === `/api/v1/projects/${P}/review-imports` || u.pathname === `/api/v1/projects/${P}/sources`,
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (req.method() === "GET")
        return json(route, {
          items: [
            {
              id: SOURCE_ID,
              kind: "images",
              label: "Flight 14 Sep",
              captured_on: null,
              map_id: null,
              folder: "D:\\photos",
              site: null,
              settings: {},
              image_count: 3,
              duplicate_count: 0,
              job_id: null,
              imported_at: T,
              created_at: T,
            },
          ],
          next_cursor: null,
        });
      const body = req.postDataJSON() as ImportBody;
      imports.push(body);
      const preview = {
        dry_run: true,
        unit: "region",
        profile: "building-facade",
        profile_id: "building_facade",
        photos: 3,
        matched: 2,
        matched_by: { path: 2 },
        unmatched_count: 1,
        unmatched: ["flight-b/DJI_0003.JPG"],
        unmatched_reasons: [{ kit_id: "p03", source_name: "flight-b/DJI_0003.JPG", reason: "not_found" }],
        classes: [{ key: "crack", label: "Crack", count: 3, type_id: FINDINGS[0].type_id }],
        statuses: { finding: 2, none: 0, uncertain: 0, not_assessed: 0 },
        sightings: 3,
        has_surface: false,
        has_glb: false,
        has_merged: true,
        model: { ready_version: 2, existing_sightings: 0 },
      };
      const j = job("review_kit_import").job;
      return json(
        route,
        {
          job: body.dry_run
            ? {
                ...j,
                state: "succeeded",
                progress: 1,
                params: { dry_run: true },
                result: preview,
                finished_at: T,
              }
            : { ...j, params: { dry_run: false } },
        },
        202,
      );
    },
  );
  return { posts, imports };
}
