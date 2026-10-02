import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";

/** The contract's Project example, which the Prism mock serves for every project id. */
export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const MODEL = "a0000000-9999-4000-8000-000000000001";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const GLB = readFileSync(new URL("./asset-model.glb", import.meta.url));
const T = "2026-10-02T09:00:00Z";

const part = (id: string, name: string, group: string, shape: string, params: object, extra: object = {}) => ({
  id,
  name,
  group,
  shape,
  params,
  source: { kind: "assumed" },
  ...extra,
});

/** The spec the GLB fixture was built from, except the shell is named "Shell (spec)" so a list read from the spec is told apart from one read from the GLB extras ("Shell"); `projection` is the N7 nozzle's. */
export const specWith = (projection: number) => ({
  parts: [
    part("shell", "Shell (spec)", "Shell", "cylinder", { id: 4000, thickness: 8, height: 8000 }),
    part(
      "N7",
      "Nozzle N7",
      "Nozzle",
      "nozzle",
      { dn: 80, od: 88.9, projection, flange_od: 200, flange_t: 20 },
      { placement: { host: "shell", bearing_deg: 270, elevation_mm: 7780 } },
    ),
  ],
});

export const modelJson = (currentVersion: number) => ({
  id: MODEL,
  name: "Vessel V-101",
  asset_type: "vessel",
  tag: "V-101",
  status: "ready",
  current_version: currentVersion,
  live_run_id: null,
  captured_on: null,
  created_at: T,
  updated_at: T,
});

export const versionJson = (n: number, kind: "agent" | "manual", note: string | null) => ({
  id: `b0000000-9999-4000-8000-00000000000${n}`,
  model_id: MODEL,
  version: n,
  kind,
  glb_status: "ready",
  source_ids: [],
  run_id: null,
  note,
  part_count: 2,
  meta: null,
  created_at: T,
});

const jobJson = () => ({
  id: "c0000000-9999-4000-8000-000000000003",
  project_id: P,
  type: "asset_model_glb",
  state: "succeeded",
  progress: 1,
  message: "",
  log_path: "runs/c0000000-9999-4000-8000-000000000003/job.log",
  params: { model_id: MODEL, version: 3 },
  result: { model_id: MODEL, version: 3 },
  error: null,
  created_at: T,
  started_at: T,
  finished_at: T,
});

export interface PostedVersion {
  spec: { parts: { id: string; params: Record<string, unknown> }[] };
  note: string | null;
}

/**
 * Serves one asset model with versions 1 and 2 (N7 projection 200 in v2) and the GLB fixture, and
 * answers a POST to `/versions` with version 3, which the lists then include. Returns the recorded
 * POST bodies.
 */
export async function routeAssetModels(page: Page): Promise<{ versions: PostedVersion[] }> {
  const posted: PostedVersion[] = [];
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  await page.route(
    (u) => u.pathname.startsWith(`/api/v1/projects/${P}/asset-models`),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const rest = new URL(req.url()).pathname.slice(`/api/v1/projects/${P}/asset-models`.length);
      const saved = posted.length > 0;
      const rows = () => [
        ...(saved ? [versionJson(3, "manual", posted[0].note)] : []),
        versionJson(2, "manual", "N7: projection 180 → 200 mm"),
        versionJson(1, "agent", null),
      ];
      if (req.method() === "POST" && rest === `/${MODEL}/versions`) {
        posted.push(req.postDataJSON() as PostedVersion);
        return json(route, { version: versionJson(3, "manual", posted[0].note), job: jobJson() }, 201);
      }
      if (req.method() !== "GET") return route.fallback();
      if (rest === "") return json(route, { items: [modelJson(saved ? 3 : 2)] });
      if (rest === `/${MODEL}/versions`) return json(route, { items: rows() });
      if (rest === `/${MODEL}/runs`) return json(route, { items: [] });
      const glb = /^\/[^/]+\/versions\/(\d+)\/glb$/.exec(rest);
      if (glb)
        return route.fulfill({ status: 200, contentType: "model/gltf-binary", headers: CORS, body: GLB });
      const detail = /^\/[^/]+\/versions\/(\d+)$/.exec(rest);
      if (detail) {
        const n = Number(detail[1]);
        const row = rows().find((r) => r.version === n);
        if (!row) return json(route, { code: "not_found", message: "no such version" }, 404);
        const spec = n === 3 ? posted[0].spec : specWith(n === 2 ? 200 : 180);
        return json(route, { ...row, spec, warnings: [] });
      }
      return route.fallback();
    },
  );
  return { versions: posted };
}
