import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import type { AssetModelRunStart } from "@contract/client";

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

const part = (
  id: string,
  name: string,
  group: string,
  shape: string,
  params: object,
  extra: object = {},
) => ({
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
  frame: null,
  review: null,
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

const RUN = "d0000000-9999-4000-8000-000000000001";
const RUN_JOB = "c0000000-9999-4000-8000-000000000009";

type RunState = "running" | "finished" | "stopped";

/** The simulated run `routeRuns` drives and `routeAssetModels` reads, per page. */
interface RunSim {
  state: RunState | null;
  polls: number;
  started: AssetModelRunStart[];
  stopped: number;
}
const sims = new WeakMap<Page, RunSim>();

const runJson = (sim: RunSim) => ({
  id: RUN,
  model_id: MODEL,
  job_id: RUN_JOB,
  provider: "anthropic",
  model_name: "claude-opus-5-5",
  mode: "build",
  notes: null,
  state: sim.state ?? "running",
  stop_reason: sim.state === "stopped" ? "user" : null,
  phase: sim.state === "finished" ? "done" : "reading",
  steps: Array.from({ length: sim.polls + 1 }, (_, i) => ({
    n: i + 1,
    tool: "read_drawing",
    ok: true,
    summary: `read step ${i + 1}`,
    has_thumb: false,
  })),
  summary: sim.state === "finished" ? "Built the vessel." : null,
  open_questions: [],
  usage: { input_tokens: 1000, output_tokens: 200 },
  sources: sim.started[0]?.sources ?? [],
  version: sim.state === "finished" ? 1 : null,
  comparison: null,
  started_at: T,
  ended_at: sim.state === "running" ? null : T,
});

const runJobJson = (sim: RunSim) => ({
  ...jobJson(),
  id: RUN_JOB,
  type: "asset_model_run",
  state: sim.state === "running" ? "running" : sim.state === "stopped" ? "cancelled" : "succeeded",
  progress: sim.state === "running" ? 0.1 : 1,
  params: { model_id: MODEL, run_id: RUN },
  result: null,
  finished_at: sim.state === "running" ? null : T,
});

export interface PostedVersion {
  spec: { parts: { id: string; params: Record<string, unknown> }[] };
  note: string | null;
}

/**
 * Serves one asset model with versions 1 and 2 (N7 projection 200 in v2) and the GLB fixture, and
 * answers a POST to `/versions` with version 3, which the lists then include. Returns the recorded
 * POST bodies. With `{ empty: true }` the model has no version and no run until a run from `routeRuns`
 * finishes (then version 1 exists).
 */
export async function routeAssetModels(
  page: Page,
  opts: { empty?: boolean } = {},
): Promise<{ versions: PostedVersion[] }> {
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
      const sim = sims.get(page);
      const built = sim?.state === "finished";
      const rows = () =>
        opts.empty
          ? built
            ? [versionJson(1, "agent", null)]
            : []
          : [
              ...(saved ? [versionJson(3, "manual", posted[0].note)] : []),
              versionJson(2, "manual", "N7: projection 180 → 200 mm"),
              versionJson(1, "agent", null),
            ];
      if (req.method() === "POST" && rest === `/${MODEL}/versions`) {
        posted.push(req.postDataJSON() as PostedVersion);
        return json(route, { version: versionJson(3, "manual", posted[0].note), job: jobJson() }, 201);
      }
      if (req.method() !== "GET") return route.fallback();
      if (rest === "") {
        const model = opts.empty
          ? {
              ...modelJson(1),
              current_version: built ? 1 : null,
              live_run_id: sim?.state === "running" ? RUN : null,
            }
          : modelJson(saved ? 3 : 2);
        return json(route, { items: [model] });
      }
      if (rest === `/${MODEL}/versions`) return json(route, { items: rows() });
      if (rest === `/${MODEL}/runs`)
        return json(route, { items: opts.empty && sim?.state ? [runJson(sim)] : [] });
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

/**
 * The agent run endpoints, plus the build dialog's providers, drawings and photos. A POST starts a
 * running run; each GET of it adds a step and, after `finishAfterPolls` polls, finishes it with
 * version 1; a stop POST ends it as stopped. Call after `routeAssetModels(page, { empty: true })`:
 * a later route runs first, and this one falls back for paths it does not own.
 */
export async function routeRuns(
  page: Page,
  { finishAfterPolls }: { finishAfterPolls: number },
): Promise<{ started: AssetModelRunStart[]; stopped: number }> {
  const sim: RunSim = { state: null, polls: 0, started: [], stopped: 0 };
  sims.set(page, sim);
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) });
  const api = "/api/v1";
  const preflight = (route: Route) => route.request().method() === "OPTIONS";
  await page.route(
    (u) => u.pathname === `${api}/providers`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      const row = (name: string, has_key: boolean, model_name: string) => ({
        name,
        has_key,
        model_name,
        requests_per_minute: 30,
        cost_per_request: 0.02,
      });
      return json(route, {
        items: [
          row("openai", false, "gpt-5"),
          row("anthropic", true, "claude-opus-5-5"),
          row("gemini", false, "gemini-3-pro"),
        ],
      });
    },
  );
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/data`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      const type = new URL(route.request().url()).searchParams.get("type");
      const items =
        type === "drawing"
          ? [
              {
                id: "d1",
                type: "drawing",
                label: "GA drawing",
                captured_on: null,
                status: "ready",
                created_at: T,
                summary: {},
              },
            ]
          : [];
      return json(route, { items, next_cursor: null });
    },
  );
  await page.route(
    (u) => u.pathname === `${api}/projects/${P}/images`,
    (route) => {
      if (preflight(route)) return route.fulfill({ status: 204, headers: CORS });
      return json(route, { items: [], next_cursor: null, total: 0 });
    },
  );
  const runsBase = `${api}/projects/${P}/asset-models/${MODEL}/runs`;
  await page.route(
    (u) => u.pathname.startsWith(runsBase),
    async (route) => {
      const req = route.request();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const rest = new URL(req.url()).pathname.slice(runsBase.length);
      if (req.method() === "POST" && rest === "") {
        sim.started.push(req.postDataJSON() as AssetModelRunStart);
        sim.state = "running";
        sim.polls = 0;
        return json(route, { run: runJson(sim), job: runJobJson(sim) }, 202);
      }
      if (req.method() === "POST" && rest === `/${RUN}/stop`) {
        sim.stopped += 1;
        sim.state = "stopped";
        // The contract answers a stop with 202 and the ended (or ending) run.
        return json(route, runJson(sim), 202);
      }
      if (req.method() === "GET" && rest === `/${RUN}`) {
        if (sim.state === "running") {
          sim.polls += 1;
          if (sim.polls >= finishAfterPolls) sim.state = "finished";
        }
        return json(route, runJson(sim));
      }
      return route.fallback();
    },
  );
  return {
    get started() {
      return sim.started;
    },
    get stopped() {
      return sim.stopped;
    },
  };
}
